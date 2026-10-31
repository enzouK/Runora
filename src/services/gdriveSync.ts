/**
 * DriveSyncService — sync with Google Drive, no paid hosting required.
 *
 * How it works (sync on the user's own free Drive, no paid hosting):
 * - The app ships a built-in OAuth "Web application" Client ID (like
 *   reader.ttsu.app); the user just clicks "Conectar conta Google". A custom
 *   Client ID can be pasted in Settings to override it.
 *   Login uses Google's GIS token client (no client secret in the app).
 * - Sync artifacts in Drive (created with the drive.file scope, invisible in
 *   the Drive web UI):
 *     runora-sync.colpkg       full collection package (decks/notes/cards/
 *                              noteTypes/revlog/FSRS + ALL media embedded)
 *     runora-sync-meta.json    SyncMeta: uploadedAt, deviceId, counts…
 *     runora-sync.lock.json    cross-device lock so two devices never
 *                              overwrite each other's sync (TTL 10 min)
 * - Conflict (cloud-sync style): if the remote backup is newer than our last sync
 *   AND this device has local changes since its last sync, the caller is asked
 *   "download the last backup or keep this device?". Keeping = upload and
 *   replace the Drive backup. Downloading = replace local data (a local backup
 *   of the current state is stored first in IndexedDB runora_sync_backups).
 *
 * The raw IndexedDB/localStorage LevelDB files are NEVER synced — only the
 * portable .colpkg snapshot, so this works identically on web dev, the
 * Electron .exe and the Android WebView.
 */
import pkg from '../../package.json';
import { StorageService } from './storage';
import { MediaStore } from './mediaStore';
import { ExportImportService } from './exportImport';

const LS = {
  CLIENT_ID: 'runora_gdrive_client_id',
  TOKEN: 'runora_gdrive_token',
  DEVICE_ID: 'runora_device_id',
  LAST_SYNC: 'runora_last_sync',
  AUTO_SYNC: 'runora_auto_sync',
  RUNNING: 'runora_sync_running',
};

/**
 * Built-in OAuth Client ID (Google Cloud project owned by the app developer),
 * so users can just click "Conectar conta Google" and link their own account —
 * the same model reader.ttsu.app uses. A custom Client ID can still be set in
 * Settings to override this (advanced). When creating the project, enable the
 * Google Drive API and register these Authorized JavaScript origins:
 *   http://localhost:3000                                          (vite dev)
 *   http://127.0.0.1:39102 … 39105, http://127.0.0.1:39110 … 39119 (Electron .exe local server)
 *   https://localhost                                              (Capacitor Android WebView)
 * Scope used at runtime: drive.file + openid email.
 */
export const DEFAULT_GOOGLE_CLIENT_ID =
  '209118424285-9pc42j7taleit3fobb8bof5ig11srp7j.apps.googleusercontent.com';

export const DRIVE_FILES = {
  COLPKG: 'runora-sync.colpkg',
  META: 'runora-sync-meta.json',
  LOCK: 'runora-sync.lock.json',
} as const;

/** Lock time-to-live: a crashed sync stops blocking others after this. */
const LOCK_TTL_MS = 10 * 60 * 1000;
const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file openid email';
const MAX_LOCAL_BACKUPS = 5;

export interface DriveToken {
  accessToken: string;
  expiresAt: number;
  email?: string;
}

export interface SyncMeta {
  app: 'runora';
  version: 1;
  uploadedAt: number;
  deviceId: string;
  deviceName: string;
  appVersion: string;
  counts: {
    decks: number;
    notes: number;
    cards: number;
    noteTypes: number;
    media: number;
    revlog: number;
  };
}

interface LockInfo {
  deviceId: string;
  deviceName: string;
  ts: number;
}

export interface LastSync {
  /** Local wall-clock time of our last completed sync. */
  at: number;
  /** uploadedAt of the remote backup we last uploaded/downloaded. */
  remoteUploadedAt: number;
}

export type SyncAction = 'upload' | 'download' | 'none' | 'cancelled';
export interface SyncResult {
  action: SyncAction;
  message: string;
}
export type ConflictChoice = 'download' | 'keep' | 'abort';

/** Thrown when another device holds a fresh sync lock in Drive. */
export class LockBusyError extends Error {
  constructor(public lock: LockInfo) {
    super(
      `Outro dispositivo está sincronizando agora ("${lock.deviceName}"). ` +
        'A trava no Drive expira sozinha em alguns minutos — tente novamente.'
    );
    this.name = 'LockBusyError';
  }
}

/* ── Local backup store (IndexedDB) — safety net before replacing data ───── */

const BACKUP_DB = 'runora_sync_backups';
const BACKUP_STORE = 'backups';
let backupDbPromise: Promise<IDBDatabase> | null = null;

function openBackupDb(): Promise<IDBDatabase> {
  if (!backupDbPromise) {
    backupDbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(BACKUP_DB, 1);
      req.onupgradeneeded = () => {
        if (!req.result.objectStoreNames.contains(BACKUP_STORE)) {
          req.result.createObjectStore(BACKUP_STORE);
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  return backupDbPromise;
}

async function backupKeys(): Promise<string[]> {
  const db = await openBackupDb();
  return new Promise((resolve, reject) => {
    const req = db.transaction(BACKUP_STORE, 'readonly').objectStore(BACKUP_STORE).getAllKeys();
    req.onsuccess = () => resolve((req.result as IDBValidKey[]).map(String));
    req.onerror = () => reject(req.error);
  });
}

async function saveLocalBackup(key: string, blob: Blob): Promise<void> {
  const db = await openBackupDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(BACKUP_STORE, 'readwrite');
    tx.objectStore(BACKUP_STORE).put(blob, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  // keep at most MAX_LOCAL_BACKUPS
  const keys = (await backupKeys()).sort();
  const excess = keys.slice(0, Math.max(0, keys.length - MAX_LOCAL_BACKUPS));
  if (excess.length > 0) {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(BACKUP_STORE, 'readwrite');
      for (const k of excess) tx.objectStore(BACKUP_STORE).delete(k);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }
}

async function getLatestLocalBackup(): Promise<{ key: string; blob: Blob } | null> {
  const keys = (await backupKeys()).sort();
  if (keys.length === 0) return null;
  const last = keys[keys.length - 1];
  const db = await openBackupDb();
  const blob = await new Promise<Blob | null>((resolve, reject) => {
    const req = db.transaction(BACKUP_STORE, 'readonly').objectStore(BACKUP_STORE).get(last);
    req.onsuccess = () => resolve((req.result as Blob) ?? null);
    req.onerror = () => reject(req.error);
  });
  return blob ? { key: last, blob } : null;
}

/** Keys of local safety backups (oldest → newest), for UI/debugging. */
export async function listLocalBackups(): Promise<string[]> {
  return (await backupKeys()).sort();
}

/* ── Small helpers ───────────────────────────────────────────────────────── */

function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.min(units.length - 1, Math.floor(Math.log(n) / Math.log(1024)));
  return `${(n / 1024 ** i).toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

function getDeviceName(): string {
  const ua = navigator.userAgent;
  if (/Android/i.test(ua)) return 'Android';
  if (/Windows/i.test(ua)) return 'Windows';
  if (/Macintosh|Mac OS/i.test(ua)) return 'Mac';
  if (/Linux/i.test(ua)) return 'Linux';
  return navigator.platform || 'Dispositivo';
}

/* ── Google Identity Services (token client) ─────────────────────────────── */

let gisLoading: Promise<void> | null = null;

function loadGis(): Promise<void> {
  const w = window as unknown as {
    google?: { accounts?: { oauth2?: Record<string, unknown> } };
  };
  if (w.google?.accounts?.oauth2) return Promise.resolve();
  if (!gisLoading) {
    gisLoading = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'https://accounts.google.com/gsi/client';
      s.async = true;
      s.defer = true;
      s.onload = () => resolve();
      s.onerror = () => {
        gisLoading = null;
        reject(new Error('Não foi possível carregar o login do Google (verifique a conexão com a internet).'));
      };
      document.head.appendChild(s);
    });
  }
  return gisLoading;
}

/* ── Drive REST helpers ──────────────────────────────────────────────────── */

async function api(token: string, path: string, init?: RequestInit): Promise<Response> {
  const res = await fetch(`https://www.googleapis.com${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      ...((init?.headers as Record<string, string> | undefined) ?? {}),
    },
  });
  if (res.status === 401) {
    localStorage.removeItem(LS.TOKEN);
    throw new Error('Sessão do Google expirada. Reconecte a conta na aba Sync.');
  }
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Erro na API do Google Drive (${res.status}): ${body.slice(0, 200)}`);
  }
  return res;
}

interface DriveFileInfo {
  id: string;
  name: string;
  modifiedTime: string;
  size?: string;
}

async function findFile(token: string, name: string): Promise<DriveFileInfo | null> {
  const q = encodeURIComponent(`name = '${name}' and trashed = false`);
  const res = await api(
    token,
    `/drive/v3/files?q=${q}&fields=files(id,name,modifiedTime,size)&pageSize=10&spaces=drive,appDataFolder`
  );
  const data = (await res.json()) as { files?: DriveFileInfo[] };
  return data.files?.[0] ?? null;
}

async function downloadFile(token: string, id: string): Promise<Blob> {
  return (await api(token, `/drive/v3/files/${id}?alt=media`)).blob();
}

/** Resumable upload (works for large .colpkg files with media). */
async function uploadResumable(
  token: string,
  name: string,
  blob: Blob,
  existingId?: string
): Promise<string> {
  const url = existingId
    ? `https://www.googleapis.com/upload/drive/v3/files/${existingId}?uploadType=resumable`
    : `https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable`;
  const initRes = await fetch(url, {
    method: existingId ? 'PATCH' : 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json; charset=UTF-8',
      'X-Upload-Content-Type': blob.type || 'application/octet-stream',
      'X-Upload-Content-Length': String(blob.size),
    },
    body: JSON.stringify(existingId ? {} : { name }),
  });
  if (!initRes.ok) {
    throw new Error(`Drive: falha ao iniciar upload (${initRes.status})`);
  }
  const location = initRes.headers.get('Location');
  if (!location) throw new Error('Drive: resposta de upload resumable sem Location.');
  const putRes = await fetch(location, {
    method: 'PUT',
    headers: {
      'Content-Type': blob.type || 'application/octet-stream',
      'Content-Length': String(blob.size),
    },
    body: blob,
  });
  if (!putRes.ok) {
    throw new Error(`Drive: falha no envio do arquivo (${putRes.status})`);
  }
  const data = (await putRes.json()) as { id?: string };
  if (!data.id) throw new Error('Drive: upload concluído sem id de arquivo.');
  return data.id;
}

/** Multipart upload for small JSON files (meta, lock). */
async function uploadMultipart(
  token: string,
  name: string,
  blob: Blob,
  existingId?: string
): Promise<string> {
  const fd = new FormData();
  fd.append('metadata', new Blob([JSON.stringify({ name })], { type: 'application/json' }));
  fd.append('media', blob);
  const path = existingId
    ? `/upload/drive/v3/files/${existingId}?uploadType=multipart`
    : `/upload/drive/v3/files?uploadType=multipart`;
  const res = await api(token, path, { method: existingId ? 'PATCH' : 'POST', body: fd });
  const data = (await res.json()) as { id?: string };
  if (!data.id) throw new Error('Drive: upload de metadados sem id.');
  return data.id;
}

/* ── Cross-device lock ───────────────────────────────────────────────────── */

async function acquireLock(token: string): Promise<void> {
  const lockFile = await findFile(token, DRIVE_FILES.LOCK);
  if (lockFile) {
    try {
      const info = JSON.parse(await (await downloadFile(token, lockFile.id)).text()) as LockInfo;
      if (info.deviceId !== DriveSyncService.getDeviceId() && Date.now() - info.ts < LOCK_TTL_MS) {
        throw new LockBusyError(info);
      }
    } catch (e) {
      if (e instanceof LockBusyError) throw e;
      // unreadable/stale lock file — treat as absent
    }
  }
  const info: LockInfo = {
    deviceId: DriveSyncService.getDeviceId(),
    deviceName: getDeviceName(),
    ts: Date.now(),
  };
  await uploadMultipart(
    token,
    DRIVE_FILES.LOCK,
    new Blob([JSON.stringify(info)], { type: 'application/json' }),
    lockFile?.id
  );
}

async function releaseLock(token: string): Promise<void> {
  try {
    const lockFile = await findFile(token, DRIVE_FILES.LOCK);
    if (lockFile) {
      await api(token, `/drive/v3/files/${lockFile.id}`, { method: 'DELETE' });
    }
  } catch {
    // best-effort: the lock expires via TTL anyway
  }
}

/* ── Service ─────────────────────────────────────────────────────────────── */

export class DriveSyncService {
  /* ── persisted settings / session ── */

  /** Custom Client ID (Settings override) or the built-in default. */
  public static getClientId(): string {
    return localStorage.getItem(LS.CLIENT_ID)?.trim() || DEFAULT_GOOGLE_CLIENT_ID;
  }

  /** True when the user set a custom Client ID instead of the built-in one. */
  public static hasCustomClientId(): boolean {
    return !!localStorage.getItem(LS.CLIENT_ID)?.trim();
  }

  public static setClientId(v: string): void {
    if (v.trim()) localStorage.setItem(LS.CLIENT_ID, v.trim());
    else localStorage.removeItem(LS.CLIENT_ID); // empty → back to the built-in default
  }

  public static getAccount(): DriveToken | null {
    try {
      const raw = localStorage.getItem(LS.TOKEN);
      return raw ? (JSON.parse(raw) as DriveToken) : null;
    } catch {
      return null;
    }
  }

  public static isConnected(): boolean {
    return this.getAccount() !== null;
  }

  public static disconnect(): void {
    localStorage.removeItem(LS.TOKEN);
  }

  public static getAutoSync(): boolean {
    return localStorage.getItem(LS.AUTO_SYNC) !== '0'; // default on
  }

  public static setAutoSync(on: boolean): void {
    localStorage.setItem(LS.AUTO_SYNC, on ? '1' : '0');
  }

  public static getDeviceId(): string {
    let id = localStorage.getItem(LS.DEVICE_ID);
    if (!id) {
      id =
        typeof crypto !== 'undefined' && 'randomUUID' in crypto
          ? crypto.randomUUID()
          : `dev-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      localStorage.setItem(LS.DEVICE_ID, id);
    }
    return id;
  }

  public static getDeviceName(): string {
    return getDeviceName();
  }

  public static getLastSync(): LastSync | null {
    try {
      const raw = localStorage.getItem(LS.LAST_SYNC);
      return raw ? (JSON.parse(raw) as LastSync) : null;
    } catch {
      return null;
    }
  }

  private static setLastSync(v: LastSync): void {
    localStorage.setItem(LS.LAST_SYNC, JSON.stringify(v));
  }

  public static isRunning(): boolean {
    return localStorage.getItem(LS.RUNNING) === '1';
  }

  /* ── auth ── */

  /** Interactive connect (consent). Returns the account email when available. */
  public static async connect(clientIdOverride?: string): Promise<string> {
    const clientId = (clientIdOverride || this.getClientId()).trim();
    if (!clientId) {
      throw new Error(
        'Nenhum Client ID configurado neste build. Cole um Client ID em Configurações ⚙ → Geral → ' +
          'Google Drive → “Client ID personalizado” (o Client ID padrão do app é embutido pelo desenvolvedor).'
      );
    }
    const token = await this.requestToken(clientId, 'consent');
    return token.email || 'conta conectada';
  }

  /** Valid access token, silently refreshing via GIS when expired. */
  public static async ensureToken(): Promise<string> {
    const t = this.getAccount();
    if (t && t.expiresAt > Date.now() + 30_000) return t.accessToken;
    const clientId = this.getClientId();
    if (!clientId) {
      throw new Error('Conta do Google Drive não conectada. Abra a aba Sync e toque em "Conectar conta Google".');
    }
    try {
      const fresh = await this.requestToken(clientId, '');
      return fresh.accessToken;
    } catch {
      localStorage.removeItem(LS.TOKEN);
      throw new Error('Sessão do Google expirada. Abra a aba Sync e reconecte sua conta.');
    }
  }

  private static async requestToken(clientId: string, prompt: '' | 'consent'): Promise<DriveToken> {
    await loadGis();
    const w = window as unknown as {
      google: {
        accounts: {
          oauth2: {
            initTokenClient: (cfg: Record<string, unknown>) => {
              callback: (r: Record<string, unknown>) => void;
              requestAccessToken: (opts: { prompt: string }) => void;
            };
          };
        };
      };
    };
    const client = w.google.accounts.oauth2.initTokenClient({
      client_id: clientId,
      scope: DRIVE_SCOPE,
      callback: () => {},
    });
    const resp = await new Promise<Record<string, unknown>>((resolve, reject) => {
      client.callback = (r) => (r && r.error ? reject(new Error(String(r.error_description || r.error))) : resolve(r));
      client.requestAccessToken({ prompt });
    });
    const token: DriveToken = {
      accessToken: String(resp.access_token),
      expiresAt: Date.now() + Number(resp.expires_in || 3600) * 1000 - 60_000,
    };
    try {
      const u = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
        headers: { Authorization: `Bearer ${token.accessToken}` },
      });
      if (u.ok) token.email = (await u.json() as { email?: string }).email;
    } catch {
      /* email is best-effort */
    }
    localStorage.setItem(LS.TOKEN, JSON.stringify(token));
    return token;
  }

  /* ── remote state ── */

  /** Info about the backup currently in Drive (null when none). */
  public static async getRemoteInfo(): Promise<{ meta: SyncMeta; size: number } | null> {
    const token = await this.ensureToken();
    const metaFile = await findFile(token, DRIVE_FILES.META);
    if (!metaFile) return null;
    const pkgFile = await findFile(token, DRIVE_FILES.COLPKG);
    const meta = JSON.parse(await (await downloadFile(token, metaFile.id)).text()) as SyncMeta;
    return { meta, size: Number(pkgFile?.size || 0) };
  }

  /**
   * Last local modification across decks/noteTypes/notes/cards/presets/revlog.
   * Compared against lastSync.at to decide "this device has unsynced changes".
   */
  public static computeLocalModifiedAt(): number {
    let m = 0;
    const bump = (v?: number) => {
      if (typeof v === 'number' && Number.isFinite(v) && v > m) m = v;
    };
    StorageService.getDecks().forEach((d) => bump(d.updatedAt));
    StorageService.getNoteTypes().forEach((t) => bump(t.updatedAt));
    StorageService.getNotes().forEach((n) => bump(n.updatedAt));
    StorageService.getCards().forEach((c) => bump(c.updatedAt));
    StorageService.getPresets().forEach((p) => bump(p.updatedAt));
    StorageService.getRevlog().forEach((r) => bump(r.reviewTime));
    return m;
  }

  /* ── sync orchestration ── */

  public static async syncNow(opts?: {
    onConflict?: (meta: SyncMeta) => Promise<ConflictChoice>;
    onProgress?: (msg: string) => void;
  }): Promise<SyncResult> {
    if (this.isRunning()) {
      return { action: 'cancelled', message: 'Uma sincronização já está em andamento neste dispositivo.' };
    }
    localStorage.setItem(LS.RUNNING, '1');
    const progress = opts?.onProgress ?? (() => {});
    try {
      const token = await this.ensureToken();

      progress('Verificando trava de sincronização no Drive…');
      await acquireLock(token);
      try {
        const metaFile = await findFile(token, DRIVE_FILES.META);
        const remoteMeta = metaFile
          ? (JSON.parse(await (await downloadFile(token, metaFile.id)).text()) as SyncMeta)
          : null;

        const lastSync = this.getLastSync();
        const localMod = this.computeLocalModifiedAt();
        const lastAt = lastSync?.at ?? 0;
        const lastRemote = lastSync?.remoteUploadedAt ?? 0;

        if (!remoteMeta) {
          // first sync ever: just upload
          return await this.uploadBackup(token, progress);
        }

        if (remoteMeta.uploadedAt <= lastRemote) {
          // remote is the version we already synced
          if (localMod > lastAt) return await this.uploadBackup(token, progress);
          return { action: 'none', message: 'Tudo sincronizado — nenhuma mudança neste dispositivo desde o último sync.' };
        }

        // remote backup is newer than anything we have synced
        if (localMod > lastAt) {
          const choice = (await opts?.onConflict?.(remoteMeta)) ?? 'abort';
          if (choice === 'download') return await this.downloadBackup(token, remoteMeta, progress);
          if (choice === 'keep') {
            progress('Mantendo os dados deste dispositivo — o backup no Drive será substituído…');
            return await this.uploadBackup(token, progress);
          }
          return { action: 'cancelled', message: 'Sincronização cancelada. Nada foi alterado.' };
        }
        return await this.downloadBackup(token, remoteMeta, progress);
      } finally {
        await releaseLock(token);
      }
    } finally {
      localStorage.removeItem(LS.RUNNING);
    }
  }

  /* ── upload / download ── */

  private static async uploadBackup(token: string, progress: (m: string) => void): Promise<SyncResult> {
    progress('Exportando coleção completa + mídia…');
    const { blob } = await ExportImportService.buildCollectionPackage();

    const meta: SyncMeta = {
      app: 'runora',
      version: 1,
      uploadedAt: Date.now(),
      deviceId: this.getDeviceId(),
      deviceName: getDeviceName(),
      appVersion: pkg.version,
      counts: {
        decks: StorageService.getDecks().length,
        notes: StorageService.getNotes().length,
        cards: StorageService.getCards().length,
        noteTypes: StorageService.getNoteTypes().length,
        media: (await MediaStore.list()).length,
        revlog: StorageService.getRevlog().length,
      },
    };

    progress(`Enviando backup (${formatBytes(blob.size)}) para o Google Drive…`);
    const existing = await findFile(token, DRIVE_FILES.COLPKG);
    await uploadResumable(token, DRIVE_FILES.COLPKG, blob, existing?.id);

    const metaExisting = await findFile(token, DRIVE_FILES.META);
    await uploadMultipart(
      token,
      DRIVE_FILES.META,
      new Blob([JSON.stringify(meta, null, 2)], { type: 'application/json' }),
      metaExisting?.id
    );

    this.setLastSync({ at: Date.now(), remoteUploadedAt: meta.uploadedAt });
    return {
      action: 'upload',
      message:
        `Backup enviado ao Drive: ${meta.counts.decks} decks, ${meta.counts.notes} notas, ` +
        `${meta.counts.cards} cards, ${meta.counts.media} arquivos de mídia (${formatBytes(blob.size)}).`,
    };
  }

  private static async downloadBackup(
    token: string,
    remoteMeta: SyncMeta,
    progress: (m: string) => void
  ): Promise<SyncResult> {
    const pkg = await findFile(token, DRIVE_FILES.COLPKG);
    if (!pkg) {
      throw new Error('Há metadados no Drive, mas o arquivo de backup (.colpkg) não foi encontrado.');
    }
    progress(`Baixando backup de "${remoteMeta.deviceName}" (${formatBytes(Number(pkg.size || 0))})…`);
    const blob = await downloadFile(token, pkg.id);

    progress('Guardando um backup local de segurança antes de substituir…');
    try {
      const current = await ExportImportService.buildCollectionPackage();
      await saveLocalBackup(`antes-de-baixar-${Date.now()}`, current.blob);
    } catch (e) {
      console.warn('Não foi possível salvar o backup local (seguindo mesmo assim):', e);
    }

    progress('Substituindo os dados deste dispositivo pelo backup baixado…');
    await MediaStore.clear();
    const file = new File([blob], DRIVE_FILES.COLPKG, { type: 'application/octet-stream' });
    const res = await ExportImportService.importPackage(file);
    if (!res.success) {
      // rollback from the local backup taken above
      try {
        const backup = await getLatestLocalBackup();
        if (backup) {
          await MediaStore.clear();
          await ExportImportService.importPackage(
            new File([backup.blob], DRIVE_FILES.COLPKG, { type: 'application/octet-stream' })
          );
        }
      } catch (e) {
        console.error('Rollback do backup local falhou:', e);
      }
      throw new Error(res.message || 'Falha ao aplicar o backup baixado do Drive.');
    }

    this.setLastSync({
      at: Math.max(Date.now(), remoteMeta.uploadedAt),
      remoteUploadedAt: remoteMeta.uploadedAt,
    });
    return {
      action: 'download',
      message:
        `Backup de "${remoteMeta.deviceName}" restaurado neste dispositivo. ${res.message} ` +
        'O estado anterior deste dispositivo foi guardado como backup local de segurança.',
    };
  }
}
