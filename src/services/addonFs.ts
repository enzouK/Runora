/**
 * Cross-platform storage for Addons.
 *
 * Canonical on-disk layout (inside the app's data directory):
 *   Addons/settings.json                 -> { addons: { "<id>": { enabled } } }
 *   Addons/<addon-id>/manifest.json      -> AddonManifest (without inline script)
 *   Addons/<addon-id>/main.js            -> addon JavaScript (when present)
 *
 * Backends:
 * - Electron/Windows: IPC bridge rooted at app.getPath('userData')/Addons
 * - Android/Capacitor: Filesystem plugin (Directory.Data) -> files/Addons
 * - Plain web dev: localStorage-backed virtual FS (same relative paths)
 */
import { Capacitor } from '@capacitor/core';
import { Directory, Encoding, Filesystem } from '@capacitor/filesystem';

export type AddonFsEncoding = 'utf8' | 'base64';

export interface AddonFsEntry {
  path: string;
  encoding: AddonFsEncoding;
  data: string;
}

export interface AddonFs {
  ensureAddonsDir(): Promise<void>;
  rootPath(): Promise<string | null>;
  listAddonDirs(): Promise<string[]>;
  /** Recursive file list (relative paths) under a directory inside Addons/. */
  listFiles(relDir: string): Promise<string[]>;
  exists(relPath: string): Promise<boolean>;
  read(relPath: string, encoding?: AddonFsEncoding): Promise<AddonFsEntry | null>;
  write(relPath: string, data: string | Uint8Array): Promise<void>;
  remove(relPath: string): Promise<void>;
}

const ADDONS_DIR = 'Addons';
const WEB_FS_KEY = 'anki2_addons_fs_v1';

/** Normalizes a path relative to the Addons root and blocks traversal. */
export function normalizeRel(relPath: string): string {
  const parts = relPath
    .replace(/\\/g, '/')
    .split('/')
    .filter((p) => p && p !== '.' && p !== '..');
  if (parts.length === 0) throw new Error('Invalid addon path');
  return parts.join('/');
}

export function toBase64(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

export function fromBase64(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/* ── Electron desktop bridge ─────────────────────────────────────────── */

interface DesktopAddonsBridge {
  isDesktop: boolean;
  addonsRoot(): Promise<{ ok: boolean; root?: string; error?: string }>;
  addonsEnsure(): Promise<{ ok: boolean; error?: string }>;
  addonsList(): Promise<{ ok: boolean; dirs?: string[]; error?: string }>;
  addonsListFiles(rel: string): Promise<{ ok: boolean; files?: string[]; error?: string }>;
  addonsExists(rel: string): Promise<{ ok: boolean; exists: boolean; error?: string }>;
  addonsRead(rel: string, encoding: AddonFsEncoding): Promise<{ ok: boolean; found: boolean; encoding?: AddonFsEncoding; data?: string; error?: string }>;
  addonsWrite(rel: string, encoding: AddonFsEncoding, data: string): Promise<{ ok: boolean; error?: string }>;
  addonsRemove(rel: string): Promise<{ ok: boolean; error?: string }>;
}

function desktopFs(): AddonFs {
  const bridge = (window as unknown as { ankiDesktop?: DesktopAddonsBridge }).ankiDesktop;
  if (!bridge?.isDesktop) throw new Error('Desktop bridge unavailable');
  return {
    ensureAddonsDir: async () => {
      const r = await bridge.addonsEnsure();
      if (!r.ok) throw new Error(r.error || 'addons ensure failed');
    },
    rootPath: async () => {
      const r = await bridge.addonsRoot();
      return r.ok ? r.root || null : null;
    },
    listAddonDirs: async () => {
      const r = await bridge.addonsList();
      if (!r.ok) throw new Error(r.error || 'addons list failed');
      return r.dirs || [];
    },
    listFiles: async (relDir) => {
      const r = await bridge.addonsListFiles(normalizeRel(relDir));
      if (!r.ok) throw new Error(r.error || 'addons list-files failed');
      return r.files || [];
    },
    exists: async (relPath) => {
      const r = await bridge.addonsExists(normalizeRel(relPath));
      if (!r.ok) throw new Error(r.error || 'addons exists failed');
      return r.exists;
    },
    read: async (relPath, encoding = 'utf8') => {
      const rel = normalizeRel(relPath);
      const r = await bridge.addonsRead(rel, encoding);
      if (!r.ok) throw new Error(r.error || 'addons read failed');
      if (!r.found || r.data == null) return null;
      return { path: rel, encoding: r.encoding || encoding, data: r.data };
    },
    write: async (relPath, data) => {
      const rel = normalizeRel(relPath);
      const encoding: AddonFsEncoding = typeof data === 'string' ? 'utf8' : 'base64';
      const payload = typeof data === 'string' ? data : toBase64(data);
      const r = await bridge.addonsWrite(rel, encoding, payload);
      if (!r.ok) throw new Error(r.error || 'addons write failed');
    },
    remove: async (relPath) => {
      const r = await bridge.addonsRemove(normalizeRel(relPath));
      if (!r.ok) throw new Error(r.error || 'addons remove failed');
    },
  };
}

/* ── Capacitor / Android bridge ──────────────────────────────────────── */

function capacitorFs(): AddonFs {
  const capPath = (rel: string) => `${ADDONS_DIR}/${normalizeRel(rel)}`;
  const capRoot = () => ADDONS_DIR;
  return {
    ensureAddonsDir: async () => {
      try {
        await Filesystem.mkdir({ path: capRoot(), directory: Directory.Data, recursive: true });
      } catch {
        // already exists
      }
    },
    rootPath: async () => {
      try {
        const res = await Filesystem.getUri({ path: capRoot(), directory: Directory.Data });
        return res.uri;
      } catch {
        return `${ADDONS_DIR} (Directory.Data)`;
      }
    },
    listAddonDirs: async () => {
      await Filesystem.mkdir({ path: capRoot(), directory: Directory.Data, recursive: true }).catch(() => undefined);
      const res = await Filesystem.readdir({ path: capRoot(), directory: Directory.Data });
      return res.files.filter((f) => f.type === 'directory').map((f) => f.name);
    },
    listFiles: async (relDir) => {
      const base = capPath(relDir);
      const out: string[] = [];
      const walk = async (dir: string, prefix: string): Promise<void> => {
        const res = await Filesystem.readdir({ path: dir, directory: Directory.Data });
        for (const f of res.files) {
          const rel = prefix ? `${prefix}/${f.name}` : f.name;
          if (f.type === 'directory') await walk(`${dir}/${f.name}`, rel);
          else out.push(rel);
        }
      };
      try {
        await walk(base, '');
      } catch {
        // missing dir -> empty list
      }
      return out.sort();
    },
    exists: async (relPath) => {
      try {
        await Filesystem.stat({ path: capPath(relPath), directory: Directory.Data });
        return true;
      } catch {
        return false;
      }
    },
    read: async (relPath, encoding = 'utf8') => {
      const rel = normalizeRel(relPath);
      const res = await Filesystem.readFile({
        path: capPath(rel),
        directory: Directory.Data,
        ...(encoding === 'utf8' ? { encoding: Encoding.UTF8 } : {}),
      });
      return { path: rel, encoding, data: String(res.data) };
    },
    write: async (relPath, data) => {
      const rel = normalizeRel(relPath);
      const encoding: AddonFsEncoding = typeof data === 'string' ? 'utf8' : 'base64';
      const payload = typeof data === 'string' ? data : toBase64(data);
      await Filesystem.writeFile({
        path: capPath(rel),
        directory: Directory.Data,
        data: payload,
        recursive: true,
        ...(encoding === 'utf8' ? { encoding: Encoding.UTF8 } : {}),
      });
    },
    remove: async (relPath) => {
      const p = capPath(relPath);
      try {
        const st = await Filesystem.stat({ path: p, directory: Directory.Data });
        if (st.type === 'directory') {
          await Filesystem.rmdir({ path: p, directory: Directory.Data, recursive: true });
        } else {
          await Filesystem.deleteFile({ path: p, directory: Directory.Data });
        }
      } catch {
        // missing is fine
      }
    },
  };
}

/* ── Web dev virtual FS (localStorage) ───────────────────────────────── */

type WebFsMap = Record<string, AddonFsEntry>;

function webLoad(): WebFsMap {
  try {
    return JSON.parse(localStorage.getItem(WEB_FS_KEY) || '{}') as WebFsMap;
  } catch {
    return {};
  }
}

function webSave(map: WebFsMap): void {
  localStorage.setItem(WEB_FS_KEY, JSON.stringify(map));
}

function webFs(): AddonFs {
  const keyOf = (rel: string) => `${ADDONS_DIR}/${normalizeRel(rel)}`;
  return {
    ensureAddonsDir: async () => undefined,
    rootPath: async () => null,
    listAddonDirs: async () => {
      const map = webLoad();
      const dirs = new Set<string>();
      for (const key of Object.keys(map)) {
        const parts = key.split('/');
        if (parts[0] === ADDONS_DIR && parts.length >= 3) dirs.add(parts[1]);
      }
      return [...dirs].sort();
    },
    listFiles: async (relDir) => {
      const prefix = `${keyOf(relDir)}/`;
      return Object.keys(webLoad())
        .filter((k) => k.startsWith(prefix))
        .map((k) => k.slice(prefix.length))
        .sort();
    },
    exists: async (relPath) => {
      const k = keyOf(relPath);
      const map = webLoad();
      if (map[k]) return true;
      const prefix = `${k}/`;
      return Object.keys(map).some((key) => key.startsWith(prefix));
    },
    read: async (relPath, encoding = 'utf8') => {
      const entry = webLoad()[keyOf(relPath)];
      if (!entry) return null;
      return { ...entry, path: normalizeRel(relPath), encoding };
    },
    write: async (relPath, data) => {
      const rel = normalizeRel(relPath);
      const map = webLoad();
      map[keyOf(rel)] = {
        path: rel,
        encoding: typeof data === 'string' ? 'utf8' : 'base64',
        data: typeof data === 'string' ? data : toBase64(data),
      };
      webSave(map);
    },
    remove: async (relPath) => {
      const k = keyOf(relPath);
      const map = webLoad();
      for (const key of Object.keys(map)) {
        if (key === k || key.startsWith(`${k}/`)) delete map[key];
      }
      webSave(map);
    },
  };
}

/* ── detection ───────────────────────────────────────────────────────── */

let cached: AddonFs | null = null;

export async function getAddonFs(): Promise<AddonFs> {
  if (cached) return cached;
  const w = window as unknown as { ankiDesktop?: { isDesktop?: boolean }; Capacitor?: { isNativePlatform?: () => boolean } };
  if (w.ankiDesktop?.isDesktop) cached = desktopFs();
  else if (Capacitor.isNativePlatform()) cached = capacitorFs();
  else cached = webFs();
  return cached;
}
