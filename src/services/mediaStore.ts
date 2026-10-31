/**
 * MediaStore — persistent binary media storage backed by IndexedDB.
 *
 * Like a collection.media folder, media is stored by FILE NAME and
 * references in card content ([sound:x.mp3], <img src="x.png">) are resolved
 * at render time into blob: URLs. Works identically in the browser and inside
 * Tauri/Capacitor WebViews, so imported media carries over when packaging.
 */

import { migrateLegacyIDB } from './legacyMigration';

const DB_NAME = 'runora_media';
const LEGACY_DB_NAME = 'anki2_media'; // pre-rebrand name — migrated & deleted on first run
const STORE = 'media';
const DB_VERSION = 1;

const urlCache = new Map<string, string>(); // filename -> object URL

export class MediaStore {
  private static dbPromise: Promise<IDBDatabase> | null = null;

  private static open(): Promise<IDBDatabase> {
    if (!this.dbPromise) {
      this.dbPromise = (async () => {
        // Copy the legacy anki2_media DB into runora_media, then DELETE the
        // legacy DB so no orphaned media data is left behind.
        await migrateLegacyIDB(LEGACY_DB_NAME, DB_NAME);
        return new Promise<IDBDatabase>((resolve, reject) => {
          const req = indexedDB.open(DB_NAME, DB_VERSION);
          req.onupgradeneeded = () => {
            if (!req.result.objectStoreNames.contains(STORE)) {
              req.result.createObjectStore(STORE);
            }
          };
          req.onsuccess = () => resolve(req.result);
          req.onerror = () => reject(req.error);
        });
      })();
    }
    return this.dbPromise;
  }

  private static async tx<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const t = db.transaction(STORE, mode);
      const req = fn(t.objectStore(STORE));
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
      t.onerror = () => reject(t.error);
    });
  }

  /** Store a blob under a filename. */
  public static async put(name: string, blob: Blob): Promise<void> {
    await this.tx('readwrite', (s) => s.put(blob, name));
    urlCache.delete(name); // invalidate any cached URL
  }

  /** Get the blob for a filename (or null). */
  public static async get(name: string): Promise<Blob | null> {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const req = db.transaction(STORE, 'readonly').objectStore(STORE).get(name);
      req.onsuccess = () => resolve((req.result as Blob) ?? null);
      req.onerror = () => reject(req.error);
    });
  }

  /** Whether a given media file exists. */
  public static async has(name: string): Promise<boolean> {
    return (await this.get(name)) !== null;
  }

  /** Get (and cache) an object URL for a media filename; null if missing. */
  public static async getUrl(name: string): Promise<string | null> {
    const cached = urlCache.get(name);
    if (cached) return cached;
    const blob = await this.get(name);
    if (!blob) return null;
    const url = URL.createObjectURL(blob);
    urlCache.set(name, url);
    return url;
  }

  /** Delete one media file. */
  public static async remove(name: string): Promise<void> {
    await this.tx('readwrite', (s) => s.delete(name));
    const cached = urlCache.get(name);
    if (cached) {
      URL.revokeObjectURL(cached);
      urlCache.delete(name);
    }
  }

  /** List all stored media names. */
  public static async list(): Promise<string[]> {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const req = db.transaction(STORE, 'readonly').objectStore(STORE).getAllKeys();
      req.onsuccess = () => resolve((req.result as IDBValidKey[]).map(String));
      req.onerror = () => reject(req.error);
    });
  }

  /** Total stored bytes (estimate). */
  public static async totalBytes(): Promise<number> {
    const names = await this.list();
    let total = 0;
    for (const n of names) {
      const blob = await this.get(n);
      if (blob) total += blob.size;
    }
    return total;
  }

  /** Wipe everything (used by collection reset). */
  public static async clear(): Promise<void> {
    const db = await this.open();
    await new Promise<void>((resolve, reject) => {
      const t = db.transaction(STORE, 'readwrite');
      const req = t.objectStore(STORE).clear();
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
    for (const url of urlCache.values()) URL.revokeObjectURL(url);
    urlCache.clear();
  }

  /**
   * Is a "URL" actually a bare media filename to be resolved from the store?
   * (Not http(s), data:, or blob: and has a media-like extension or exists.)
   */
  public static isMediaReference(src: string): boolean {
    if (!src) return false;
    if (/^(https?:|data:|blob:|#)/i.test(src)) return false;
    return true; // bare filename like "vcm_123.webm" or "image.png"
  }

  /**
   * Resolve all media references inside an HTML string into blob: URLs.
   * Handles <... src="file"> attributes and [sound:file] tags.
   */
  public static async resolveHtml(html: string): Promise<{ html: string; missing: string[] }> {
    if (!html) return { html, missing: [] };

    const names = new Set<string>();
    const srcRe = /\bsrc=["']([^"']+)["']/gi;
    let m: RegExpExecArray | null;
    while ((m = srcRe.exec(html)) !== null) {
      if (this.isMediaReference(m[1])) names.add(m[1]);
    }
    const soundRe = /\[sound:([^\]]+)\]/gi;
    while ((m = soundRe.exec(html)) !== null) {
      const name = m[1].trim();
      if (this.isMediaReference(name)) {
        names.add(name);
      }
    }

    const missing: string[] = [];
    const urlByName = new Map<string, string>();
    await Promise.all(
      [...names].map(async (name) => {
        const url = await this.getUrl(name);
        if (url) urlByName.set(name, url);
        else missing.push(name);
      })
    );

    let out = html;
    // src attributes
    out = out.replace(srcRe, (full, src: string) => {
      const url = urlByName.get(src);
      return url ? `src="${url}"` : full;
    });
    // [sound:name] → [sound:blobUrl] (blob URLs never contain "]")
    out = out.replace(/\[sound:([^\]]+)\]/gi, (full, name: string) => {
      const url = urlByName.get(name.trim());
      return url ? `[sound:${url}]` : full;
    });

    return { html: out, missing };
  }
}
