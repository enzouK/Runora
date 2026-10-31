/**
 * Addon persistence: reads/writes the on-device "Addons" folder through the
 * cross-platform FS layer (Electron userData, Capacitor Filesystem, or web
 * localStorage in dev) and keeps enabled/disabled state in Addons/settings.json.
 */
import JSZip from 'jszip';
import type { AddonManifest } from './addonSystem';
import { getAddonFs, normalizeRel } from './addonFs';

export interface AddonSettings {
  addons: Record<string, { enabled: boolean }>;
}

const SETTINGS_PATH = 'settings.json';
const TEXT_EXT = ['.js', '.mjs', '.cjs', '.json', '.txt', '.md', '.html', '.htm', '.css', '.svg', '.xml', '.yaml', '.yml'];

export async function readSettings(): Promise<AddonSettings> {
  const fs = await getAddonFs();
  const entry = await fs.read(SETTINGS_PATH, 'utf8');
  if (!entry) return { addons: {} };
  try {
    const parsed = JSON.parse(entry.data) as Partial<AddonSettings>;
    return { addons: parsed.addons && typeof parsed.addons === 'object' ? parsed.addons : {} };
  } catch {
    return { addons: {} };
  }
}

export async function writeSettings(settings: AddonSettings): Promise<void> {
  const fs = await getAddonFs();
  await fs.write(SETTINGS_PATH, JSON.stringify(settings, null, 2));
}

export async function setAddonEnabled(id: string, enabled: boolean): Promise<void> {
  const settings = await readSettings();
  settings.addons[id] = { enabled };
  await writeSettings(settings);
}

function sanitizeAddonId(id: unknown): string | null {
  if (typeof id !== 'string') return null;
  const trimmed = id.trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9-_]{0,63}$/.test(trimmed)) return null;
  return trimmed;
}

function validateManifest(raw: unknown): AddonManifest | null {
  if (!raw || typeof raw !== 'object') return null;
  const m = raw as Record<string, unknown>;
  const id = sanitizeAddonId(m.id);
  if (!id) return null;
  if (typeof m.name !== 'string' || !m.name.trim()) return null;
  if (typeof m.version !== 'string' || !m.version.trim()) return null;
  if (typeof m.description !== 'string') return null;
  const manifest: AddonManifest = {
    id,
    name: m.name.trim(),
    version: m.version.trim(),
    description: m.description,
    enabled: typeof m.enabled === 'boolean' ? m.enabled : true,
  };
  if (typeof m.author === 'string') manifest.author = m.author;
  if (typeof m.script === 'string') manifest.script = m.script;
  return manifest;
}

export async function listAddons(): Promise<AddonManifest[]> {
  const fs = await getAddonFs();
  await fs.ensureAddonsDir();
  const dirs = await fs.listAddonDirs();
  const settings = await readSettings();
  const out: AddonManifest[] = [];
  for (const dir of dirs) {
    const entry = await fs.read(`${dir}/manifest.json`, 'utf8');
    if (!entry) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(entry.data);
    } catch {
      continue;
    }
    const manifest = validateManifest(parsed);
    if (!manifest) continue;
    const stored = settings.addons[manifest.id];
    out.push({ ...manifest, script: undefined, enabled: stored ? stored.enabled : manifest.enabled });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

export interface ImportAddonResult {
  ok: boolean;
  code?: 'exists' | 'invalid' | 'io';
  message: string;
  replaced?: boolean;
  manifest?: AddonManifest;
}

function safeEntryPath(p: string): string | null {
  try {
    const rel = normalizeRel(p.replace(/^\.?\//, ''));
    if (rel === 'manifest.json') return rel;
    return rel;
  } catch {
    return null;
  }
}

export async function importAddonFile(file: File, overwrite = false): Promise<ImportAddonResult> {
  const fs = await getAddonFs();
  await fs.ensureAddonsDir();
  const lowerName = file.name.toLowerCase();

  let manifest: AddonManifest | null = null;
  const files = new Map<string, string | Uint8Array>();

  try {
    if (lowerName.endsWith('.json')) {
      const text = await file.text();
      const parsed = JSON.parse(text) as unknown;
      manifest = validateManifest(parsed);
      if (!manifest) return { ok: false, code: 'invalid', message: 'Arquivo JSON inválido: manifest precisa de id, name, version e description.' };
      const storedManifest: Record<string, unknown> = { ...(parsed as Record<string, unknown>) };
      delete storedManifest.script;
      files.set('manifest.json', JSON.stringify(storedManifest, null, 2));
      if (manifest.script) files.set('main.js', manifest.script);
    } else if (lowerName.endsWith('.zip') || lowerName.endsWith('.anki2addon')) {
      const buf = await file.arrayBuffer();
      const zip = await JSZip.loadAsync(buf);
      const names = Object.keys(zip.files);
      const manifestName =
        names.find((n) => n.replace(/^\.?\//, '') === 'manifest.json') ||
        names.find((n) => n.replace(/^\.?\//, '').endsWith('/manifest.json'));
      if (!manifestName) {
        return { ok: false, code: 'invalid', message: 'Pacote inválido: não encontrei manifest.json na raiz do arquivo.' };
      }
      const manifestFile = zip.file(manifestName);
      if (!manifestFile) return { ok: false, code: 'invalid', message: 'Pacote inválido: manifest.json não pôde ser lido.' };
      const parsed = JSON.parse(await manifestFile.async('string')) as unknown;
      manifest = validateManifest(parsed);
      if (!manifest) return { ok: false, code: 'invalid', message: 'manifest.json inválido: precisa de id, name, version e description.' };

      const base = manifestName.includes('/') ? manifestName.slice(0, manifestName.lastIndexOf('/') + 1) : '';
      for (const name of names) {
        const zf = zip.files[name];
        if (zf.dir) continue;
        const relRaw = name.startsWith(base) ? name.slice(base.length) : name;
        const rel = safeEntryPath(relRaw);
        if (!rel) continue;
        const lower = rel.toLowerCase();
        if (TEXT_EXT.some((ext) => lower.endsWith(ext))) {
          files.set(rel, await zf.async('string'));
        } else {
          files.set(rel, await zf.async('uint8array'));
        }
      }
      const storedManifest: Record<string, unknown> = { ...(parsed as Record<string, unknown>) };
      delete storedManifest.script;
      files.set('manifest.json', JSON.stringify(storedManifest, null, 2));
      if (manifest.script && !files.has('main.js')) files.set('main.js', manifest.script);
    } else {
      return { ok: false, code: 'invalid', message: 'Formato não suportado. Use .json (manifest com script inline) ou .anki2addon/.zip (pacote).' };
    }
  } catch (err) {
    return { ok: false, code: 'io', message: `Falha ao ler o arquivo: ${err instanceof Error ? err.message : String(err)}` };
  }

  if (!manifest) return { ok: false, code: 'invalid', message: 'Manifest inválido.' };

  const exists = await fs.exists(`${manifest.id}/manifest.json`);
  if (exists && !overwrite) {
    return {
      ok: false,
      code: 'exists',
      message: `Já existe um addon com id "${manifest.id}". Deseja substituir?`,
      manifest,
    };
  }

  try {
    if (exists) await fs.remove(manifest.id);
    for (const [rel, data] of files.entries()) {
      await fs.write(`${manifest.id}/${rel}`, data);
    }
    const settings = await readSettings();
    const previous = settings.addons[manifest.id]?.enabled;
    settings.addons[manifest.id] = { enabled: previous ?? manifest.enabled ?? true };
    await writeSettings(settings);
    return {
      ok: true,
      message: `Addon "${manifest.name}" importado${exists ? ' (substituído)' : ''}.`,
      replaced: exists,
      manifest,
    };
  } catch (err) {
    return { ok: false, code: 'io', message: `Falha ao salvar na pasta Addons: ${err instanceof Error ? err.message : String(err)}` };
  }
}
