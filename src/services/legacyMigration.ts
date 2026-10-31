/**
 * One-time migration from the legacy "anki2*" storage identifiers to "runora*"
 * (app rebrand). Goal: rename every technical identifier AND leave no orphaned
 * data behind — legacy localStorage keys are copied to the new name and then
 * REMOVED, and legacy IndexedDB databases are copied into the new ones and
 * then DELETED, so there is no junk left that would require a cache clear.
 * Idempotent: safe to run on every startup.
 */

/** legacy localStorage key → new key */
const LEGACY_LS: Record<string, string> = {
  anki2_decks: 'runora_decks',
  anki2_notetypes: 'runora_notetypes',
  anki2_notes: 'runora_notes',
  anki2_cards: 'runora_cards',
  anki2_revlog: 'runora_revlog',
  anki2_fsrs_settings: 'runora_fsrs_settings',
  anki2_seed_version: 'runora_seed_version',
  anki2_deleted_defaults: 'runora_deleted_defaults',
  anki2_prefs: 'runora_prefs',
  anki2_presets: 'runora_presets',
  anki2_theme: 'runora_theme',
  anki2_color_theme: 'runora_color_theme',
  anki2_gdrive_client_id: 'runora_gdrive_client_id',
  anki2_gdrive_token: 'runora_gdrive_token',
  anki2_device_id: 'runora_device_id',
  anki2_last_sync: 'runora_last_sync',
  anki2_auto_sync: 'runora_auto_sync',
  anki2_sync_running: 'runora_sync_running',
  anki2_addons_fs_v1: 'runora_addons_fs_v1',
};

export function migrateLegacyLocalStorage(): void {
  try {
    for (const [oldKey, newKey] of Object.entries(LEGACY_LS)) {
      const value = localStorage.getItem(oldKey);
      if (value === null) continue;
      if (localStorage.getItem(newKey) === null) localStorage.setItem(newKey, value);
      localStorage.removeItem(oldKey); // delete the orphaned legacy key
    }
  } catch {
    /* storage unavailable — nothing to migrate */
  }
}

/**
 * Copy every object store from the legacy IndexedDB database `oldName` into
 * `newName`, then DELETE the legacy database so no orphaned copy remains.
 *
 * Robustness rules (important — the legacy DB holds the user's real media):
 * - Read each old store fully with getAll()/getAllKeys(), then write ALL entries
 *   in ONE readwrite transaction per store (issuing every put() synchronously).
 *   Interleaving a cursor on the source tx with puts on a destination tx fails
 *   with TransactionInactiveError, which must NOT abort the migration halfway.
 * - put() is an upsert, so re-running the copy is idempotent and safe.
 * - The legacy DB is deleted ONLY after the copy fully succeeded; on any error
 *   it is kept and the migration retries on the next run. Never delete first.
 */
export async function migrateLegacyIDB(oldName: string, newName: string): Promise<void> {
  try {
    if (typeof indexedDB === 'undefined' || !indexedDB.databases) return;
    const dbs = await indexedDB.databases();
    if (!dbs.some((d) => d.name === oldName)) return;

    const open = (name: string, version?: number, upgrade?: (db: IDBDatabase) => void) =>
      new Promise<IDBDatabase>((resolve, reject) => {
        const req = version === undefined ? indexedDB.open(name) : indexedDB.open(name, version);
        if (upgrade) req.onupgradeneeded = () => upgrade(req.result);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });

    // 1. Snapshot the legacy DB (per-store getAll — no cross-transaction cursor).
    const oldDb = await open(oldName);
    const oldVersion = oldDb.version;
    let snapshot: Record<string, { keys: IDBValidKey[]; values: unknown[] }> = {};
    try {
      const stores = Array.from(oldDb.objectStoreNames);
      for (const s of stores) {
        const os = oldDb.transaction(s, 'readonly').objectStore(s);
        const [values, keys] = await Promise.all([
          new Promise<unknown[]>((resolve, reject) => {
            const q = os.getAll();
            q.onsuccess = () => resolve(q.result);
            q.onerror = () => reject(q.error);
          }),
          new Promise<IDBValidKey[]>((resolve, reject) => {
            const q = os.getAllKeys();
            q.onsuccess = () => resolve(q.result);
            q.onerror = () => reject(q.error);
          }),
        ]);
        snapshot[s] = { keys, values };
      }
    } finally {
      oldDb.close();
    }

    // 2. Write everything into the new DB (create it with the same stores if missing).
    const newExists = dbs.some((d) => d.name === newName);
    const newDb = await open(
      newName,
      newExists ? undefined : Math.max(1, oldVersion),
      (db) => {
        for (const s of Object.keys(snapshot)) {
          if (!db.objectStoreNames.contains(s)) db.createObjectStore(s);
        }
      }
    );
    try {
      for (const [s, { keys, values }] of Object.entries(snapshot)) {
        if (!newDb.objectStoreNames.contains(s)) {
          // New DB existed but lacks this store — recreate via version bump is
          // overkill; store schemas here are simple, so upgrade in place is not
          // possible without closing. Treat as fatal for this run (old DB kept).
          throw new Error(`target db missing store "${s}"`);
        }
        await new Promise<void>((resolve, reject) => {
          const tx = newDb.transaction(s, 'readwrite');
          const os = tx.objectStore(s);
          for (let i = 0; i < values.length; i++) os.put(values[i], keys[i]);
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error);
          tx.onabort = () => reject(tx.error);
        });
      }
    } finally {
      newDb.close();
    }

    // 3. Copy fully succeeded — only NOW delete the legacy database, so no
    //    orphaned data remains and no data is ever lost.
    await new Promise<void>((resolve) => {
      const req = indexedDB.deleteDatabase(oldName);
      req.onsuccess = req.onerror = req.onblocked = () => resolve();
    });
  } catch {
    /* best-effort: on failure the legacy DB is kept and the migration retries */
  }
}

// Run the localStorage migration as soon as this module is imported. It is the
// first import in main.tsx, so it executes before any other module reads storage.
migrateLegacyLocalStorage();
