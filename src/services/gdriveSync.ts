/**
 * DriveSyncService — sync with Google Drive, no paid hosting required.
 *
 * How it works (sync on the user's own free Drive, no paid hosting):
 * - The app ships a built-in OAuth "Web application" Client ID, created by the
 *   Runora project on Google Cloud; the user just clicks "Conectar conta
 *   Google". A custom Client ID can be pasted in Settings to override it.
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
import { Deck, NoteType, Note, Card, RevlogEntry, Preset } from '../types/runora';
import { StorageService } from './storage';
import {
  bumpTally,
  emptySyncTally,
  tallyFromCounts,
  tallySent,
  tallyReceived,
  tallyUpFromLocalDiff,
  type SyncTally,
} from './syncTally';
// Re-exporta (mesma assinatura pública) — sem `export ... from` duplicando
// nomes que o parser do Vite reclama com o import local acima.
export { bumpTally, emptySyncTally, tallyFromCounts, tallySent, tallyReceived };
export type { SyncTally };

import {
  countDriveCall,
  SyncTiming,
  setActiveTiming,
  getActiveTiming,
  resetDriveCallCount,
} from './syncTiming';
import {
  getCachedFolderId,
  setCachedFolderId,
  getCachedFileId,
  setCachedFileId,
  deleteCachedFileId,
  markFileAbsent,
  clearFileAbsent,
  isFileMarkedAbsent,
  isMigrationDone,
  setMigrationDone,
} from './driveCache';
import { MediaStore } from './mediaStore';
import { ExportImportService } from './exportImport';
import type { ImportableCollection } from './importPlan';
import {
  applyRemoteItems,
  applyRemoteItemsProgressive,
  mergeRemoteRevlog,
  summarizeApply,
  type RemoteSyncData,
} from './syncApply';
import {
  collectionSyncContent,
  computeSnapshot,
  diffSnapshots,
  getSyncBase,
  hashValue,
  localSyncContent,
  setSyncBase,
  SETTINGS_KEYS,
  type SyncItemInfo,
  type SyncDiff,
  type SyncSnapshot,
} from './syncItems';
import {
  applyExtrasPayload,
  buildExtrasPayload,
  decideSyncSide,
  hashExtras,
  refreshThemeInDom,
  type SyncAddonsIndex,
  type SyncAddonEntry,
  type SyncExtrasFile,
  type SyncExtrasPayload,
  type SyncSideBase,
} from './syncExtras';
import {
  buildDelta,
  applyDelta,
  applyDeltaToCollection,
  mergeDeltas,
  isValidDelta,
  type SyncDelta,
  type DeltaMeta,
  type SyncState,
  syncStateToDeltaMeta,
} from './syncDelta';
import { isOldFormatBackup, OLD_DEVICE_WARNING } from './syncFormat';
import {
  computeAddonState,
  exportAddonPackage,
  exportAddonPackageBlob,
  importAddonPackage,
  listAddons,
  removeAddon,
  setAddonEnabled,
} from './addonStorage';
import {
  DEFAULT_AUTO_SYNC_MINUTES,
  MAX_AUTO_SYNC_MINUTES,
  MIN_AUTO_SYNC_MINUTES,
  getAutoSyncEnabled,
  getAutoSyncIntervalMinutes,
  getAutoSyncOnOpen,
  setAutoSyncEnabled,
  setAutoSyncIntervalMinutes,
  setAutoSyncOnOpen,
} from './autoSyncSettings';

export {
  DEFAULT_AUTO_SYNC_MINUTES,
  MAX_AUTO_SYNC_MINUTES,
  MIN_AUTO_SYNC_MINUTES,
};

const LS = {
  CLIENT_ID: 'runora_gdrive_client_id',
  TOKEN: 'runora_gdrive_token',
  DEVICE_ID: 'runora_device_id',
  LAST_SYNC: 'runora_last_sync',
  RUNNING: 'runora_sync_running',
  /** Fase 5: base (estado comum) dos extras e das extensões. */
  EXTRAS_BASE: 'runora_sync_extras_base',
  ADDONS_BASE: 'runora_sync_addons_base',
  /** Fase 6: último modifiedTime conhecido do arquivo STATE no Drive (fast path). */
  STATE_MODIFIED_TIME: 'runora_sync_state_modified',
  /**
   * Último modifiedTime conhecido do META no Drive. O META é reescrito em
   * TODO sync (inclusive por apps antigos) → é o marcador confiável de
   * "o Drive mudou". Sem ele, um backup vindo de um aparelho antigo
   * passaria batido no fast path.
   */
  META_MODIFIED_TIME: 'runora_sync_meta_modified',
};

/**
 * Tempo máximo que um sync pode ficar "rodando" localmente. Se o app foi
 * fechado/recarregado no meio do sync, o aviso fica preso e trava os próximos
 * syncs — depois disso, o aviso é considerado antigo e descartado.
 */
const LOCAL_RUNNING_TTL_MS = 2 * 60 * 1000;

/**
 * Built-in OAuth Client ID — the Google Cloud project of Runora, created by the
 * app developer, so users can just click "Conectar conta Google" and link their
 * own account. A custom Client ID can still be set in Settings to override this
 * (advanced). When creating the project, enable the Google Drive API and
 * register these Authorized JavaScript origins:
 *   http://localhost:3000                                          (vite dev)
 *   http://127.0.0.1:39102 … 39105, http://127.0.0.1:39110 … 39119 (Electron .exe local server)
 *   https://localhost                                              (Capacitor Android WebView)
 *   https://enzouk.github.io                                        (Runora web app, published on GitHub Pages)
 *
 * Scope used at runtime: drive.file + openid email.
 *
 * Both scopes are classified by Google as NON-SENSITIVE (see "Choose Google
 * Drive API scopes" — drive.file grants per-file access to the files the app
 * itself creates). That matters for verification:
 *   - OAuth app verification is NOT mandatory for non-sensitive scopes, so the
 *     app works for any user account, with no test-user list and without the
 *     "Google hasn't verified this app" warning.
 *   - Brand verification (the optional, lighter check that demands a domain
 *     you own with a DNS TXT record) is only needed to show the app NAME and
 *     LOGO on the Google consent screen. It is NOT required for the sync to
 *     work, and it cannot pass on a shared host such as github.io.
 *   - The 100-user cap also only applies to unverified apps requesting
 *     sensitive/restricted scopes.
 *
 * If a scope is ever changed here, re-check its classification before assuming
 * the app still ships without verification: sensitive scopes need a demo video,
 * a scope justification and an approved verification request.
 */
export const DEFAULT_GOOGLE_CLIENT_ID =
  '209118424285-9pc42j7taleit3fobb8bof5ig11srp7j.apps.googleusercontent.com';

export const DRIVE_FILES = {
  COLPKG: 'runora-sync.colpkg',
  META: 'runora-sync-meta.json',
  LOCK: 'runora-sync.lock.json',
  /** Fase 5: preferências + temas. */
  EXTRAS: 'runora-sync-extras.json',
  /** Fase 5: índice das extensões. */
  ADDONS_INDEX: 'runora-sync-addons.json',
  /** Fase 5: as extensões completas (código + config). */
  ADDONS_ZIP: 'runora-sync-addons.zip',
  /** Fase 7: sync incremental (delta). */
  DELTA_META: 'runora-sync-delta-meta.json',
  DELTA_PAYLOAD: 'runora-sync-delta.json',
  DELTA_MEDIA_MANIFEST: 'runora-sync-media-manifest.json',
  /** Fase 8: estado unificado do sync incremental (substitui delta-meta + delta + media-manifest + partes incrementais do META). */
  STATE: 'runora-sync-state.json',
  /** Pasta para arquivos de mídia do sync incremental. */
  MEDIA_FOLDER: 'runora-sync-media/',
} as const;

/** All sync files live inside this folder at the root of the user's Drive. */
export const DRIVE_FOLDER = 'Runora';

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
  /** Hash das preferências+temas (para pular download se não mudou). */
  extrasHash?: string;
  /** Hash das extensões (para pular download se não mudou). */
  addonsHash?: string;
  /**
   * Marcador do formato de sync do último upload.
   *
   * - `'state'`: o app que escreveu este META conhece o arquivo de estado
   *   unificado (`runora-sync-state.json`) → o sync incremental é confiável.
   * - ausente: o META foi escrito por um app ANTIGO (que só sobe `.colpkg`)
   *   → o backup completo no Drive é a fonte da verdade e a mescla precisa
   *   ser refeita por inteiro.
   *
   * É esse marcador (e não a data do arquivo) que diz com segurança se o
   * backup do Drive veio de um aparelho atualizado.
   */
  syncFormat?: 'state';
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
  /** true quando a sincronização falhou (a mensagem é o erro). */
  error?: boolean;
}
export type ConflictChoice = 'download' | 'keep' | 'abort';

/** Escolha do usuário numa disputa item a item. */
export type SyncItemsChoice = 'local' | 'remote' | 'abort';

/** Etapa do sync/restauração para o painel de progresso (mesma cara do import). */
export interface SyncProgressState {
  phase: 'preparing' | 'download' | 'comparing' | 'applying' | 'upload';
  /**
   * Contadores ao vivo estilo Anki (↑ enviado daqui · ↓ recebido da nuvem),
   * ACUMULADOS desde o início do sync — o painel só exibe.
   */
  tally?: SyncTally;
  /** Nome do dispositivo dono do backup (fase download). */
  deviceName?: string;
  /** Contador ao vivo da fase 'applying' (e da mídia na preparação). */
  part?: 'notes' | 'cards' | 'decks' | 'deletes' | 'settings' | 'media' | 'addons';
  done?: number;
  total?: number;
  /**
   * Quantos itens (decks/notas/cards/mídia/extensões) estão sendo baixados
   * ou enviados. O contador conta ITENS — nunca bytes.
   */
  counts?: {
    decks?: number;
    notes?: number;
    cards?: number;
    media?: number;
    addons?: number;
    settings?: number;
  };
}

/** Resultado da parte "coleção" do sync (antes dos extras da Fase 5). */
interface SyncCollectionOutcome extends SyncResult {
  /** O tema daqui foi mantido (disputa resolvida com "ficar com o daqui"). */
  keepLocalTheme?: boolean;
  /** As preferências daqui foram mantidas. */
  keepLocalPrefs?: boolean;
}

export interface SyncItemsConflict {
  /** Itens alterados nos dois lados. */
  items: SyncItemInfo[];
  /** Nome do dispositivo que está no Drive. */
  remoteDeviceName: string;
}

/** Conflito esperando decisão (badge no botão Sync). */
export interface PendingConflict {
  count: number;
  at: number;
  deviceName: string;
}

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
      // o script pode nunca carregar (sem internet) — não trava o app
      const timer = setTimeout(() => {
        gisLoading = null;
        s.remove();
        reject(new Error('O login do Google demorou demais para carregar. Verifique a internet.'));
      }, GIS_LOAD_TIMEOUT_MS);
      s.onload = () => {
        clearTimeout(timer);
        resolve();
      };
      s.onerror = () => {
        clearTimeout(timer);
        gisLoading = null;
        reject(new Error('Não foi possível carregar o login do Google (verifique a conexão com a internet).'));
      };
      document.head.appendChild(s);
    });
  }
  return gisLoading;
}

/* ── Drive REST helpers ──────────────────────────────────────────────────── */

/** Tempo máximo de uma chamada ao Google (evita o sync travar para sempre). */
const API_TIMEOUT_MS = 30_000;

/** Tempo máximo para carregar o script de login do Google. */
const GIS_LOAD_TIMEOUT_MS = 20_000;

/**
 * fetch com limite de tempo (AbortController — funciona em qualquer WebView,
 * mesmo os mais antigos que não conhecem AbortSignal.timeout).
 */
async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number
): Promise<Response> {
  countDriveCall();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (e) {
    if ((e as Error)?.name === 'AbortError') {
      throw new Error('O Google Drive não respondeu a tempo. Verifique a internet e tente de novo.');
    }
    throw new Error(
      `Não foi possível falar com o Google Drive: ${(e as Error)?.message ?? 'sem internet?'}`
    );
  } finally {
    clearTimeout(timer);
  }
}

/** Erro da API do Drive com o status HTTP — usado para reagir a 404 (id velho). */
export class DriveApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = 'DriveApiError';
    this.status = status;
  }
}

async function api(token: string, path: string, init?: RequestInit): Promise<Response> {
  const res = await fetchWithTimeout(
    `https://www.googleapis.com${path}`,
    {
      ...init,
      headers: {
        Authorization: `Bearer ${token}`,
        ...((init?.headers as Record<string, string> | undefined) ?? {}),
      },
    },
    API_TIMEOUT_MS
  );
  if (res.status === 401) {
    localStorage.removeItem(LS.TOKEN);
    throw new Error('Sessão do Google expirada. Reconecte a conta na aba Sync.');
  }
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new DriveApiError(
      res.status,
      `Erro na API do Google Drive (${res.status}): ${body.slice(0, 200)}`
    );
  }
  return res;
}

interface DriveFileInfo {
  id: string;
  name: string;
  modifiedTime: string;
  size?: string;
  trashed?: boolean;
}

const FOLDER_MIME = 'application/vnd.google-apps.folder';

let folderIdCache: string | null = null;

/** Find or create the "Runora" folder in the user's Drive; returns its id. */
async function ensureFolder(token: string): Promise<string> {
  // 1) memória (rápido, mesma sessão)
  if (folderIdCache) return folderIdCache;
  // 2) IndexedDB (persiste entre sessões)
  const cached = await getCachedFolderId();
  if (cached) {
    folderIdCache = cached;
    return folderIdCache;
  }
  // 3) busca no Drive (primeira vez ou cache inválido)
  const q = encodeURIComponent(
    `name = '${DRIVE_FOLDER}' and mimeType = '${FOLDER_MIME}' and trashed = false`
  );
  const res = await api(token, `/drive/v3/files?q=${q}&fields=files(id,name)&pageSize=1&spaces=drive`);
  const found = (await res.json()) as { files?: Array<{ id: string }> };
  if (found.files?.[0]?.id) {
    folderIdCache = found.files[0].id;
    await setCachedFolderId(folderIdCache);
  } else {
    const create = await api(token, '/drive/v3/files', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=UTF-8' },
      body: JSON.stringify({ name: DRIVE_FOLDER, mimeType: FOLDER_MIME }),
    });
    const created = (await create.json()) as { id?: string };
    if (!created.id) throw new Error('Drive: não foi possível criar a pasta "Runora".');
    folderIdCache = created.id;
    await setCachedFolderId(folderIdCache);
  }
  // migração da raiz só se ainda não foi feita
  if (!(await isMigrationDone())) {
    await migrateRootFiles(token, folderIdCache);
    await setMigrationDone();
  }
  return folderIdCache;
}

/** One-time migration: move sync files sitting in the Drive root into the Runora folder. */
async function migrateRootFiles(token: string, folderId: string): Promise<void> {
  for (const name of Object.values(DRIVE_FILES)) {
    const q = encodeURIComponent(`name = '${name}' and trashed = false and 'root' in parents`);
    const res = await api(token, `/drive/v3/files?q=${q}&fields=files(id,name)&pageSize=5&spaces=drive`);
    const files = ((await res.json()) as { files?: Array<{ id: string }> }).files ?? [];
    for (const f of files) {
      await api(token, `/drive/v3/files/${f.id}?addParents=${folderId}&removeParents=root`, {
        method: 'PATCH',
      });
    }
  }
}

/**
 * Procura um arquivo de sync pelo nome.
 *
 * - Cache negativo: responde "não existe" com 0 chamadas quando a última
 *   listagem completa confirmou a ausência (só para nomes da lista fixa).
 * - Cache positivo: 1 chamada (files.get) para confirmar modifiedTime.
 * - Sem cache: 1 busca (query).
 *
 * `ignoreNegativeCache`: para fluxos interativos fora do sync (restaurar,
 * info remota, limpeza manual) — ali o cache negativo pode estar velho
 * (outro aparelho pode ter subido o arquivo depois do último sync).
 */
async function findFile(
  token: string,
  name: string,
  opts?: { ignoreNegativeCache?: boolean }
): Promise<DriveFileInfo | null> {
  // 0) cache NEGATIVO: a última listagem completa confirmou que o arquivo não
  //    existe no Drive → responde "não existe" com 0 chamadas.
  //    O LOCK fica de fora: ele pode aparecer a qualquer momento por outro
  //    aparelho, e confiar no "ausente" poderia criar duas travas ao mesmo
  //    tempo. Nomes de mídia (runora-sync-media/...) também não entram no
  //    cache negativo (não são re-listados a cada sync).
  const isListableName = Object.values(DRIVE_FILES).includes(
    name as (typeof DRIVE_FILES)[keyof typeof DRIVE_FILES]
  );
  if (
    !opts?.ignoreNegativeCache &&
    name !== DRIVE_FILES.LOCK &&
    isListableName &&
    (await isFileMarkedAbsent(name))
  ) {
    return null;
  }
  // 1) cache de id do arquivo
  const cachedId = await getCachedFileId(name);
  if (cachedId) {
    try {
      const res = await api(token, `/drive/v3/files/${cachedId}?fields=id,name,modifiedTime,size`);
      if (res.ok) {
        const data = (await res.json()) as DriveFileInfo;
        if (!data.trashed) return data;
      }
    } catch {
      // ignora e cai para busca
    }
    // 404 ou erro → cache inválido, remove e busca de novo
    await deleteCachedFileId(name);
  }
  // 2) busca no Drive
  const folderId = await ensureFolder(token);
  const q = encodeURIComponent(`name = '${name}' and trashed = false and '${folderId}' in parents`);
  const res = await api(
    token,
    `/drive/v3/files?q=${q}&fields=files(id,name,modifiedTime,size)&pageSize=10&spaces=drive`
  );
  const data = (await res.json()) as { files?: DriveFileInfo[] };
  const file = data.files?.[0] ?? null;
  if (file) {
    await setCachedFileId(name, file.id);
    await clearFileAbsent(name);
  } else if (isListableName && name !== DRIVE_FILES.LOCK) {
    await deleteCachedFileId(name);
    await markFileAbsent(name);
  }
  return file;
}

/**
 * Lista TODOS os arquivos de sync do Runora numa única chamada.
 * Atualiza o cache (folderId + fileIds) e retorna mapa nome → DriveFileInfo.
 * Usado para evitar múltiplas listagens (META, EXTRAS, ADDONS_INDEX, DELTA_META, etc.).
 */
async function listAllSyncFiles(
  token: string
): Promise<Record<string, DriveFileInfo>> {
  const folderId = await ensureFolder(token);
  const fileNames = Object.values(DRIVE_FILES);
  const nameClauses = fileNames.map((n) => `name = '${n}'`).join(' OR ');
  const q = encodeURIComponent(
    `(${nameClauses}) and trashed = false and '${folderId}' in parents`
  );
  const res = await api(
    token,
    `/drive/v3/files?q=${q}&fields=files(id,name,modifiedTime,size)&pageSize=50&spaces=drive`
  );
  const data = (await res.json()) as { files?: DriveFileInfo[] };
  const map: Record<string, DriveFileInfo> = {};
  const found = new Set<string>();
  if (data.files) {
    for (const f of data.files) {
      map[f.name] = f;
      found.add(f.name);
      await setCachedFileId(f.name, f.id);
      await clearFileAbsent(f.name);
    }
  }
  // cache NEGATIVO: o que a listagem inteira não trouxe, não existe no Drive.
  // É isso que invalida as marcas antigas — o retrato do Drive é refeito a
  // cada sync, então o "ausente" nunca fica velho.
  for (const n of fileNames) {
    if (!found.has(n)) {
      await deleteCachedFileId(n);
      await markFileAbsent(n);
    }
  }
  return map;
}

/** Baixa um arquivo do Drive. */
async function downloadFile(token: string, id: string): Promise<Blob> {
  return (await api(token, `/drive/v3/files/${id}?alt=media`)).blob();
}

/** Resposta de um upload: id do arquivo + modifiedTime (se o Drive devolveu). */
interface UploadResult {
  id: string;
  modifiedTime?: string;
}

/** Resumable upload (works for large .colpkg files with media). */
async function uploadResumable(
  token: string,
  name: string,
  blob: Blob,
  existingId?: string
): Promise<UploadResult> {
  const url = existingId
    ? `https://www.googleapis.com/upload/drive/v3/files/${existingId}?uploadType=resumable`
    : `https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable`;
  const initRes = await fetchWithTimeout(
    url,
    {
      method: existingId ? 'PATCH' : 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json; charset=UTF-8',
        'X-Upload-Content-Type': blob.type || 'application/octet-stream',
        'X-Upload-Content-Length': String(blob.size),
      },
      body: JSON.stringify(existingId ? {} : { name, parents: [await ensureFolder(token)] }),
    },
    API_TIMEOUT_MS
  );
  if (!initRes.ok) {
    throw new DriveApiError(initRes.status, `Drive: falha ao iniciar upload (${initRes.status})`);
  }
  const location = initRes.headers.get('Location');
  if (!location) throw new Error('Drive: resposta de upload resumable sem Location.');
  // o envio do arquivo pode demorar mais que uma chamada normal
  const putRes = await fetchWithTimeout(
    location,
    {
      method: 'PUT',
      headers: {
        'Content-Type': blob.type || 'application/octet-stream',
        'Content-Length': String(blob.size),
      },
      body: blob,
    },
    API_TIMEOUT_MS * 4
  );
  if (!putRes.ok) {
    throw new DriveApiError(putRes.status, `Drive: falha no envio do arquivo (${putRes.status})`);
  }
  const data = (await putRes.json()) as { id?: string; modifiedTime?: string };
  if (!data.id) throw new Error('Drive: upload concluído sem id de arquivo.');
  return { id: data.id, modifiedTime: data.modifiedTime };
}

/** Multipart upload for small JSON files (meta, lock). */
async function uploadMultipart(
  token: string,
  name: string,
  blob: Blob,
  existingId?: string
): Promise<UploadResult> {
  const fd = new FormData();
  const metadata: Record<string, unknown> = { name };
  if (!existingId) metadata.parents = [await ensureFolder(token)];
  fd.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));
  fd.append('media', blob);
  const path = existingId
    ? `/upload/drive/v3/files/${existingId}?uploadType=multipart`
    : `/upload/drive/v3/files?uploadType=multipart`;
  const res = await api(token, path, { method: existingId ? 'PATCH' : 'POST', body: fd });
  const data = (await res.json()) as { id?: string; modifiedTime?: string };
  if (!data.id) throw new Error('Drive: upload de metadados sem id.');
  return { id: data.id, modifiedTime: data.modifiedTime };
}

/* ── Upload com cache de id (Etapa 2) ────────────────────────────────────── */

/**
 * Id do arquivo para usar como "existingId" de upload, com 0 chamadas quando
 * o cache está quente (o normal dentro de um sync: a listagem única do início
 * acabou de popular positivo E negativo).
 *
 * - cache positivo → o id (0 chamadas; 404 depois é tratado por quem sobe)
 * - cache negativo → null (0 chamadas; o upload cria o arquivo)
 * - sem informação → findFile (1 chamada; popular o cache)
 */
async function getFileIdForUpload(token: string, name: string): Promise<string | null> {
  const cachedId = await getCachedFileId(name);
  if (cachedId) return cachedId;
  if (name !== DRIVE_FILES.LOCK && (await isFileMarkedAbsent(name))) return null;
  const file = await findFile(token, name);
  return file?.id ?? null;
}

async function rememberUploadedFileId(name: string, result: UploadResult): Promise<void> {
  await setCachedFileId(name, result.id);
  await clearFileAbsent(name);
}

/** Depois de um 404: descarta o id velho, relista tudo e recacheia. */
async function refreshIdAfterStale(token: string, name: string): Promise<string | null> {
  await deleteCachedFileId(name);
  const all = await listAllSyncFiles(token);
  return all[name]?.id ?? null;
}

/** Sobe um JSON pequeno reutilizando o id em cache; 404 → relista e recria. */
async function uploadMultipartCached(
  token: string,
  name: string,
  blob: Blob
): Promise<UploadResult> {
  const existingId = await getFileIdForUpload(token, name);
  try {
    const result = await uploadMultipart(token, name, blob, existingId ?? undefined);
    await rememberUploadedFileId(name, result);
    return result;
  } catch (e) {
    if (!(e instanceof DriveApiError) || e.status !== 404 || !existingId) throw e;
    const freshId = await refreshIdAfterStale(token, name);
    const result = await uploadMultipart(token, name, blob, freshId ?? undefined);
    await rememberUploadedFileId(name, result);
    return result;
  }
}

/** Sobe um blob grande (resumable) reutilizando o id em cache; 404 → relista e recria. */
async function uploadResumableCached(
  token: string,
  name: string,
  blob: Blob
): Promise<UploadResult> {
  const existingId = await getFileIdForUpload(token, name);
  try {
    const result = await uploadResumable(token, name, blob, existingId ?? undefined);
    await rememberUploadedFileId(name, result);
    return result;
  } catch (e) {
    if (!(e instanceof DriveApiError) || e.status !== 404 || !existingId) throw e;
    const freshId = await refreshIdAfterStale(token, name);
    const result = await uploadResumable(token, name, blob, freshId ?? undefined);
    await rememberUploadedFileId(name, result);
    return result;
  }
}

/* ── Cross-device lock ───────────────────────────────────────────────────── */

async function acquireLock(token: string): Promise<void> {
  // O LOCK nunca entra no cache negativo (pode aparecer a qualquer momento
  // por outro aparelho). Com o id em cache, porém, dá para ler o conteúdo
  // direto — sem o files.get de confirmação (1 chamada a menos).
  let lockFile: DriveFileInfo | null = null;
  const cachedLockId = await getCachedFileId(DRIVE_FILES.LOCK);
  if (cachedLockId) {
    try {
      const info = JSON.parse(await (await downloadFile(token, cachedLockId)).text()) as LockInfo;
      if (info.deviceId !== DriveSyncService.getDeviceId() && Date.now() - info.ts < LOCK_TTL_MS) {
        throw new LockBusyError(info);
      }
      // id em cache ainda é válido (a leitura funcionou)
      lockFile = { id: cachedLockId, name: DRIVE_FILES.LOCK, modifiedTime: '' };
    } catch (e) {
      if (e instanceof LockBusyError) throw e;
      // leitura falhou (id velho, lock corrompido...) → busca normal
      lockFile = await findFile(token, DRIVE_FILES.LOCK);
    }
  } else {
    lockFile = await findFile(token, DRIVE_FILES.LOCK);
  }
  const info: LockInfo = {
    deviceId: DriveSyncService.getDeviceId(),
    deviceName: getDeviceName(),
    ts: Date.now(),
  };
  const lockUpload = await uploadMultipart(
    token,
    DRIVE_FILES.LOCK,
    new Blob([JSON.stringify(info)], { type: 'application/json' }),
    lockFile?.id
  );
  // o id da trava atual vai para o cache: o releaseLock apaga sem procurar
  await rememberUploadedFileId(DRIVE_FILES.LOCK, lockUpload);
}

async function releaseLock(token: string): Promise<void> {
  try {
    // id em cache → apaga direto (1 chamada em vez de 2)
    const cachedLockId = await getCachedFileId(DRIVE_FILES.LOCK);
    if (cachedLockId) {
      await deleteCachedFileId(DRIVE_FILES.LOCK);
      try {
        await api(token, `/drive/v3/files/${cachedLockId}`, { method: 'DELETE' });
        return;
      } catch {
        // id velho → cai para a busca normal abaixo
      }
    }
    const lockFile = await findFile(token, DRIVE_FILES.LOCK);
    if (lockFile) {
      await api(token, `/drive/v3/files/${lockFile.id}`, { method: 'DELETE' });
      await deleteCachedFileId(DRIVE_FILES.LOCK);
    }
  } catch {
    // best-effort: the lock expires via TTL anyway
  }
}

/* ── Tally ao vivo (contadores ao vivo estilo Anki do painel de sync) ────── */

// Só um sync roda por vez (guarda isRunning), então um acumulador de módulo
// evita passar o tally por todas as assinaturas das funções internas.
// Fora de um sync ele fica null e os helpers viram no-op.
let activeTally: SyncTally | null = null;

/**
 * O META do Drive foi reescrito por NÓS neste sync?
 * Se sim, o modifiedTime dele vem da resposta do upload.
 * Se não, o META continua sendo o que o outro aparelho escreveu → vale o
 * modifiedTime que veio da listagem (listAllSyncFiles).
 */
let metaWrittenByUs = false;

/** Soma incrementos ao tally do sync em andamento. */
function addTally(add: Partial<SyncTally>): void {
  if (activeTally) activeTally = bumpTally(activeTally, add);
}

/** Tally ↓ a partir do resultado de aplicar itens vindos do Drive. */
function tallyFromApply(applied: {
  notes: number;
  cards: number;
  decks: number;
  presets: number;
  deleted: number;
}): Partial<SyncTally> {
  return {
    addedDown: applied.notes + applied.cards + applied.decks + applied.presets,
    removedDown: applied.deleted,
  };
}

/** Mensagem final "Sincronizado — N mudança(s) enviada(s)/recebida(s)" (estilo Anki, sem USN). */
function syncDoneMessage(t: SyncTally): string {
  const sent = tallySent(t);
  const received = tallyReceived(t);
  const parts: string[] = [];
  if (sent > 0) parts.push(sent === 1 ? '1 mudança enviada' : `${sent} mudanças enviadas`);
  if (received > 0)
    parts.push(received === 1 ? '1 mudança recebida' : `${received} mudanças recebidas`);
  return parts.length > 0 ? `Sincronizado — ${parts.join(' · ')}.` : 'Sincronizado.';
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
    return getAutoSyncEnabled();
  }

  public static setAutoSync(on: boolean): void {
    setAutoSyncEnabled(on);
  }

  /** Sincronizar ao abrir o aplicativo (opção separada do autosync). */
  public static getAutoSyncOnOpen(): boolean {
    return getAutoSyncOnOpen();
  }

  public static setAutoSyncOnOpen(on: boolean): void {
    setAutoSyncOnOpen(on);
  }

  /**
   * De quanto em quanto tempo o autosync roda — em MINUTOS.
   * O usuário pode escolher em minutos ou em horas (a UI converte).
   */
  public static getAutoSyncIntervalMinutes(): number {
    return getAutoSyncIntervalMinutes();
  }

  public static setAutoSyncIntervalMinutes(minutes: number): void {
    setAutoSyncIntervalMinutes(minutes);
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

  /** Retorna o último modifiedTime conhecido do arquivo STATE no Drive (fast path). */
  private static getStateModifiedTime(): string | null {
    try {
      return localStorage.getItem(LS.STATE_MODIFIED_TIME);
    } catch {
      return null;
    }
  }

  /** Guarda o modifiedTime do arquivo STATE após sync bem-sucedido. */
  private static setStateModifiedTime(modifiedTime: string): void {
    localStorage.setItem(LS.STATE_MODIFIED_TIME, modifiedTime);
  }

  /** Retorna o último modifiedTime conhecido do META no Drive. */
  private static getMetaModifiedTime(): string | null {
    try {
      return localStorage.getItem(LS.META_MODIFIED_TIME);
    } catch {
      return null;
    }
  }

  /** Guarda o modifiedTime do META após sync bem-sucedido. */
  private static setMetaModifiedTime(modifiedTime: string | undefined): void {
    if (modifiedTime) localStorage.setItem(LS.META_MODIFIED_TIME, modifiedTime);
  }

  /**
   * Registra o META que acabamos de escrever no Drive.
   * Guarda o modifiedTime dele para o fast path do próximo sync: se a resposta
   * do upload não trouxer a data, busca o arquivo (1 chamada) — sem isso o
   * fast path simplesmente deixa de ser usado (o sync continua correto).
   */
  private static async rememberMetaWritten(
    token: string,
    upload: UploadResult
  ): Promise<void> {
    metaWrittenByUs = true;
    if (upload.modifiedTime) {
      this.setMetaModifiedTime(upload.modifiedTime);
      return;
    }
    try {
      const fresh = await findFile(token, DRIVE_FILES.META);
      if (fresh?.modifiedTime) this.setMetaModifiedTime(fresh.modifiedTime);
    } catch {
      // ignora: otimização apenas
    }
  }

  /**
   * Há um sync rodando agora? O aviso expira depois de 10 minutos: se o app
   * foi fechado no meio do sync, o aviso preso não trava mais os próximos.
   */
  public static isRunning(): boolean {
    const raw = localStorage.getItem(LS.RUNNING);
    if (!raw) return false;
    const startedAt = Number(raw);
    if (!Number.isFinite(startedAt) || Date.now() - startedAt > LOCAL_RUNNING_TTL_MS) {
      localStorage.removeItem(LS.RUNNING);
      return false;
    }
    return true;
  }

  /** Marca o início de um sync (guarda o horário). */
  private static markRunning(): void {
    localStorage.setItem(LS.RUNNING, String(Date.now()));
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
    // fluxo interativo: ignora o cache negativo (pode estar velho)
    const metaFile = await findFile(token, DRIVE_FILES.META, { ignoreNegativeCache: true });
    if (!metaFile) return null;
    const pkgFile = await findFile(token, DRIVE_FILES.COLPKG, { ignoreNegativeCache: true });
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
    // Excluir itens não altera o updatedAt de nada que sobra na coleção —
    // sem este marcador, deletar um deck/nota/preset não acendia o botão
    // amarelo nem era detectado como mudança local.
    bump(StorageService.getLastDeletedAt());
    return m;
  }

  /* ── sync orchestration ── */

  /**
   * Sincroniza com o Drive, ITEM A ITEM (estilo Anki):
   * - mudou só aqui      → a versão daqui sobe para o Drive
   * - mudou só no Drive  → a versão do Drive entra aqui
   * - mudou nos dois     → uma única pergunta, só sobre os itens em disputa
   *
   * No sync automático (abertura do app / timer), uma disputa NÃO abre
   * popup: ela vira um badge pendente no botão Sync. No sync manual, a
   * pergunta aparece na hora.
   */
  public static async syncNow(opts?: {
    /** Disputa geral (primeira sincronização entre dispositivos). */
    onConflict?: (meta: SyncMeta) => Promise<ConflictChoice>;
    /** Disputa item a item (sync manual). */
    onItemsConflict?: (conflict: SyncItemsConflict) => Promise<SyncItemsChoice>;
    onProgress?: (msg: string) => void;
    /** Painel de progresso ao vivo (fases + contador de itens; null = fim). */
    onItemProgress?: (p: SyncProgressState | null) => void;
    /** true = sync manual (pode perguntar); false = automático (badge). */
    manual?: boolean;
  }): Promise<SyncResult> {
    if (this.isRunning()) {
      return { action: 'cancelled', message: 'Uma sincronização já está em andamento neste dispositivo.' };
    }
    this.markRunning();
    const timing = import.meta.env.DEV ? new SyncTiming() : null;
    if (timing) {
      setActiveTiming(timing);
      resetDriveCallCount();
    }
    const progress = opts?.onProgress ?? (() => {});
    const rawItemProgress = opts?.onItemProgress ?? (() => {});
    activeTally = emptySyncTally();
    metaWrittenByUs = false;
    // Cada emissão leva o tally ACUMULADO até agora — o painel só exibe.
    const itemProgress = (p: SyncProgressState | null) =>
      rawItemProgress(p ? { ...p, tally: { ...activeTally! } } : null);
    // Helper para timing: em não-dev executa direto, em dev mede
    const track = <T,>(stage: string, fn: () => Promise<T>) =>
      timing ? timing.track(stage, fn) : fn();
    try {
      const token = await track('token', () => this.ensureToken());

      // Fase 3 (nova): lista TODOS os arquivos de sync numa única chamada
      timing?.mark('list-all-files');
      const allFiles = await listAllSyncFiles(token);

      // Fase 6: Fast path — se o STATE e o META não mudaram no Drive e não há
      // mudanças locais, podemos pular o sync inteiro (sem travar, sem baixar nada).
      const stateFile = allFiles[DRIVE_FILES.STATE];
      const metaFileInList = allFiles[DRIVE_FILES.META];
      const lastStateModified = this.getStateModifiedTime();
      const lastMetaModified = this.getMetaModifiedTime();
      const driveUnchanged =
        !!stateFile?.modifiedTime &&
        stateFile.modifiedTime === lastStateModified &&
        !!metaFileInList?.modifiedTime &&
        metaFileInList.modifiedTime === lastMetaModified;
      if (driveUnchanged) {
        // STATE não mudou no Drive — verifica se há mudanças locais
        const lastSyncedUsn = this.getLastSyncedUsn();
        if (lastSyncedUsn > 0) {
          // Tem base incremental válida
          const base = getSyncBase();
          const localSnapshot = computeSnapshot(
            localSyncContent(),
            this.getDeviceId(),
            getDeviceName()
          );
          if (!this.hasLocalChanges(base, localSnapshot) && !this.hasExtrasLocalChanges()) {
            // Sem mudanças no Drive E sem mudanças locais → fast path!
            timing?.mark('fast-path');
            progress('Tudo sincronizado — nenhuma mudança desde o último sync.');
            itemProgress(null);
            localStorage.removeItem(LS.RUNNING);
            activeTally = null;
            if (timing) setActiveTiming(null);
            return { action: 'none', message: 'Tudo sincronizado — nenhuma mudança desde o último sync.' };
          }
        }
      }

      progress('Verificando trava de sincronização no Drive…');
      itemProgress({ phase: 'comparing' });
      await track('trava', () => acquireLock(token));
      try {
        // Fase 7: o backup do Drive veio de um aparelho antigo? (preenchido abaixo)
        let oldFormatDetected = false;
        const outcome = await track('colecao', async (): Promise<SyncCollectionOutcome> => {
        // ============================================================
        // Fase 7.7: Migração — primeiro sync pós-update
        // ============================================================
        // Se não há lastSyncedUsn, é o primeiro sync após o update para sync incremental.
        // Faz backfill de USN em todas as entidades existentes e inicializa lastSyncedUsn.
        const lastSyncedUsn = this.getLastSyncedUsn();
        if (lastSyncedUsn === 0) {
          progress('Primeiro sync incremental: preparando dados existentes…');
          const backfilled = StorageService.backfillUsn();
          if (backfilled > 0) {
            progress(`Backfill concluído: ${backfilled} entidades receberam USN.`);
          }
          // Após backfill, o USN atual será o "head" inicial
          this.setLastSyncedUsn(StorageService.getCurrentUsn());
        }
        timing?.mark('meta-find');
        const metaFile = allFiles[DRIVE_FILES.META] ?? null;
        const remoteMeta = metaFile
          ? (JSON.parse(await (await downloadFile(token, metaFile.id)).text()) as SyncMeta)
          : null;
        timing?.mark('meta-download');

        // Fase 4: baixa EXTRAS e ADDONS_INDEX em paralelo — mas SÓ quando o
        // hash no META diz que o conteúdo do Drive difere do daqui. O hash no
        // META é calculado por quem subiu, a partir do conteúdo: dá para
        // comparar sem baixar. Antes baixava sempre: 2 downloads desperdiçados
        // em todo sync.
        const [extrasFile, addonsIndexFile] = await Promise.all([
          allFiles?.[DRIVE_FILES.EXTRAS] ?? findFile(token, DRIVE_FILES.EXTRAS),
          allFiles?.[DRIVE_FILES.ADDONS_INDEX] ?? findFile(token, DRIVE_FILES.ADDONS_INDEX),
        ]);
        timing?.mark('extras-index-find');

        const localExtrasHash = hashExtras(buildExtrasPayload());
        const localAddonState = await computeAddonState();
        const precisaExtras =
          !!extrasFile &&
          (!remoteMeta?.extrasHash || remoteMeta.extrasHash !== localExtrasHash);
        const precisaAddons =
          !!addonsIndexFile &&
          (!remoteMeta?.addonsHash || remoteMeta.addonsHash !== localAddonState.hash);
        const [extrasContent, addonsIndexContent] = await Promise.all([
          precisaExtras && extrasFile
            ? downloadFile(token, extrasFile.id).then((r) => r.text())
            : Promise.resolve(null),
          precisaAddons && addonsIndexFile
            ? downloadFile(token, addonsIndexFile.id).then((r) => r.text())
            : Promise.resolve(null),
        ]);
        timing?.mark('extras-index-download');

        const remoteExtras: SyncExtrasFile | null = extrasContent
          ? JSON.parse(extrasContent) as SyncExtrasFile
          : null;
        const remoteAddonsIndex: SyncAddonsIndex | null = addonsIndexContent
          ? JSON.parse(addonsIndexContent) as SyncAddonsIndex
          : null;
        timing?.mark('extras-index-parse');

        // ── Fase 7: o backup do Drive veio de um aparelho ANTIGO? ──
        // O app atualizado sempre grava o marcador `syncFormat: 'state'` no
        // META. Se o META do Drive não tem esse marcador (e não foi este mesmo
        // aparelho que escreveu), ele veio de um app antigo — que só sabe
        // subir `.colpkg`. Nesse caso o backup completo é a fonte da verdade
        // e o delta incremental não serve: a mescla é refeita por inteiro.
        oldFormatDetected = isOldFormatBackup(remoteMeta, this.getDeviceId());
        if (oldFormatDetected && remoteMeta) {
          timing?.mark('old-device-detected');
          progress(
            `Backup completo de "${remoteMeta.deviceName}" (versão antiga) detectado — refazendo a mescla completa…`
          );
        }

        const lastSync = this.getLastSync();
        const base = getSyncBase();
        const localSnapshot = computeSnapshot(
          localSyncContent(),
          this.getDeviceId(),
          getDeviceName()
        );

        if (!remoteMeta) {
          // primeiro sync deste dispositivo: sobe o estado local
          itemProgress({ phase: 'preparing' });
          return await this.uploadBackup(token, progress, itemProgress, true, allFiles);
        }

        const remoteChanged = remoteMeta.uploadedAt > (lastSync?.remoteUploadedAt ?? 0);
        const localChanged = this.hasLocalChanges(base, localSnapshot);

        if (!remoteChanged && !oldFormatDetected) {
          // Disputa pendente: não sobe nada para o Drive antes da decisão.
          const pending = this.getPendingConflict();
          if (pending) {
            return {
              action: 'none',
              message:
                pending.count === 1
                  ? '1 item em disputa — resolva na aba Sync.'
                  : `${pending.count} itens em disputa — resolva na aba Sync.`,
            };
          }
          if (localChanged) {
            // ============================================================
            // Fase 7: Upload incremental (só local mudou)
            // ============================================================
            const lastSyncedUsn = this.getLastSyncedUsn();
            if (lastSyncedUsn > 0) {
              timing?.mark('upload-incremental-início');
              const newHead = await this.uploadIncremental(token, progress, itemProgress, allFiles);
              timing?.mark('upload-incremental-fim');
              if (newHead !== null) {
                // Preferências/extensões também precisam subir (Fase 5),
                // igual ao caminho de download abaixo.
                timing?.mark('extras-início');
                const extrasMsg = await this.syncExtrasAndAddons(token, progress, itemProgress, {}, allFiles, remoteMeta, remoteExtras, remoteAddonsIndex, localAddonState);
                timing?.mark('extras-fim');
                const done = syncDoneMessage(activeTally!);
                return {
                  action: 'upload',
                  message: extrasMsg ? `${done} ${extrasMsg}` : done,
                };
              }
            }
            // Fallback para full upload se incremental não disponível
            itemProgress({ phase: 'preparing' });
            timing?.mark('upload-backup');
            return await this.uploadBackup(token, progress, itemProgress);
          }
          if (!this.hasExtrasLocalChanges()) {
            // Nada mudou aqui nem no Drive (coleção, preferências, extensões):
            // grava os modifiedTimes atuais para o PRÓXIMO sync cair no fast
            // path. Antes isso só acontecia em caminhos que escreviam no Drive
            // — um sync "nada a fazer" deixava o fast path desarmado e o
            // próximo sync refazia o caminho inteiro à toa.
            this.setStateModifiedTime(stateFile.modifiedTime);
            this.setMetaModifiedTime(metaFileInList.modifiedTime);
            return { action: 'none', message: 'Tudo sincronizado — nenhuma mudança desde o último sync.' };
          }
          // Só preferências/extensões mudaram (não entram no snapshot): deixa
          // o fluxo seguir até a Fase 5 (travada), que compara e envia os extras.
        }

        // ============================================================
        // Fase 7: Download incremental (só remoto mudou)
        // ============================================================
        // Com um backup de aparelho antigo o delta não serve: o backup
        // completo é que manda → cai no caminho de mescla completa abaixo.
        if (!localChanged && !oldFormatDetected) {
          const lastSyncedUsn = this.getLastSyncedUsn();
          if (lastSyncedUsn > 0) {
            timing?.mark('download-incremental-início');
            const newHead = await this.downloadIncremental(
              token,
              progress,
              itemProgress,
              remoteMeta.uploadedAt,
              allFiles
            );
            timing?.mark('download-incremental-fim');
            if (newHead !== null) {
              // Aplica extras do Drive (fase 5) e finaliza
              timing?.mark('extras-início');
              const extrasMsg = await this.syncExtrasAndAddons(token, progress, itemProgress, {}, allFiles, remoteMeta, remoteExtras, remoteAddonsIndex, localAddonState);
              timing?.mark('extras-fim');
              const done = syncDoneMessage(activeTally!);
              return {
                action: 'download',
                message: extrasMsg ? `${done} ${extrasMsg}` : done,
              };
            }
          }
          // Fallback para download completo
        }

        // ── O Drive tem coisa nova: baixa o pacote e compara item a item ──
        progress(`Baixando dados de "${remoteMeta.deviceName}"…`);
        // o painel já mostra quantos ITENS estão vindo (do metadado do Drive)
        itemProgress({
          phase: 'download',
          deviceName: remoteMeta.deviceName,
          counts: remoteMeta.counts,
        });
        timing?.mark('download-collection-início');
        const remoteData = await this.downloadCollection(
          token,
          remoteMeta,
          progress,
          itemProgress,
          allFiles
        );
        timing?.mark('download-collection-fim');
        const remoteSnapshot = computeSnapshot(
          collectionSyncContent({
            decks: remoteData.decks,
            noteTypes: remoteData.noteTypes,
            notes: remoteData.notes,
            cards: remoteData.cards,
            presets: remoteData.presets,
            fsrsParameters: remoteData.fsrsParameters,
            settings: remoteData.settings,
          }),
          remoteMeta.deviceId,
          remoteMeta.deviceName
        );
        itemProgress({ phase: 'comparing' });

        const diff = diffSnapshots(base, localSnapshot, remoteSnapshot);
        const conflicts = diff.conflicts;

        // ── Primeira sincronização entre dispositivos (sem base) ──
        if (!base) {
          if (opts?.manual) {
            // Sync manual: a pergunta geral (o Drive tem a coleção toda).
            const choice = (await opts?.onConflict?.(remoteMeta)) ?? 'abort';
            if (choice === 'download') {
              // O Drive vence nos itens que ele traz; o que só existe aqui fica.
              const keys = new Set<string>([
                ...diff.remoteOnly.map((i) => i.key),
                ...diff.remoteDeleted.map((i) => i.key),
                ...conflicts.map((i) => i.key),
              ]);
              timing?.mark('merge-and-upload');
              return await this.mergeAndUpload(
                token,
                remoteData,
                remoteMeta,
                progress,
                keys,
                itemProgress,
                tallyUpFromLocalDiff(diff, 'remote')
              );
            }
            if (choice === 'keep') {
              itemProgress({ phase: 'preparing' });
              timing?.mark('upload-backup');
              const kept = await this.uploadBackup(token, progress, itemProgress);
              // o usuário ficou com a versão daqui — as preferências daqui valem
              return { ...kept, keepLocalTheme: true, keepLocalPrefs: true };
            }
            return { action: 'cancelled', message: 'Sincronização cancelada. Nada foi alterado.' };
          }
          // Sync automático: mescla o que não está em disputa e sinaliza o resto.
          const safeKeys = new Set<string>([
            ...diff.remoteOnly.map((i) => i.key),
            ...diff.remoteDeleted.map((i) => i.key),
          ]);
          if (conflicts.length === 0) {
            // Sem disputa: o estado mesclado sobe para o Drive.
            timing?.mark('merge-and-upload');
            return await this.mergeAndUpload(
              token,
              remoteData,
              remoteMeta,
              progress,
              safeKeys,
              itemProgress,
              tallyUpFromLocalDiff(diff)
            );
          }
          timing?.mark('apply-remote');
          const applied = await this.applyRemote(remoteData, safeKeys, itemProgress);
          this.updateBase(base, localSnapshot, remoteSnapshot, diff, safeKeys);
          this.setPendingConflict({
            count: conflicts.length,
            at: Date.now(),
            deviceName: remoteMeta.deviceName,
          });
          const parts: string[] = [];
          parts.push(
            conflicts.length === 1
              ? '1 item mudou aqui e no Drive — resolva na aba Sync.'
              : `${conflicts.length} itens mudaram aqui e no Drive — resolva na aba Sync.`
          );
          const resumo = summarizeApply(applied);
          if (resumo !== 'nada a atualizar') parts.push(`Do Drive: ${resumo}.`);
          return {
            action: 'none',
            message: parts.join(' '),
            // tema/preferências ficaram em disputa → os extras não mexem neles
            keepLocalTheme: true,
            keepLocalPrefs: true,
          };
        }

        // ── Disputa: manual pergunta, automático deixa pendente ──
        let choice: SyncItemsChoice = 'remote';
        if (conflicts.length === 0) {
          // A disputa anterior já não existe (o usuário arrumou aqui) → limpa o aviso.
          this.setPendingConflict(null);
        }
        if (conflicts.length > 0) {
          if (!opts?.manual) {
            // Auto-sync: aplica o que não está em disputa e sinaliza o resto
            const safeKeys = new Set<string>([
              ...diff.remoteOnly.map((i) => i.key),
              ...diff.remoteDeleted.map((i) => i.key),
            ]);
            timing?.mark('apply-remote');
            const applied = await this.applyRemote(remoteData, safeKeys, itemProgress);
            this.updateBase(base, localSnapshot, remoteSnapshot, diff, safeKeys);
            this.setPendingConflict({
              count: conflicts.length,
              at: Date.now(),
              deviceName: remoteMeta.deviceName,
            });
            const msg =
              conflicts.length === 1
                ? '1 item mudou aqui e no Drive — resolva na aba Sync.'
                : `${conflicts.length} itens mudaram aqui e no Drive — resolva na aba Sync.`;
            return {
              action: 'none',
              message:
                applied.notes + applied.cards > 0
                  ? `${msg} Atualizado do Drive: ${summarizeApply(applied)}.`
                  : msg,
              // tema/preferências ficaram em disputa → os extras não mexem neles
              keepLocalTheme: true,
              keepLocalPrefs: true,
            };
          }
          choice =
            (await opts?.onItemsConflict?.({
              items: conflicts,
              remoteDeviceName: remoteMeta.deviceName,
            })) ?? 'abort';
          if (choice === 'abort') {
            return { action: 'cancelled', message: 'Sincronização cancelada. Nada foi alterado.' };
          }
        }

        // ── Aplica o que veio do Drive (e a disputa, se o Drive venceu) ──
        const applyKeys = new Set<string>([
          ...diff.remoteOnly.map((i) => i.key),
          ...diff.remoteDeleted.map((i) => i.key),
        ]);
        if (choice === 'remote') {
          for (const c of conflicts) applyKeys.add(c.key);
        }
        timing?.mark('merge-and-upload');
        const result = await this.mergeAndUpload(
          token,
          remoteData,
          remoteMeta,
          progress,
          applyKeys,
          itemProgress,
          tallyUpFromLocalDiff(diff, choice)
        );
        // ── Fase 5: preferências, temas e extensões também vão para o Drive ──
        timing?.mark('extras-início');
        const extrasMsg = await this.syncExtrasAndAddons(token, progress, itemProgress, {
          keepTheme: choice === 'local' && conflicts.some((c) => c.key === SETTINGS_KEYS.theme),
          keepPrefs: choice === 'local' && conflicts.some((c) => c.key === SETTINGS_KEYS.prefs),
        }, allFiles, remoteMeta, remoteExtras, remoteAddonsIndex, localAddonState);
        timing?.mark('extras-fim');
        return {
          ...result,
          message: extrasMsg ? `${result.message} ${extrasMsg}` : result.message,
          // se a disputa foi resolvida com "ficar com o daqui", os extras
          // (preferências/temas) não podem sobrescrever a escolha
          keepLocalTheme:
            choice === 'local' && conflicts.some((c) => c.key === SETTINGS_KEYS.theme),
          keepLocalPrefs:
            choice === 'local' && conflicts.some((c) => c.key === SETTINGS_KEYS.prefs),
        };
        });
        // O META do Drive agora é o que está lá de verdade: se foi NÓS que
        // escrevemos, o modifiedTime já foi salvo no upload; se foi o outro
        // aparelho, vale o da listagem (para o fast path do próximo sync).
        if (!metaWrittenByUs) {
          this.setMetaModifiedTime(allFiles[DRIVE_FILES.META]?.modifiedTime);
        }
        if (outcome.action === 'cancelled') return outcome;
        if (oldFormatDetected) {
          return {
            ...outcome,
            message: `${outcome.message} ${OLD_DEVICE_WARNING}`,
          };
        }
        return outcome;
      } finally {
        timing?.mark('release-lock');
        await releaseLock(token);
      }
    } finally {
      timing?.mark('fim');
      // guarda o relatório para leitura posterior
      const report = timing?.getReport();
      if (report) (this as any)._lastTimingReport = report;
      itemProgress(null);
      localStorage.removeItem(LS.RUNNING);
      activeTally = null;
      if (timing) setActiveTiming(null);
      // aviso para quem observa (o badge do botão Sync precisa recalcular:
      // um sync pode ter apagado a pendência pelas costas)
      if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
        try {
          window.dispatchEvent(new CustomEvent('runora:synced'));
        } catch {
          // ignora: ambientes sem CustomEvent
        }
      }
    }
  }

  /**
   * Retorna o relatório de tempo do último sync executado (só em dev).
   * Formato: linhas com "ms calls etapa", última linha = TOTAL.
   */
  public static getLastTimingReport(): string | null {
    return (this as any)._lastTimingReport ?? null;
  }

  /* ── Fase 5: preferências, temas e extensões no Drive ─────────────────── */

  /**
   * Sincroniza os "extras" do Drive: preferências + temas (runora-sync-extras.json)
   * e as extensões (runora-sync-addons.json + .zip).
   *
   * A regra é a mesma do sync item a item: quem mudou em relação à base
   * comum leva. Num aparelho novo (sem base), o Drive ganha — assim o
   * aparelho fica igual ao outro com um clique só.
   */
  private static async syncExtrasAndAddons(
    token: string,
    progress: (m: string) => void,
    itemProgress: (p: SyncProgressState | null) => void,
    opts?: { keepTheme?: boolean; keepPrefs?: boolean },
    /** Mapa de arquivos já listados (evita listagens extras). */
    allFiles?: Record<string, DriveFileInfo>,
    /** META remoto (para checar hashes sem baixar). */
    remoteMeta?: SyncMeta,
    /** EXTRAS já baixado (Fase 4: paralelização). */
    remoteExtras?: SyncExtrasFile | null,
    /** ADDONS_INDEX já baixado (Fase 4: paralelização). */
    remoteAddonsIndex?: SyncAddonsIndex | null,
    /** Estado local das extensões já computado (Fase 4) — evita recomputar. */
    localAddonState?: { addons: SyncAddonEntry[]; hash: string }
  ): Promise<string | null> {
    const parts: string[] = [];

    // ── 1) preferências + temas ──
    try {
      itemProgress({ phase: 'comparing' });
      const local = buildExtrasPayload();
      const localHash = hashExtras(local);
      const base = this.getSideBase(LS.EXTRAS_BASE);

      // O hash no META é o hash do CONTEÚDO do Drive (calculado por quem
      // subiu, a partir do conteúdo). Antes, hash igual → pulava o download →
      // remoteHash ficava null → decideSyncSide entendia "o Drive não tem o
      // arquivo" → reenviava as preferências em TODO sync (o eterno
      // "Preferências e temas enviados ao Drive").
      if (remoteMeta?.extrasHash && remoteMeta.extrasHash === localHash) {
        // Conteúdo igual dos dois lados: nada a enviar nem aplicar — só
        // garante que a base existe (aparelho recém-conectado precisa dela).
        if (!base) {
          this.setSideBase(LS.EXTRAS_BASE, {
            hash: localHash,
            uploadedAt: remoteMeta.uploadedAt,
          });
        }
      } else {
        let remotePayload: SyncExtrasPayload | null = null;
        let remoteUploadedAt: number | undefined;
        if (remoteExtras) {
          // Já baixado na Fase 4 (só baixa quando o hash no META difere)
          remotePayload = {
            prefs: remoteExtras.prefs ?? {},
            theme: remoteExtras.theme,
            colorTheme: remoteExtras.colorTheme,
          };
          remoteUploadedAt = remoteExtras.uploadedAt;
        } else {
          // Fallback: baixa sob demanda (não deveria acontecer com Fase 4)
          const file = allFiles?.[DRIVE_FILES.EXTRAS] ?? await findFile(token, DRIVE_FILES.EXTRAS);
          let remote: SyncExtrasFile | null = null;
          if (file) {
            try {
              remote = JSON.parse(await (await downloadFile(token, file.id)).text()) as SyncExtrasFile;
            } catch {
              remote = null;
            }
          }
          if (remote) {
            remotePayload = {
              prefs: remote.prefs ?? {},
              theme: remote.theme,
              colorTheme: remote.colorTheme,
            };
            remoteUploadedAt = remote.uploadedAt;
          }
        }
        const remoteHash = remotePayload ? hashExtras(remotePayload) : null;

        const side = decideSyncSide(base?.hash ?? null, localHash, remoteHash);
        if (side === 'remote' && remotePayload) {
          itemProgress({ phase: 'applying', part: 'settings', done: 2, total: 2, counts: { settings: 2 } });
          applyExtrasPayload(remotePayload, { keepTheme: opts?.keepTheme, keepPrefs: opts?.keepPrefs });
          refreshThemeInDom(); // o tema muda a tela na hora
          // o tema/preferências agora são os mesmos dos dois lados → a base
          // precisa saber disso (senão o próximo sync acha que mudou aqui)
          this.refreshBaseSettings();
          this.setSideBase(LS.EXTRAS_BASE, {
            hash: remoteHash!,
            uploadedAt: remoteUploadedAt ?? Date.now(),
          });
          parts.push('Preferências e temas do Drive aplicados.');
        } else if (side === 'local') {
          itemProgress({ phase: 'upload', counts: { settings: 2 } });
          await this.uploadExtras(token, local);
          this.setSideBase(LS.EXTRAS_BASE, { hash: localHash, uploadedAt: Date.now() });
          parts.push('Preferências e temas enviados ao Drive.');
        }
      }
    } catch (e) {
      console.warn('Não foi possível sincronizar as preferências:', e);
    }

    // ── 2) extensões ──
    try {
      itemProgress({ phase: 'comparing' });
      const localState = localAddonState ?? (await computeAddonState());
      const base = this.getSideBase(LS.ADDONS_BASE);

      // Mesmo conserto das preferências: hash no META igual ao local = nada
      // a fazer (antes reenviava o índice vazio e dizia "Extensões removidas
      // (não há mais nenhuma aqui)" em todo sync).
      if (remoteMeta?.addonsHash && remoteMeta.addonsHash === localState.hash) {
        if (!base) {
          this.setSideBase(LS.ADDONS_BASE, {
            hash: localState.hash,
            uploadedAt: remoteMeta.uploadedAt,
          });
        }
      } else {
        let remoteIndex: SyncAddonsIndex | null = null;
        if (remoteAddonsIndex) {
          // Já baixado na Fase 4 (só baixa quando o hash no META difere)
          remoteIndex = remoteAddonsIndex;
        } else {
          // Fallback: baixa sob demanda (não deveria acontecer com Fase 4)
          const indexFile = allFiles?.[DRIVE_FILES.ADDONS_INDEX] ?? await findFile(token, DRIVE_FILES.ADDONS_INDEX);
          if (indexFile) {
            try {
              remoteIndex = JSON.parse(
                await (await downloadFile(token, indexFile.id)).text()
              ) as SyncAddonsIndex;
            } catch {
              remoteIndex = null;
            }
          }
        }
        const remoteHash = remoteIndex?.hash ?? null;

        const side = decideSyncSide(base?.hash ?? null, localState.hash, remoteHash);
        if (side === 'remote' && remoteIndex) {
          const r = await this.installRemoteAddons(token, remoteIndex, progress, itemProgress);
          if (r.ok) {
            this.setSideBase(LS.ADDONS_BASE, {
              hash: remoteHash!,
              uploadedAt: remoteIndex.uploadedAt ?? Date.now(),
            });
          }
          if (r.installed > 0) {
            parts.push(
              r.installed === 1
                ? '1 extensão do Drive instalada.'
                : `${r.installed} extensões do Drive instaladas.`
            );
          }
          if (r.removed > 0) {
            parts.push(
              r.removed === 1
                ? '1 extensão removida (não existe mais no Drive).'
                : `${r.removed} extensões removidas (não existem mais no Drive).`
            );
          }
        } else if (side === 'local') {
          const uploaded = await this.uploadAddons(token, localState, progress, itemProgress);
          this.setSideBase(LS.ADDONS_BASE, { hash: localState.hash, uploadedAt: Date.now() });
          if (uploaded > 0) {
            parts.push(
              uploaded === 1
                ? '1 extensão enviada ao Drive.'
                : `${uploaded} extensões enviadas ao Drive.`
            );
          } else if (localState.addons.length === 0) {
            parts.push('Extensões removidas (não há mais nenhuma aqui).');
          }
        }
      }
    } catch (e) {
      console.warn('Não foi possível sincronizar as extensões:', e);
    }

    return parts.length > 0 ? parts.join(' ') : null;
  }

  /** Base (hash + quando) de um arquivo do Drive (extras ou extensões). */
  private static getSideBase(key: string): SyncSideBase | null {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return null;
      const parsed = JSON.parse(raw) as SyncSideBase;
      if (!parsed || typeof parsed.hash !== 'string') return null;
      return parsed;
    } catch {
      return null;
    }
  }

  private static setSideBase(key: string, base: SyncSideBase): void {
    localStorage.setItem(key, JSON.stringify(base));
  }

  /**
   * Depois de aplicar tema/preferências que vieram do Drive, a "base" da
   * coleção precisa refletir o novo estado — senão o próximo sync acha que
   * mudou aqui e reenvia a coleção inteira à toa.
   */
  private static refreshBaseSettings(): void {
    const base = getSyncBase();
    if (!base) return;
    const local = computeSnapshot(
      localSyncContent(),
      this.getDeviceId(),
      getDeviceName()
    );
    const items = { ...base.items };
    for (const key of [SETTINGS_KEYS.prefs, SETTINGS_KEYS.theme]) {
      const state = local.items[key];
      if (state) items[key] = state;
    }
    setSyncBase({ ...base, items });
  }

  /** Sobe as preferências + temas para o Drive. */
  private static async uploadExtras(token: string, payload: SyncExtrasPayload): Promise<void> {
    const file: SyncExtrasFile = {
      app: 'runora',
      version: 1,
      uploadedAt: Date.now(),
      deviceId: this.getDeviceId(),
      deviceName: getDeviceName(),
      ...payload,
    };
    const existing = await getFileIdForUpload(token, DRIVE_FILES.EXTRAS);
    await uploadMultipart(
      token,
      DRIVE_FILES.EXTRAS,
      new Blob([JSON.stringify(file, null, 2)], { type: 'application/json' }),
      existing ?? undefined
    );
  }

  /** Sobe as extensões (índice + zip) para o Drive. */
  private static async uploadAddons(
    token: string,
    state: { addons: SyncAddonsIndex['addons']; hash: string },
    progress: (m: string) => void,
    itemProgress: (p: SyncProgressState | null) => void
  ): Promise<number> {
    // o zip vai primeiro; o índice (que aponta para o zip) é o último
    if (state.addons.length > 0) {
      progress('Enviando as extensões para o Drive…');
      itemProgress({ phase: 'upload', counts: { addons: state.addons.length } });

      const pkg = await exportAddonPackage();
      if (pkg) {
        const zipBlob = new Blob([pkg.bytes.slice()], { type: 'application/zip' });
        await uploadResumableCached(token, DRIVE_FILES.ADDONS_ZIP, zipBlob);
      }
    } else {
      // conjunto vazio subindo: a exclusão (índice vazio) também é um envio
      itemProgress({ phase: 'upload', counts: {} });
    }

    const index: SyncAddonsIndex = {
      app: 'runora',
      version: 1,
      uploadedAt: Date.now(),
      deviceId: this.getDeviceId(),
      deviceName: getDeviceName(),
      addons: state.addons,
      hash: state.hash,
    };
    await uploadMultipartCached(
      token,
      DRIVE_FILES.ADDONS_INDEX,
      new Blob([JSON.stringify(index, null, 2)], { type: 'application/json' })
    );

    // sem nenhuma extensão: o índice vazio já avisa o outro aparelho
    return state.addons.length;
  }

  /**
   * Baixa as extensões do Drive e instala (guarda as atuais em backup local
   * antes de qualquer substituição).
   *
   * O Drive manda no conjunto todo: as extensões que existem aqui e não lá
   * são removidas — assim o aparelho fica igual ao outro.
   */
  private static async installRemoteAddons(
    token: string,
    index: SyncAddonsIndex,
    progress: (m: string) => void,
    itemProgress: (p: SyncProgressState | null) => void
  ): Promise<{ installed: number; removed: number; ok: boolean }> {
    const remoteIds = new Set(index.addons.map((a) => a.id));

    // Segurança: as extensões atuais ficam guardadas antes de trocar
    try {
      const backup = await exportAddonPackageBlob();
      if (backup) await saveLocalBackup(`addons-antes-do-sync-${Date.now()}`, backup);
    } catch (e) {
      console.warn('Não foi possível salvar o backup das extensões (seguindo mesmo assim):', e);
    }

    let installed = 0;

    if (index.addons.length > 0) {
      progress('Baixando as extensões do Drive…');
      itemProgress({ phase: 'download', counts: { addons: index.addons.length } });

      const zipFile = await findFile(token, DRIVE_FILES.ADDONS_ZIP);
      if (!zipFile) return { installed: 0, removed: 0, ok: false };
      const bytes = new Uint8Array(await (await downloadFile(token, zipFile.id)).arrayBuffer());

      const res = await importAddonPackage(bytes);
      if (!res.ok) {
        console.warn('Não foi possível instalar as extensões do Drive:', res.message);
        return { installed: 0, removed: 0, ok: false };
      }
      installed = res.count;

      // o estado ligado/desligado vem no índice
      for (let i = 0; i < index.addons.length; i++) {
        const addon = index.addons[i];
        try {
          itemProgress({
            phase: 'applying',
            part: 'addons',
            done: i + 1,
            total: index.addons.length,
            counts: { addons: index.addons.length },
          });
          await setAddonEnabled(addon.id, addon.enabled);
        } catch {
          // ignora: o addon pode não ter sido instalado
        }
      }
    }

    // as extensões que só existem aqui saem (o Drive manda no conjunto)
    let removed = 0;
    try {
      for (const addon of await listAddons()) {
        if (remoteIds.has(addon.id)) continue;
        await removeAddon(addon.id);
        removed++;
      }
    } catch (e) {
      console.warn('Não foi possível remover as extensões que não estão no Drive:', e);
    }

    try {
      const { AddonSystem } = await import('./addonSystem');
      await AddonSystem.refresh();
    } catch {
      // ignora: em ambiente sem addons
    }
    return { installed, removed, ok: true };
  }

  /** Aplica os itens remotos no dispositivo e devolve o resumo. */
  private static async applyRemote(
    remoteData: RemoteSyncData,
    keys: Set<string>,
    itemProgress: (p: SyncProgressState | null) => void = () => {}
  ) {
    const applied = await applyRemoteItemsProgressive(remoteData, keys, (p) =>
      itemProgress({ phase: 'applying', ...p })
    );
    // Contadores ↓ do que foi aplicado (o tally vai junto na próxima emissão)
    addTally(tallyFromApply(applied));
    itemProgress({ phase: 'applying' });
    mergeRemoteRevlog(remoteData.revlog ?? [], remoteData);
    // O USN é compartilhado: os itens que vieram do Drive trazem o USN do
    // aparelho que os mudou — o contador local precisa acompanhar, senão as
    // próximas edições daqui ficam "no passado" do delta.
    StorageService.adoptUsnCounter(StorageService.getMaxItemUsn());
    return applied;
  }

  /**
   * Aplica o que veio do Drive e sobe o estado mesclado de volta — assim os
   * dois dispositivos passam a ter o mesmo conteúdo.
   */
  private static async mergeAndUpload(
    token: string,
    remoteData: RemoteSyncData,
    remoteMeta: SyncMeta,
    progress: (m: string) => void,
    applyKeys: Set<string>,
    itemProgress: (p: SyncProgressState | null) => void = () => {},
    /** O que esta mescla envia daqui (↑) — calculado pela diff de quem chama. */
    upTally: Partial<SyncTally> = {}
  ): Promise<SyncResult> {
    progress('Aplicando as novidades do Drive…');
    const applied = await this.applyRemote(remoteData, applyKeys, itemProgress);
    mergeRemoteRevlog(remoteData.revlog ?? [], remoteData);
    const resumo = summarizeApply(applied);
    // ↑: só o que a mescla de fato acrescenta ao Drive (não a coleção inteira)
    addTally(upTally);
    itemProgress({ phase: 'preparing' });
    await this.uploadBackup(token, progress, itemProgress, false);
    const done = activeTally ? syncDoneMessage(activeTally) : null;
    return {
      action: 'download',
      message: done ?? `Sincronizado com "${remoteMeta.deviceName}". ${resumo}.`,
    };
  }

  /**
   * Baixa o último backup do Drive e SUBSTITUI a coleção local por ele.
   *
   * É o caminho para voltar atrás: se você deletou um deck/card por engano,
   * aqui a coleção volta ao estado que estava no Drive. Antes de mexer, o
   * estado atual é guardado no backup local (o mesmo que o sync usa).
   */
  public static async restoreFromDrive(opts?: {
    onProgress?: (msg: string) => void;
    onItemProgress?: (p: SyncProgressState | null) => void;
  }): Promise<SyncResult> {
    if (this.isRunning()) {
      return {
        action: 'cancelled',
        message: 'Uma sincronização já está em andamento neste dispositivo.',
      };
    }
    this.markRunning();
    const timing = import.meta.env.DEV ? new SyncTiming() : null;
    if (timing) {
      setActiveTiming(timing);
      resetDriveCallCount();
    }
    const progress = opts?.onProgress ?? (() => {});
    const rawItemProgress = opts?.onItemProgress ?? (() => {});
    activeTally = emptySyncTally();
    metaWrittenByUs = false;
    // Cada emissão leva o tally ACUMULADO até agora — o painel só exibe.
    const itemProgress = (p: SyncProgressState | null) =>
      rawItemProgress(p ? { ...p, tally: { ...activeTally! } } : null);
    // Helper para timing: em não-dev executa direto, em dev mede
    const track = <T,>(stage: string, fn: () => Promise<T>) =>
      timing ? timing.track(stage, fn) : fn();
    try {
      const token = await track('token', () => this.ensureToken());
      itemProgress({ phase: 'download' });

      timing?.mark('meta-find');
      // fluxo interativo (restaurar): ignora o cache negativo (pode estar velho)
      const metaFile = await findFile(token, DRIVE_FILES.META, { ignoreNegativeCache: true });
      if (!metaFile) throw new Error('Não há backup no Google Drive ainda.');
      const remoteMeta = JSON.parse(
        await (await downloadFile(token, metaFile.id)).text()
      ) as SyncMeta;
      timing?.mark('meta-download');
      itemProgress({
        phase: 'download',
        deviceName: remoteMeta.deviceName,
        counts: remoteMeta.counts,
      });

      // baixa o pacote (guarda o estado atual no backup local antes)
      timing?.mark('download-collection-início');
      const data = await this.downloadCollection(token, remoteMeta, progress, itemProgress);
      timing?.mark('download-collection-fim');

      const remoteData: RemoteSyncData = {
        decks: data.decks,
        noteTypes: data.noteTypes,
        notes: data.notes,
        cards: data.cards,
        presets: data.presets,
        revlog: data.revlog,
        fsrsParameters: data.fsrsParameters,
        settings: {
          fsrs: data.fsrsParameters,
          prefs: data.settings?.prefs,
          theme: data.settings?.theme,
          colorTheme: data.settings?.colorTheme,
        },
      };

      // ── O que está no Drive entra (sobrescrevendo o que está aqui) ──
      const driveSnapshot = computeSnapshot(
        collectionSyncContent({
          decks: remoteData.decks,
          noteTypes: remoteData.noteTypes,
          notes: remoteData.notes,
          cards: remoteData.cards,
          presets: remoteData.presets,
          fsrsParameters: remoteData.fsrsParameters,
          settings: remoteData.settings,
        }),
        remoteMeta.deviceId,
        remoteMeta.deviceName
      );
      itemProgress({ phase: 'applying' });
      const applied = await applyRemoteItemsProgressive(
        remoteData,
        new Set(Object.keys(driveSnapshot.items)),
        (p) => itemProgress({ phase: 'applying', ...p })
      );
      // Contadores ↓ do que veio do Drive
      addTally(tallyFromApply(applied));
      mergeRemoteRevlog(remoteData.revlog ?? [], remoteData);

      // ── O que só existe aqui (ex.: o deck que você deletou) some ──
      const deleted = this.deleteLocalOnlyItems(driveSnapshot);
      addTally({ removedDown: deleted });
      itemProgress({ phase: 'applying' });

      // ── O estado local agora É o do Drive ──
      setSyncBase(
        computeSnapshot(localSyncContent(), this.getDeviceId(), getDeviceName())
      );
      this.setLastSync({ at: Date.now(), remoteUploadedAt: remoteMeta.uploadedAt });
      this.setPendingConflict(null);

      const resumo = summarizeApply({ ...applied, deleted });
      return {
        action: 'download',
        message: `Backup do Drive baixado: ${resumo}.`,
      };
    } finally {
      timing?.mark('fim');
      const report = timing?.getReport();
      if (report) (this as any)._lastTimingReport = report;
      itemProgress(null);
      localStorage.removeItem(LS.RUNNING);
      activeTally = null;
      if (timing) setActiveTiming(null);
    }
  }

  /**
   * Apaga aqui o que só existe localmente (o Drive é a verdade agora).
   * Devolve quantos itens foram removidos.
   */
  private static deleteLocalOnlyItems(drive: SyncSnapshot): number {
    const driveKeys = new Set(Object.keys(drive.items));
    const localSnapshot = computeSnapshot(
      localSyncContent(),
      this.getDeviceId(),
      getDeviceName()
    );
    const localOnly = Object.keys(localSnapshot.items).filter((k) => !driveKeys.has(k));
    let deleted = 0;

    // decks (apaga também as notas/cards dos subdecks)
    for (const key of localOnly.filter((k) => k.startsWith('deck:'))) {
      const name = key.slice('deck:'.length);
      const deck = StorageService.getDecks().find((d) => d.name.trim() === name.trim());
      if (deck) {
        StorageService.deleteDeck(deck.id);
        deleted++;
      }
    }
    // notas (os cards delas vão junto)
    for (const key of localOnly.filter((k) => k.startsWith('note:'))) {
      const guid = key.slice('note:'.length);
      const note = StorageService.getNotes().find((n) => (n.guid ?? '').trim() === guid);
      if (note) {
        StorageService.deleteNote(note.id);
        deleted++;
      }
    }
    // tipos de nota (só quando nenhuma nota usa)
    const usedTypes = new Set(StorageService.getNotes().map((n) => n.noteTypeId));
    for (const key of localOnly.filter((k) => k.startsWith('notetype:'))) {
      const name = key.slice('notetype:'.length);
      const type = StorageService.getNoteTypes().find((t) => t.name.trim() === name.trim());
      if (type && !usedTypes.has(type.id)) {
        StorageService.saveNoteTypes(
          StorageService.getNoteTypes().filter((t) => t.id !== type.id)
        );
        deleted++;
      }
    }
    // presets (o de fábrica é permanente)
    for (const key of localOnly.filter((k) => k.startsWith('preset:'))) {
      const name = key.slice('preset:'.length);
      const preset = StorageService.getPresets().find((p) => p.name.trim() === name.trim());
      if (preset && preset.id !== StorageService.DEFAULT_PRESET_ID) {
        StorageService.deletePreset(preset.id);
        deleted++;
      }
    }
    return deleted;
  }

  public static hasPendingLocalChanges(): boolean {
    const base = getSyncBase();
    if (!base) return this.computeLocalModifiedAt() > 0;
    // atalho: nada foi tocado depois do último sync → não há o que enviar
    if (this.computeLocalModifiedAt() <= base.updatedAt) {
      // …exceto o que muda SEM tocar a coleção: preferências, tema e FSRS
      // (são itens do snapshot, mas não têm updatedAt de item).
      if (this.hasExtrasLocalChanges()) return true;
      return this.hasSettingsItemChanges(base);
    }
    const local = computeSnapshot(
      localSyncContent(),
      this.getDeviceId(),
      getDeviceName()
    );
    if (this.hasLocalChanges(base, local)) return true;
    // a coleção pode ter sido tocada sem mudar de verdade (reordenar, etc.):
    // as configurações ainda podem ter mudado junto
    if (this.hasExtrasLocalChanges()) return true;
    return false;
  }

  /** Houve mudança local desde o último sync? */
  private static hasLocalChanges(base: SyncSnapshot | null, local: SyncSnapshot): boolean {
    if (!base) return this.computeLocalModifiedAt() > 0;
    const keys = new Set([...Object.keys(base.items), ...Object.keys(local.items)]);
    for (const key of keys) {
      if (base.items[key]?.hash !== local.items[key]?.hash) return true;
    }
    return false;
  }

  /**
   * As preferências + tema deste aparelho mudaram desde o último sync?
   * (mesma comparação que o sync das preferências faz, mas barata — sem I/O)
   */
  public static hasExtrasLocalChanges(): boolean {
    const base = this.getSideBase(LS.EXTRAS_BASE);
    if (!base) return false;
    return hashExtras(buildExtrasPayload()) !== base.hash;
  }

  /**
   * FSRS / rollover / tema são itens do snapshot, mas mudar o valor NÃO
   * atualiza o updatedAt da coleção — este atalho compara só o hash deles.
   */
  private static hasSettingsItemChanges(base: SyncSnapshot): boolean {
    const check = (key: string, value: unknown) => {
      const stored = base.items[key]?.hash;
      return stored !== undefined && stored !== hashValue(value);
    };
    if (check(SETTINGS_KEYS.fsrs, StorageService.getFSRSSettings())) return true;
    if (check(SETTINGS_KEYS.prefs, { rolloverHour: StorageService.getRolloverHour() })) return true;
    if (
      check(SETTINGS_KEYS.theme, {
        theme: StorageService.getTheme(),
        colorTheme: StorageService.getColorTheme(),
      })
    )
      return true;
    return false;
  }

  /**
   * As extensões instaladas/config desligadas mudaram desde o último sync?
   * (o estado delas mora em arquivos — do lado de fora da coleção; I/O suave)
   */
  public static async hasPendingAddonChanges(): Promise<boolean> {
    const base = this.getSideBase(LS.ADDONS_BASE);
    if (!base) return false;
    const { hash } = await computeAddonState();
    return hash !== base.hash;
  }

  /**
   * Atualiza a base (estado comum) com o que já foi aplicado do Drive.
   * Os itens em disputa ficam como estão — a disputa continua valendo.
   */
  private static updateBase(
    base: SyncSnapshot | null,
    local: SyncSnapshot,
    remote: SyncSnapshot,
    diff: SyncDiff,
    appliedKeys: Set<string>
  ): void {
    const items = { ...(base?.items ?? {}) };
    if (!base) {
      // Primeira mesclagem: o que só existe aqui já é comum (não mudou no Drive).
      for (const info of diff.localOnly) {
        const state = local.items[info.key];
        if (state) items[info.key] = state;
      }
    }
    for (const key of appliedKeys) {
      const state = remote.items[key];
      if (state) items[key] = state;
      else delete items[key];
    }
    setSyncBase({ ...(base ?? local), items });
  }

  /* ── conflito pendente (badge) ── */

  private static getPendingKey(): string {
    return 'runora_sync_pending';
  }

  public static getPendingConflict(): PendingConflict | null {
    try {
      const raw = localStorage.getItem(this.getPendingKey());
      return raw ? (JSON.parse(raw) as PendingConflict) : null;
    } catch {
      return null;
    }
  }

  public static setPendingConflict(pending: PendingConflict | null): void {
    if (!pending) localStorage.removeItem(this.getPendingKey());
    else localStorage.setItem(this.getPendingKey(), JSON.stringify(pending));
  }

  /* ── upload / download ── */

  private static async uploadBackup(
    token: string,
    progress: (m: string) => void,
    itemProgress: (p: SyncProgressState | null) => void = () => {},
    /** false na mescla: quem conta o que sobe é o chamador (só o que de fato é novo). */
    countTally = true,
    /** Mapa de arquivos já listados (não usado aqui, mas mantém compatibilidade). */
    _allFiles?: Record<string, DriveFileInfo>
  ): Promise<SyncResult> {
    progress('Exportando coleção completa + mídia…');

    // totais de ITENS da coleção local (o que está sendo enviado)
    const localCounts = {
      decks: StorageService.getDecks().length,
      notes: StorageService.getNotes().length,
      cards: StorageService.getCards().length,
    };

    // Contadores ↑: o pacote vai conter a coleção inteira
    if (countTally) {
      addTally(
        tallyFromCounts(
          {
            decks: localCounts.decks,
            notes: localCounts.notes,
            cards: localCounts.cards,
            presets: StorageService.getPresets().length,
          },
          'up'
        )
      );
    }

    // fase de preparação: o pacote é montado (contador ao vivo dos itens)
    itemProgress({ phase: 'preparing', counts: localCounts });
    const { blob } = await ExportImportService.buildCollectionPackage({
      onProgress: (p) =>
        itemProgress({
          phase: 'preparing',
          part: p.part,
          done: p.done,
          total: p.total,
          counts: localCounts,
        }),
    });

    // Hashes de preferências/extensões para pular download no próximo sync
    const localExtras = buildExtrasPayload();
    const localAddons = await computeAddonState();

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
      extrasHash: hashExtras(localExtras),
      addonsHash: localAddons.hash,
      // Marcador: este app conhece o estado unificado (runora-sync-state.json).
      // Sem ele, os outros aparelhos não conseguem usar o sync incremental.
      syncFormat: 'state',
    };

    // fase de envio: mostra quantos itens estão indo para o Drive
    itemProgress({ phase: 'upload', counts: meta.counts });
    progress(`Enviando backup (${formatBytes(blob.size)}) para o Google Drive…`);
    // id em cache → 0 chamadas de busca (404 cai no fallback: relista e recria)
    await uploadResumableCached(token, DRIVE_FILES.COLPKG, blob);

    const metaUpload = await uploadMultipartCached(
      token,
      DRIVE_FILES.META,
      new Blob([JSON.stringify(meta, null, 2)], { type: 'application/json' })
    );
    // fast path: o META é reescrito em todo sync → é o marcador de "o Drive mudou"
    await this.rememberMetaWritten(token, metaUpload);

    // O META acabou de anunciar extrasHash/addonsHash — os arquivos EXTRAS e
    // ADDONS_INDEX do Drive PRECISAM ter exatamente esse conteúdo (o outro
    // aparelho confia no hash para decidir se baixa). Sem isto, uma mudança
    // só de preferências/tema subia o backup completo mas deixava o EXTRAS
    // velho no Drive: o outro aparelho aplicava o tema antigo "confiando" no
    // hash novo, e a diferença nunca se corrigia (o reenvio desperdiçado que
    // a T1 cortou era o que mascarava isto).
    await this.uploadExtras(token, localExtras);
    await this.uploadAddons(token, localAddons, progress, itemProgress);
    // bases em dia: o conteúdo local agora É o conteúdo do Drive
    this.setSideBase(LS.EXTRAS_BASE, { hash: hashExtras(localExtras), uploadedAt: Date.now() });
    this.setSideBase(LS.ADDONS_BASE, { hash: localAddons.hash, uploadedAt: Date.now() });

    // O estado unificado também é reescrito: o .colpkg sozinho não basta.
    // O STATE é quem diz aos outros aparelhos "a base é X, o head é X" — sem
    // ele, o delta que sobrou no Drive ficaria velho e desmentiria o .colpkg.
    const usnAtual = StorageService.getCurrentUsn();
    await this.publishEmptyState(token, usnAtual, meta.counts);
    // O backup completo deixou o Drive no USN atual → este aparelho também
    // passa a contar a partir dali (senão o próximo sync acharia que está
    // "atrás" e baixaria a coleção inteira de novo).
    this.setLastSyncedUsn(usnAtual);

    this.setLastSync({ at: Date.now(), remoteUploadedAt: meta.uploadedAt });
    // A base (estado comum do último sync) passa a ser o estado atual.
    setSyncBase(
      computeSnapshot(localSyncContent(), this.getDeviceId(), getDeviceName())
    );
    this.setPendingConflict(null);
    return {
      action: 'upload',
      message:
        `Backup enviado ao Drive: ${meta.counts.decks} decks, ${meta.counts.notes} notas, ` +
        `${meta.counts.cards} cards, ${meta.counts.media} arquivos de mídia (${formatBytes(blob.size)}).`,
    };
  }

  // ============================================================
  // Fase 7: Upload incremental (delta) — envia só o que mudou
  // ============================================================

  /**
   * Aplica por cima da coleção baixada o delta que está no estado do Drive.
   *
   * O .colpkg é a base (até o último sync completo) e o delta são as mudanças
   * depois disso: os dois juntos são a verdade do Drive.
   */
  private static async applyRemoteStateDelta(
    token: string,
    data: {
      decks: Deck[];
      noteTypes: NoteType[];
      notes: Note[];
      cards: Card[];
      presets?: Preset[];
      revlog?: RevlogEntry[];
    },
    allFiles?: Record<string, DriveFileInfo>
  ): Promise<void> {
    const stateInfo = await this.readStateFromDrive(token, allFiles);
    if (!stateInfo) return;
    const { state, modifiedTime } = stateInfo;
    if (!state || !state.delta) return;
    if (!isValidDelta(state.delta)) return;
    // estado inconsistente: melhor ignorá-lo do que aplicar meio delta
    if (state.delta.currentUsn !== state.headUsn) return;
    // o USN do Drive passa a ser a referência deste aparelho (mesmo com o
    // delta vazio: o head continua sendo o contador compartilhado)
    StorageService.adoptUsnCounter(state.headUsn);
    // delta velho (o .colpkg já é mais novo): o .colpkg é a verdade
    const pkgFile = allFiles?.[DRIVE_FILES.COLPKG] ?? (await findFile(token, DRIVE_FILES.COLPKG));
    if (pkgFile?.modifiedTime && modifiedTime && pkgFile.modifiedTime > modifiedTime) return;
    const d = state.delta;
    const vazio =
      d.decks.length === 0 &&
      d.noteTypes.length === 0 &&
      d.notes.length === 0 &&
      d.cards.length === 0 &&
      d.presets.length === 0 &&
      d.revlog.length === 0 &&
      d.tombstones.length === 0;
    if (vazio) return;
    applyDeltaToCollection(data, d);
  }

  /**
   * Lê o estado unificado do Drive (null se não existir ou estiver ruins).
   */
  private static async readStateFromDrive(
    token: string,
    allFiles?: Record<string, DriveFileInfo>
  ): Promise<{ state: SyncState; modifiedTime: string } | null> {
    const file = allFiles?.[DRIVE_FILES.STATE] ?? (await findFile(token, DRIVE_FILES.STATE));
    if (!file) return null;
    try {
      const raw = await (await downloadFile(token, file.id)).text();
      const state = JSON.parse(raw) as SyncState;
      if (!state || typeof state.baseUsn !== 'number' || typeof state.headUsn !== 'number') {
        return null;
      }
      return { state, modifiedTime: file.modifiedTime ?? '' };
    } catch {
      return null;
    }
  }

  /**
   * O delta do estado ficou VELHO?
   *
   * O .colpkg (a base) e o META sobem juntos; o delta vive no estado. Se o
   * .colpkg for mais novo que o estado, o delta não descreve o que o .colpkg
   * já contém — e aplicá-lo poderia devolver ao mundo uma nota que já foi
   * apagada (foi exatamente o que aconteceu com a nota de teste).
   */
  private static async isStateStale(
    token: string,
    allFiles?: Record<string, DriveFileInfo>
  ): Promise<boolean> {
    const stateFile = allFiles?.[DRIVE_FILES.STATE] ?? (await findFile(token, DRIVE_FILES.STATE));
    const pkgFile = allFiles?.[DRIVE_FILES.COLPKG] ?? (await findFile(token, DRIVE_FILES.COLPKG));
    if (!stateFile?.modifiedTime || !pkgFile?.modifiedTime) return false;
    return pkgFile.modifiedTime > stateFile.modifiedTime;
  }

  /**
   * Publica o estado unificado (runora-sync-state.json) com delta vazio.
   *
   * Usado quando o .colpkg inteiro sobe: a partir daí o .colpkg É a verdade
   * toda (base = head = USN atual) e não há nada pendente no delta. Sem isso,
   * o delta que sobrou no Drive ficaria velho e desmentiria o .colpkg — foi
   * assim que uma nota já apagada voltou a aparecer num outro aparelho.
   */
  private static async publishEmptyState(
    token: string,
    usn: number,
    counts: { decks: number; noteTypes: number; notes: number; cards: number; revlog: number; media: number }
  ): Promise<void> {
    const now = Date.now();
    const delta = buildDelta(usn, usn, this.getDeviceId(), getDeviceName(), {
      decks: [],
      noteTypes: [],
      notes: [],
      cards: [],
      revlog: [],
      presets: [],
      tombstones: [],
      mediaManifest: {},
    });
    const state: SyncState = {
      app: 'runora',
      version: 1,
      baseUsn: usn,
      headUsn: usn,
      syncedAt: now,
      deviceId: this.getDeviceId(),
      deviceName: getDeviceName(),
      counts: {
        decks: counts.decks,
        noteTypes: counts.noteTypes,
        notes: counts.notes,
        cards: counts.cards,
        revlog: counts.revlog,
        presets: StorageService.getPresets().length,
        tombstones: 0,
        mediaFiles: counts.media,
      },
      delta,
      mediaManifest: {},
      extrasHash: hashExtras(buildExtrasPayload()),
      addonsHash: (await computeAddonState()).hash,
    };
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
    const uploaded = await uploadResumableCached(token, DRIVE_FILES.STATE, blob);
    // fast path: o STATE foi reescrito → guarda o modifiedTime novo (a resposta
    // do upload já traz; só busca o arquivo se não trouxer)
    try {
      if (uploaded.modifiedTime) {
        this.setStateModifiedTime(uploaded.modifiedTime);
      } else {
        const fresh = await findFile(token, DRIVE_FILES.STATE);
        if (fresh?.modifiedTime) this.setStateModifiedTime(fresh.modifiedTime);
      }
    } catch {
      // fast path é otimização, não crítico
    }
  }

  /** Chave para o último USN sincronizado com o Drive. */
  private static getLastSyncedUsnKey(): string {
    return `runora_sync_last_usn_${this.getDeviceId()}`;
  }

  /** Retorna o último USN que foi sincronizado com o Drive. */
  private static getLastSyncedUsn(): number {
    const raw = localStorage.getItem(this.getLastSyncedUsnKey());
    return raw ? Number(raw) : 0;
  }

  /** Define o último USN sincronizado com o Drive. */
  private static setLastSyncedUsn(usn: number): void {
    localStorage.setItem(this.getLastSyncedUsnKey(), String(usn));
  }

  /**
   * Upload incremental: envia apenas as mudanças desde o último USN sincronizado.
   * Retorna o novo USN head se houver mudanças, ou null se nada mudou.
   */
  private static async uploadIncremental(
    token: string,
    progress: (m: string) => void,
    itemProgress: (p: SyncProgressState | null) => void = () => {},
    allFiles?: Record<string, DriveFileInfo>
  ): Promise<number | null> {
    const lastSyncedUsn = this.getLastSyncedUsn();
    const currentUsn = StorageService.getCurrentUsn();

    if (currentUsn <= lastSyncedUsn) {
      progress('Nenhuma mudança desde o último sync incremental.');
      return null;
    }

    progress(`Preparando delta incremental (USN ${lastSyncedUsn} → ${currentUsn})…`);

    // Coleta mudanças desde lastSyncedUsn
    const [decks, noteTypes, notes, cards, revlog, presets, tombstones] = await Promise.all([
      StorageService.getDecksSince(lastSyncedUsn),
      StorageService.getNoteTypesSince(lastSyncedUsn),
      StorageService.getNotesSince(lastSyncedUsn),
      StorageService.getCardsSince(lastSyncedUsn),
      StorageService.getRevlogSince(lastSyncedUsn),
      StorageService.getPresetsSince(lastSyncedUsn),
      StorageService.getAllSyncTombstonesSince(lastSyncedUsn),
    ]);

    // Se não há mudanças reais (só USN avançou mas entidades são as mesmas), não sobe delta
    const totalChanges = decks.length + noteTypes.length + notes.length + cards.length + revlog.length + presets.length + tombstones.length;
    if (totalChanges === 0) {
      this.setLastSyncedUsn(currentUsn);
      progress('Nenhuma mudança real — USN apenas avançado.');
      return currentUsn;
    }

    // Media manifest: lista arquivos de mídia referenciados pelas notas novas/modificadas
    const mediaNames = new Set<string>();
    for (const note of notes) {
      for (const m of note.media ?? []) mediaNames.add(m.name);
    }
    const mediaManifest: Record<string, string> = {};
    for (const name of mediaNames) {
      const blob = await MediaStore.get(name);
      if (blob) {
        // SHA256 simples para o manifest
        const buffer = await blob.arrayBuffer();
        const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
        const hashArray = Array.from(new Uint8Array(hashBuffer));
        const hashHex = hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
        mediaManifest[hashHex] = name;
      }
    }

    // O delta que já está no Drive (a base) + as mudanças novas deste
    // aparelho. Sem a soma, cada envio incremental jogaria fora o delta
    // anterior e as mudanças antigas nunca chegariam aos outros aparelhos.
    const previous = await this.readStateFromDrive(token, allFiles);
    const previousState = previous?.state ?? null;
    if (previousState && previousState.headUsn !== lastSyncedUsn) {
      // O Drive tem mudanças que este aparelho ainda não viu: publicar um
      // delta parcial agora deixaria o estado do Drive misturado.
      progress('O Drive tem mudanças que este aparelho ainda não viu — vai sincronizar tudo.');
      return null;
    }
    // O delta que já está no Drive é a BASE do que este aparelho vai somar.
    // Se ele estiver velho (o .colpkg já é mais novo), não dá para somar em
    // cima: o caminho seguro é sincronizar tudo.
    if (previous && (await this.isStateStale(token, allFiles))) {
      progress('O estado do Drive ficou atrás do backup — vai sincronizar tudo.');
      return null;
    }

    // Build delta payload
    // O mapa id-da-nota → GUID viaja junto: o id de uma nota é LOCAL de cada
    // aparelho, e é pelo GUID que o outro aparelho casa o item certo (sem
    // isso, uma nota editada aqui viraria uma DUPLICATA lá).
    const localNotes = StorageService.getNotes();
    const noteGuids: Record<string, string> = {};
    for (const n of notes) if (n.guid) noteGuids[n.id] = n.guid;
    for (const c of cards) {
      const n = localNotes.find((x) => x.id === c.noteId);
      if (n?.guid) noteGuids[c.noteId] = n.guid;
    }
    const newDelta = buildDelta(
      lastSyncedUsn,
      currentUsn,
      this.getDeviceId(),
      getDeviceName(),
      { decks, noteTypes, notes, cards, revlog, presets, tombstones, mediaManifest, noteGuids }
    );
    const delta = mergeDeltas(previousState?.delta ?? null, newDelta);
    const baseUsn = previousState?.baseUsn ?? lastSyncedUsn;

    // Contadores ↑: o delta está pronto — Anki também mostra os números de
    // uma vez quando monta o lote de envio.
    addTally(tallyFromCounts({ decks: decks.length, notes: notes.length, cards: cards.length, presets: presets.length }, 'up'));
    addTally({ removedUp: tombstones.length });

    // Upload unified state file (replaces delta-meta + delta-payload + media-manifest)
    itemProgress({ phase: 'preparing', counts: { decks: decks.length, notes: notes.length, cards: cards.length } });
    progress('Preparando estado unificado…');
    itemProgress({ phase: 'upload', counts: { decks: decks.length, notes: notes.length, cards: cards.length } });

    // Upload media files referenced in manifest (only new ones)
    for (const [hash, name] of Object.entries(mediaManifest)) {
      const blob = await MediaStore.get(name);
      if (blob) {
        const existingMedia = await findFile(token, `${DRIVE_FILES.MEDIA_FOLDER}${hash}`);
        if (!existingMedia) {
          await uploadResumable(token, `${DRIVE_FILES.MEDIA_FOLDER}${hash}`, blob);
        }
      }
    }

    // Build unified state
    const now = Date.now();
    const state: SyncState = {
      app: 'runora',
      version: 1,
      baseUsn,
      headUsn: Math.max(currentUsn, previousState?.headUsn ?? 0),
      syncedAt: now,
      deviceId: this.getDeviceId(),
      deviceName: getDeviceName(),
      counts: {
        decks: delta.decks.length,
        noteTypes: delta.noteTypes.length,
        notes: delta.notes.length,
        cards: delta.cards.length,
        revlog: delta.revlog.length,
        presets: delta.presets.length,
        tombstones: delta.tombstones.length,
        mediaFiles: Object.keys(delta.mediaManifest).length,
      },
      delta,
      mediaManifest: delta.mediaManifest,
      extrasHash: hashExtras(buildExtrasPayload()),
      addonsHash: (await computeAddonState()).hash,
    };
    const stateBlob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
    progress(`Enviando estado unificado (${formatBytes(stateBlob.size)}) para o Drive…`);
    itemProgress({ phase: 'upload', counts: { decks: decks.length, notes: notes.length, cards: cards.length } });
    // id em cache → 0 chamadas de busca (404 cai no fallback: relista e recria)
    const stateUpload = await uploadResumableCached(token, DRIVE_FILES.STATE, stateBlob);
    // Fast path: atualiza o modifiedTime do STATE para o fast path do próximo sync
    // (a resposta do upload já traz; só busca o arquivo se não trouxer)
    try {
      if (stateUpload.modifiedTime) {
        this.setStateModifiedTime(stateUpload.modifiedTime);
      } else {
        const freshState = await findFile(token, DRIVE_FILES.STATE);
        if (freshState?.modifiedTime) this.setStateModifiedTime(freshState.modifiedTime);
      }
    } catch {
      // ignora: fast path é otimização, não crítico
    }

    // Atualiza o META do Drive: é por ele que os OUTROS aparelhos percebem
    // que há mudanças novas no Drive para baixar (checagem de remoteChanged).
    // id em cache → 0 chamadas de busca; baixa só para ler o appVersion antigo
    const existingBackupMetaId = await getFileIdForUpload(token, DRIVE_FILES.META);
    let appVersion = '0.1.0';
    if (existingBackupMetaId) {
      try {
        appVersion = (JSON.parse(await (await downloadFile(token, existingBackupMetaId)).text()) as SyncMeta).appVersion;
      } catch {
        /* mantém o padrão */
      }
    }
    const localExtras = buildExtrasPayload();
    const localAddons = await computeAddonState();
    const backupMeta: SyncMeta = {
      app: 'runora',
      version: 1,
      uploadedAt: now,
      deviceId: this.getDeviceId(),
      deviceName: getDeviceName(),
      appVersion,
      counts: {
        decks: StorageService.getDecks().length,
        notes: StorageService.getNotes().length,
        cards: StorageService.getCards().length,
        noteTypes: StorageService.getNoteTypes().length,
        media: (await MediaStore.list()).length,
        revlog: StorageService.getRevlog().length,
      },
      extrasHash: hashExtras(localExtras),
      addonsHash: localAddons.hash,
      // Marcador: este app conhece o estado unificado (runora-sync-state.json).
      syncFormat: 'state',
    };
    const metaUpload = await uploadMultipartCached(
      token,
      DRIVE_FILES.META,
      new Blob([JSON.stringify(backupMeta, null, 2)], { type: 'application/json' })
    );
    // fast path: o META é reescrito em todo sync → é o marcador de "o Drive mudou"
    await this.rememberMetaWritten(token, metaUpload);

    // Update last synced USN
    this.setLastSyncedUsn(currentUsn);
    // O Drive agora tem o estado atual → a base passa a ser o estado local
    // (senão o sinal de "mudanças pendentes" não apaga, como no backup completo).
    setSyncBase(computeSnapshot(localSyncContent(), this.getDeviceId(), getDeviceName()));
    this.setLastSync({ at: now, remoteUploadedAt: now });

    progress(`Delta enviado: ${decks.length} decks, ${notes.length} notas, ${cards.length} cards, ${tombstones.length} deletados.`);
    return currentUsn;
  }

  /**
   * Baixa o pacote do Drive e o lê (sem aplicar nada ainda) — a comparação
   * item a item acontece com o conteúdo em memória.
   */
  private static async downloadCollection(
    token: string,
    remoteMeta: SyncMeta,
    progress: (m: string) => void,
    itemProgress: (p: SyncProgressState | null) => void = () => {},
    allFiles?: Record<string, DriveFileInfo>
  ): Promise<ImportableCollection> {
    // o .colpkg já veio na listagem única do início do sync (0 chamadas extras)
    const pkg = allFiles?.[DRIVE_FILES.COLPKG] ?? (await findFile(token, DRIVE_FILES.COLPKG));
    if (!pkg) {
      throw new Error('Há metadados no Drive, mas o arquivo de backup (.colpkg) não foi encontrado.');
    }
    progress(`Baixando dados de "${remoteMeta.deviceName}" (${formatBytes(Number(pkg.size || 0))})…`);
    const blob = await downloadFile(token, pkg.id);

    // Segurança: guarda o estado atual antes de mexer nele
    try {
      const current = await ExportImportService.buildCollectionPackage();
      await saveLocalBackup(`antes-do-sync-${Date.now()}`, current.blob);
    } catch (e) {
      console.warn('Não foi possível salvar o backup local (seguindo mesmo assim):', e);
    }

    const file = new File([blob], DRIVE_FILES.COLPKG, { type: 'application/octet-stream' });
    const data = await ExportImportService.readPackageData(file);

    // O .colpkg é a BASE (o estado até o último sync completo). As mudanças
    // depois disso vivem no delta do estado unificado — sem aplicar o delta,
    // o .colpkg viria velho: nota nova sumia, nota apagada voltava.
    await this.applyRemoteStateDelta(token, data, allFiles);

    // A mídia do outro dispositivo entra junto (nomes únicos, reimportar é seguro)
    progress('Importando os arquivos de mídia do Drive…');
    await ExportImportService.importMediaFrom(data, (p) =>
      itemProgress({
        phase: 'download',
        deviceName: remoteMeta.deviceName,
        part: p.part,
        done: p.done,
        total: p.total,
        counts: remoteMeta.counts,
      })
    );
    return data;
  }

  // ============================================================
  // Fase 7: Download incremental (aplica delta do Drive)
  // ============================================================

  /**
   * Download incremental: baixa e aplica o delta do Drive.
   * Retorna o novo USN head se houver mudanças, ou null se nada mudou.
   */
  private static async downloadIncremental(
    token: string,
    progress: (m: string) => void,
    itemProgress: (p: SyncProgressState | null) => void = () => {},
    remoteUploadedAt?: number,
    allFiles?: Record<string, DriveFileInfo>
  ): Promise<number | null> {
    const lastSyncedUsn = this.getLastSyncedUsn();

    // Lê o estado unificado do Drive (já veio na listagem única — 0 chamadas)
    const stateFile = allFiles?.[DRIVE_FILES.STATE] ?? (await findFile(token, DRIVE_FILES.STATE));
    if (!stateFile) {
      progress('Nenhum estado incremental no Drive — fará sync completo se necessário.');
      return null;
    }

    const state: SyncState = JSON.parse(await (await downloadFile(token, stateFile.id)).text());
    const remoteHeadUsn = state.headUsn;

    if (remoteHeadUsn <= lastSyncedUsn) {
      // O Drive não tem nada além do que já temos. Mas o META pode ter mudado
      // só porque OUTRO aparelho reenviou o backup (mesmo conteúdo, mesmo
      // head). Baixar a coleção inteira (69,5 MB) para receber o que já
      // temos seria desperdício — e fazia os aparelhos entrarem num ciclo de
      // sync completo.
      //
      // A única exceção é o estado VELHO: aí o delta não descreve o .colpkg e
      // a coleção completa é a verdade.
      if (await this.isStateStale(token, allFiles)) {
        progress('O estado do Drive ficou atrás do backup — vai baixar a coleção completa.');
        return null;
      }
      progress('O Drive não tem nada além do que já temos.');
      if (stateFile.modifiedTime) this.setStateModifiedTime(stateFile.modifiedTime);
      this.setLastSync({
        at: Date.now(),
        remoteUploadedAt: remoteUploadedAt ?? state.syncedAt,
      });
      // sinaliza "nada a fazer" (e não "falhou" → não baixa a coleção toda)
      return lastSyncedUsn;
    }

    // O delta só serve para quem está na MESMA base do Drive. Se a base for
    // outra, o delta traria um estado misturado (faltando o que veio antes)
    // → melhor baixar a coleção completa, que é sempre a verdade.
    if (lastSyncedUsn < state.baseUsn) {
      progress('A base do Drive mudou — vai baixar a coleção completa.');
      return null;
    }

    // Delta velho (o .colpkg já é mais novo): aplicar ele poderia devolver
    // ao mundo algo que já foi apagado. O caminho seguro é a coleção completa.
    if (await this.isStateStale(token, allFiles)) {
      progress('O estado do Drive ficou atrás do backup — vai baixar a coleção completa.');
      return null;
    }

    progress(`Baixando delta incremental (USN ${lastSyncedUsn} → ${state.headUsn}) de "${state.deviceName}"…`);
itemProgress({ phase: 'download', counts: state.counts });

    const delta = state.delta;

    if (!isValidDelta(delta)) {
      throw new Error('Delta inválido ou corrompido no Drive.');
    }

    // Verifica consistência
    if (delta.currentUsn !== state.headUsn) {
      throw new Error('Inconsistência: delta.currentUsn ≠ state.headUsn');
    }

    const mediaManifest = state.mediaManifest;

    // Baixa arquivos de mídia novos (que não temos localmente)
    const mediaFolder = DRIVE_FILES.MEDIA_FOLDER;
    for (const [hash, name] of Object.entries(mediaManifest)) {
      const localBlob = await MediaStore.get(name);
      if (!localBlob) {
        const remoteMediaFile = await findFile(token, `${mediaFolder}${hash}`);
        if (remoteMediaFile) {
          progress(`Baixando mídia: ${name}`);
          const mediaBlob = await downloadFile(token, remoteMediaFile.id);
          await MediaStore.put(name, new File([mediaBlob], name, { type: mediaBlob.type || 'application/octet-stream' }));
        }
      }
    }

    // Aplica o delta localmente — contagem exata item por item (↓ ao vivo)
    progress('Aplicando delta localmente…');
    itemProgress({ phase: 'applying', counts: state.counts });

    const deltaTotal =
      delta.decks.length +
      delta.noteTypes.length +
      delta.notes.length +
      delta.cards.length +
      delta.revlog.length +
      delta.presets.length +
      delta.tombstones.length;
    let processed = 0;
    // tipo do delta → parte do painel / chave do tally (revlog não conta no tally)
    const TALLY_KEY: Record<string, 'decks' | 'notes' | 'cards' | 'presets' | null> = {
      deck: 'decks',
      note: 'notes',
      card: 'cards',
      preset: 'presets',
      notetype: null,
      revlog: null,
    };
    const reportApply = (part?: SyncProgressState['part']) => {
      processed++;
      itemProgress({
        phase: 'applying',
        ...(part ? { part } : {}),
        done: processed,
        total: deltaTotal,
        counts: state.counts,
      });
    };

    const newHeadUsn = applyDelta(delta,
      // applyEntity: cria/atualiza entidade no storage local
      (entity, type) => {
        switch (type) {
          case 'deck':
            StorageService.upsertDeck(entity as Deck);
            break;
          case 'notetype':
            StorageService.upsertNoteType(entity as NoteType);
            break;
          case 'note':
            StorageService.upsertNote(entity as Note);
            break;
          case 'card': {
            const card = entity as Card;
            // o `noteId` do card é o id da nota NO APARELHO DE ORIGEM: o delta
            // traz o mapa id → GUID para casar a nota localmente
            StorageService.upsertCard(card, delta.noteGuids?.[card.noteId]);
            break;
          }
          case 'revlog':
            StorageService.saveRevlog(entity as RevlogEntry);
            break;
          case 'preset':
            StorageService.upsertPreset(entity as Preset);
            break;
        }
        const key = TALLY_KEY[type];
        if (key) addTally(tallyFromCounts({ [key]: 1 }, 'down'));
        // 'presets' conta no tally mas não tem "parte" própria no painel
        reportApply(key && key !== 'presets' ? key : undefined);
      },
      // applyTombstone: processa deletados
      (tombstone) => {
        // O `id` do tombstone é LOCAL do aparelho que deletou — aqui we casamos
        // pela identidade universal (GUID da nota / nome do deck) para apagar
        // o item certo.
        switch (tombstone.type) {
          case 'deck': {
            const id = StorageService.findDeckIdByName(tombstone.name) ?? tombstone.id;
            StorageService.deleteDeck(id);
            break;
          }
          case 'notetype': {
            const id = StorageService.findNoteTypeIdByName(tombstone.name) ?? tombstone.id;
            StorageService.deleteNoteType(id);
            break;
          }
          case 'note': {
            const id = StorageService.findNoteIdByGuid(tombstone.guid) ?? tombstone.id;
            StorageService.deleteNote(id);
            break;
          }
          case 'card': {
            const id =
              StorageService.findCardIdByIdentity(tombstone.guid, tombstone.templateOrd) ??
              tombstone.id;
            StorageService.deleteCard(id);
            break;
          }
          case 'revlog':
            // Revlog não tem delete individual — ignora (limpeza via sync completo se necessário)
            break;
          case 'preset': {
            const id = StorageService.findPresetIdByName(tombstone.name) ?? tombstone.id;
            StorageService.deletePreset(id);
            break;
          }
        }
        addTally({ removedDown: 1 });
        reportApply('deletes');
      }
    );

    // Atualiza último USN sincronizado
    this.setLastSyncedUsn(newHeadUsn);
    // O USN é compartilhado: este aparelho passa a contar a partir do head
    // do Drive (senão as próximas edições ficariam "no passado" do delta).
    StorageService.adoptUsnCounter(newHeadUsn);
    // O estado local agora é o do Drive → a base passa a ser o estado atual
    // (senão o sinal de "mudanças pendentes" acende à toa após o download).
    setSyncBase(computeSnapshot(localSyncContent(), this.getDeviceId(), getDeviceName()));
    this.setLastSync({ at: Date.now(), remoteUploadedAt: state.syncedAt });

    progress(`Delta aplicado: ${delta.decks.length} decks, ${delta.notes.length} notas, ${delta.cards.length} cards, ${delta.tombstones.length} deletados.`);
    return newHeadUsn;
  }

  /**
   * Limpa arquivos antigos do formato de sync no Drive (após migração para estado unificado).
   * Arquivos removidos:
   * - runora-sync-delta-meta.json
   * - runora-sync-delta.json
   * - runora-sync-media-manifest.json
   * - runora-sync-meta.json (o antigo meta do backup completo — o novo STATE substitui)
   * - Pasta runora-sync-media/ (opcional, apenas arquivos não referenciados)
   *
   * Use APENAS após confirmar que todos os aparelhos estão na nova versão.
   * O .colpkg (backup completo) NÃO é removido — serve como backup de segurança.
   */
  public static async cleanupOldSyncFiles(token: string): Promise<string> {
    const deleted: string[] = [];
    const keepers = new Set([
      DRIVE_FILES.STATE,
      DRIVE_FILES.COLPKG,
      DRIVE_FILES.LOCK,
      DRIVE_FILES.EXTRAS,
      DRIVE_FILES.ADDONS_INDEX,
      DRIVE_FILES.ADDONS_ZIP,
    ]);

    // 1) Arquivos específicos do formato antigo
    const oldFiles = [
      DRIVE_FILES.DELTA_META,
      DRIVE_FILES.DELTA_PAYLOAD,
      DRIVE_FILES.DELTA_MEDIA_MANIFEST,
      DRIVE_FILES.META, // o meta antigo do backup completo
    ];

    for (const name of oldFiles) {
      // limpeza manual: ignora o cache negativo (pode estar velho)
      const file = await findFile(token, name, { ignoreNegativeCache: true });
      if (file) {
        await api(token, `/drive/v3/files/${file.id}`, { method: 'DELETE' });
        deleted.push(name);
      }
    }

    // 2) Pasta de mídia incremental (apenas arquivos não referenciados no STATE)
    if (deleted.length > 0) {
      try {
        const stateFile = await findFile(token, DRIVE_FILES.STATE);
        if (stateFile) {
          const state: SyncState = JSON.parse(
            await (await downloadFile(token, stateFile.id)).text()
          );
          const referenced = new Set(Object.keys(state.mediaManifest));
          const folderId = await ensureFolder(token);
          const q = encodeURIComponent(
            `'${folderId}' in parents and name contains 'runora-sync-media'`
          );
          const res = await api(token, `/drive/v3/files?q=${q}&fields=files(id,name)&pageSize=200`);
          const data = (await res.json()) as { files?: DriveFileInfo[] };
          for (const f of data.files ?? []) {
            const hash = f.name.replace('runora-sync-media/', '');
            if (!referenced.has(hash)) {
              await api(token, `/drive/v3/files/${f.id}`, { method: 'DELETE' });
              deleted.push(`runora-sync-media/${f.name}`);
            }
          }
        }
      } catch {
        // se falhar, não bloqueia — o usuário pode rodar de novo
      }
    }

    return deleted.length > 0
      ? `Arquivos antigos removidos: ${deleted.join(', ')}`
      : 'Nenhum arquivo antigo encontrado para remover.';
  }
}
