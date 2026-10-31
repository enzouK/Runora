/**
 * Addon persistence: reads/writes the on-device "Addons" folder through the
 * cross-platform FS layer (Electron userData, Capacitor Filesystem, or web
 * localStorage in dev) and keeps enabled/disabled state in Addons/settings.json.
 */
import JSZip from 'jszip';
import type { AddonConfigField, AddonManifest } from './addonSystem';
import { getAddonFs, normalizeRel, fromBase64 } from './addonFs';

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

export async function removeAddon(id: string): Promise<void> {
  const fs = await getAddonFs();
  await fs.remove(id);
  const settings = await readSettings();
  if (settings.addons[id]) {
    delete settings.addons[id];
    await writeSettings(settings);
  }
}

/* ── Per-addon config (Addons/<id>/config.json) ───────────────────────── */

/**
 * Reads Addons/<id>/config.json merged with the defaults declared in the
 * manifest's configSchema. Unknown stored keys are preserved.
 */
export async function readAddonConfig(id: string): Promise<Record<string, unknown>> {
  const fs = await getAddonFs();
  let schema: AddonConfigField[] | undefined;
  const manifestEntry = await fs.read(`${id}/manifest.json`, 'utf8').catch(() => null);
  if (manifestEntry) {
    try {
      schema = validateManifest(JSON.parse(manifestEntry.data))?.configSchema;
    } catch {
      schema = undefined;
    }
  }

  let stored: Record<string, unknown> = {};
  const entry = await fs.read(`${id}/config.json`, 'utf8').catch(() => null);
  if (entry) {
    try {
      const parsed = JSON.parse(entry.data);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) stored = parsed as Record<string, unknown>;
    } catch {
      stored = {};
    }
  }

  const out: Record<string, unknown> = {};
  for (const field of schema || []) {
    out[field.key] = field.key in stored ? stored[field.key] : field.default;
  }
  for (const key of Object.keys(stored)) {
    if (!schema?.some((f) => f.key === key)) out[key] = stored[key];
  }
  return out;
}

export async function writeAddonConfig(id: string, config: Record<string, unknown>): Promise<void> {
  const fs = await getAddonFs();
  await fs.write(`${id}/config.json`, JSON.stringify(config, null, 2));
}

/* ── Per-addon data (Addons/<id>/data.json) ───────────────────────────── */

export async function readAddonData(id: string): Promise<Record<string, unknown>> {
  const fs = await getAddonFs();
  const entry = await fs.read(`${id}/data.json`, 'utf8').catch(() => null);
  if (!entry) return {};
  try {
    const parsed = JSON.parse(entry.data);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

export async function writeAddonData(id: string, data: Record<string, unknown>): Promise<void> {
  const fs = await getAddonFs();
  await fs.write(`${id}/data.json`, JSON.stringify(data, null, 2));
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
  if (typeof m.minAppVersion === 'string' && m.minAppVersion.trim()) {
    manifest.minAppVersion = m.minAppVersion.trim();
  }
  if (Array.isArray(m.configSchema)) {
    manifest.configSchema = m.configSchema.filter(
      (f): f is AddonConfigField =>
        !!f &&
        typeof f === 'object' &&
        typeof (f as AddonConfigField).key === 'string' &&
        typeof (f as AddonConfigField).label === 'string' &&
        ['string', 'number', 'boolean', 'color', 'select'].includes((f as AddonConfigField).type)
    );
  }
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
  manifests?: AddonManifest[];
}

interface ParsedAddon {
  manifest: AddonManifest;
  /** Files relative to the addon root (manifest.json included, script stripped). */
  files: Map<string, string | Uint8Array>;
}

interface ParsedPackage {
  addons: ParsedAddon[];
}

function safeEntryPath(p: string): string | null {
  try {
    return normalizeRel(p.replace(/^\.?\//, ''));
  } catch {
    return null;
  }
}

async function readZipEntries(zip: JSZip, base: string): Promise<Map<string, string | Uint8Array>> {
  const files = new Map<string, string | Uint8Array>();
  for (const name of Object.keys(zip.files)) {
    const zf = zip.files[name];
    if (zf.dir) continue;
    // Bundle mode (base = '<id>/'): keep ONLY this addon's folder, skip siblings.
    if (base && !name.startsWith(base)) continue;
    const relRaw = base ? name.slice(base.length) : name;
    const rel = safeEntryPath(relRaw);
    if (!rel) continue;
    const lower = rel.toLowerCase();
    if (TEXT_EXT.some((ext) => lower.endsWith(ext))) {
      files.set(rel, await zf.async('string'));
    } else {
      files.set(rel, await zf.async('uint8array'));
    }
  }
  return files;
}

function finalizeManifestFiles(parsedManifest: unknown, manifest: AddonManifest, files: Map<string, string | Uint8Array>): void {
  const storedManifest: Record<string, unknown> = { ...(parsedManifest as Record<string, unknown>) };
  delete storedManifest.script;
  files.set('manifest.json', JSON.stringify(storedManifest, null, 2));
  if (manifest.script && !files.has('main.js')) files.set('main.js', manifest.script);
}

/**
 * Parses an addon file into one or more addons:
 * - `.json`            -> single addon, manifest with optional inline `script`
 * - `.runoraaddon`/zip with manifest.json at the root -> single addon package
 *   (legacy `.anki2addon` files are still accepted on import)
 * - `.runoraaddon`/zip with `<id>/manifest.json` folders   -> multi-addon bundle
 *   (this is what Exportar produces when more than one addon is selected)
 */
async function parsePackage(file: File): Promise<ParsedPackage> {
  const lowerName = file.name.toLowerCase();

  if (lowerName.endsWith('.json')) {
    const parsed = JSON.parse(await file.text()) as unknown;
    const manifest = validateManifest(parsed);
    if (!manifest) throw new Error('Arquivo JSON inválido: manifest precisa de id, name, version e description.');
    const files = new Map<string, string | Uint8Array>();
    finalizeManifestFiles(parsed, manifest, files);
    return { addons: [{ manifest, files }] };
  }

  if (lowerName.endsWith('.zip') || lowerName.endsWith('.runoraaddon') || lowerName.endsWith('.anki2addon')) {
    const zip = await JSZip.loadAsync(await file.arrayBuffer());
    const names = Object.keys(zip.files);
    const clean = (n: string) => n.replace(/^\.?\//, '');

    // single-addon package: manifest.json at the root
    const rootManifest = names.find((n) => clean(n) === 'manifest.json');
    if (rootManifest) {
      const mf = zip.file(rootManifest);
      if (!mf) throw new Error('Pacote inválido: manifest.json não pôde ser lido.');
      const parsed = JSON.parse(await mf.async('string')) as unknown;
      const manifest = validateManifest(parsed);
      if (!manifest) throw new Error('manifest.json inválido: precisa de id, name, version e description.');
      const files = await readZipEntries(zip, '');
      finalizeManifestFiles(parsed, manifest, files);
      return { addons: [{ manifest, files }] };
    }

    // multi-addon bundle: one <id>/manifest.json per top-level folder
    const bundleManifests = names.filter((n) => /^[^/]+\/manifest\.json$/.test(clean(n)));
    if (bundleManifests.length > 0) {
      const addons: ParsedAddon[] = [];
      for (const manifestName of bundleManifests) {
        const base = `${clean(manifestName).slice(0, clean(manifestName).lastIndexOf('/') + 1)}`;
        const mf = zip.file(manifestName);
        if (!mf) continue;
        const parsed = JSON.parse(await mf.async('string')) as unknown;
        const manifest = validateManifest(parsed);
        if (!manifest) continue;
        const files = await readZipEntries(zip, base);
        finalizeManifestFiles(parsed, manifest, files);
        addons.push({ manifest, files });
      }
      if (addons.length > 0) return { addons };
    }

    throw new Error('Pacote inválido: não encontrei manifest.json (na raiz para 1 addon, ou em pastas <id>/manifest.json para vários).');
  }

  throw new Error('Formato não suportado. Use .json (manifest com script inline) ou .runoraaddon/.anki2addon/.zip (pacote).');
}

export async function importAddonFile(file: File, overwrite = false): Promise<ImportAddonResult> {
  const fs = await getAddonFs();
  await fs.ensureAddonsDir();

  let parsed: ParsedPackage;
  try {
    parsed = await parsePackage(file);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, code: /não suportado|inválido/i.test(msg) ? 'invalid' : 'io', message: msg.startsWith('Formato') || msg.includes('inválido') || msg.includes('não encontrei') ? msg : `Falha ao ler o arquivo: ${msg}` };
  }

  // Which of the packaged addons already exist on disk?
  const existing: string[] = [];
  for (const a of parsed.addons) {
    if (await fs.exists(`${a.manifest.id}/manifest.json`)) existing.push(a.manifest.id);
  }
  if (existing.length > 0 && !overwrite) {
    const message =
      existing.length === 1
        ? `Já existe um addon com id "${existing[0]}". Deseja substituir?`
        : `Já existem addons com estes ids: ${existing.join(', ')}. Deseja substituir todos?`;
    return { ok: false, code: 'exists', message, manifests: parsed.addons.map((a) => a.manifest) };
  }

  try {
    const settings = await readSettings();
    for (const a of parsed.addons) {
      if (existing.includes(a.manifest.id)) await fs.remove(a.manifest.id);
      for (const [rel, data] of a.files.entries()) {
        await fs.write(`${a.manifest.id}/${rel}`, data);
      }
      const previous = settings.addons[a.manifest.id]?.enabled;
      settings.addons[a.manifest.id] = { enabled: previous ?? a.manifest.enabled ?? true };
    }
    await writeSettings(settings);

    const first = parsed.addons[0].manifest;
    if (parsed.addons.length === 1) {
      return {
        ok: true,
        message: `Addon "${first.name}" importado${existing.length ? ' (substituído)' : ''}.`,
        replaced: existing.length > 0,
        manifest: first,
        manifests: [first],
      };
    }
    return {
      ok: true,
      message: `${parsed.addons.length} addons importados${existing.length ? ' (substituídos)' : ''}: ${parsed.addons.map((a) => a.manifest.name).join(', ')}.`,
      replaced: existing.length > 0,
      manifests: parsed.addons.map((a) => a.manifest),
    };
  } catch (err) {
    return { ok: false, code: 'io', message: `Falha ao salvar na pasta Addons: ${err instanceof Error ? err.message : String(err)}` };
  }
}

/* ── Export ───────────────────────────────────────────────────────────── */

export interface ExportAddonsResult {
  bytes: Uint8Array;
  fileName: string;
  count: number;
  names: string[];
}

/**
 * Builds an exportable package from installed addons:
 * - 1 addon  -> `<id>.runoraaddon` with the files at the zip root (single-addon format)
 * - N addons -> `runora-addons-<N>.runoraaddon` with one `<id>/` folder per addon
 * Every file of each addon folder is included — manifest.json, main.js,
 * config.json (the user's configured values), data.json and any assets.
 */
export async function exportAddons(ids: string[]): Promise<ExportAddonsResult> {
  const fs = await getAddonFs();
  const zip = new JSZip();
  const names: string[] = [];

  for (const id of ids) {
    const manifestEntry = await fs.read(`${id}/manifest.json`, 'utf8');
    if (!manifestEntry) throw new Error(`Addon "${id}" não tem manifest.json.`);
    const manifest = validateManifest(JSON.parse(manifestEntry.data));
    if (!manifest) throw new Error(`manifest.json inválido do addon "${id}".`);
    names.push(manifest.name);

    const target = ids.length === 1 ? zip : zip.folder(id)!;
    const files = await fs.listFiles(id);
    for (const rel of files) {
      const lower = rel.toLowerCase();
      const isText = TEXT_EXT.some((ext) => lower.endsWith(ext));
      const entry = await fs.read(`${id}/${rel}`, isText ? 'utf8' : 'base64');
      if (!entry) continue;
      if (isText) target.file(rel, entry.data);
      else target.file(rel, fromBase64(entry.data), { binary: true });
    }
  }

  const fileName = ids.length === 1 ? `${ids[0]}.runoraaddon` : `runora-addons-${ids.length}.runoraaddon`;
  const bytes = await zip.generateAsync({ type: 'uint8array' });
  return { bytes, fileName, count: ids.length, names };
}
