/**
 * Cache persistente do Google Drive (IndexedDB).
 * Guarda:
 * - id da pasta "Runora"
 * - ids dos arquivos de sync (nome → id)
 * - flag "migração da raiz já feita"
 *
 * API desenhada para testes: o backend (IndexedDB ou memória) é injetado.
 */

export interface DriveCacheData {
  folderId?: string;
  fileIds: Record<string, string>; // nome do arquivo → id no Drive
  migrationDone: boolean;
}

export interface DriveCacheBackend {
  get(key: string): Promise<DriveCacheData | null>;
  set(key: string, value: DriveCacheData): Promise<void>;
  delete(key: string): Promise<void>;
}

const CACHE_KEY = 'drive_cache_v1';

/** Backend real: IndexedDB */
export async function createIndexedDBBackend(): Promise<DriveCacheBackend> {
  const dbName = 'runora_drive_cache';
  const storeName = 'cache';
  let dbPromise: Promise<IDBDatabase> | null = null;

  function openDb(): Promise<IDBDatabase> {
    if (!dbPromise) {
      dbPromise = new Promise((resolve, reject) => {
        const req = indexedDB.open(dbName, 1);
        req.onupgradeneeded = () => {
          if (!req.result.objectStoreNames.contains(storeName)) {
            req.result.createObjectStore(storeName);
          }
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
    }
    return dbPromise;
  }

  return {
    async get(key: string) {
      const db = await openDb();
      return new Promise((resolve, reject) => {
        const tx = db.transaction(storeName, 'readonly');
        const req = tx.objectStore(storeName).get(key);
        req.onsuccess = () => resolve(req.result ?? null);
        req.onerror = () => reject(req.error);
      });
    },
    async set(key: string, value: DriveCacheData) {
      const db = await openDb();
      return new Promise((resolve, reject) => {
        const tx = db.transaction(storeName, 'readwrite');
        tx.objectStore(storeName).put(value, key);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
    },
    async delete(key: string) {
      const db = await openDb();
      return new Promise((resolve, reject) => {
        const tx = db.transaction(storeName, 'readwrite');
        tx.objectStore(storeName).delete(key);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
    },
  };
}

/** Backend de memória (fallback e testes) */
export function createMemoryBackend(): DriveCacheBackend {
  const store = new Map<string, DriveCacheData>();
  return {
    async get(key) { return store.get(key) ?? null; },
    async set(key, value) { store.set(key, value); },
    async delete(key) { store.delete(key); },
  };
}

/** Instância singleton do cache */
let _backend: DriveCacheBackend | null = null;
let _memoryFallback = false;

/** Inicializa o cache (chamado uma vez no bootstrap do app). */
export async function initDriveCache(): Promise<void> {
  if (_backend) return;
  try {
    _backend = await createIndexedDBBackend();
    // teste rápido de escrita/leitura
    await _backend.set('__health_check__', { folderId: '', fileIds: {}, migrationDone: false });
    await _backend.get('__health_check__');
    await _backend.delete('__health_check__');
  } catch {
    // IndexedDB indisponível (privado, Safari, etc.) → memória
    _backend = createMemoryBackend();
    _memoryFallback = true;
  }
}

/** Retorna o backend atual (para testes). */
export function getDriveCacheBackend(): DriveCacheBackend | null {
  return _backend;
}

/** Força uso do backend de memória (testes). */
export function __setMemoryBackendForTests(): void {
  _backend = createMemoryBackend();
  _memoryFallback = true;
}

/** Lê o cache completo. */
export async function readDriveCache(): Promise<DriveCacheData> {
  await initDriveCache();
  const data = await _backend!.get(CACHE_KEY);
  return data ?? { fileIds: {}, migrationDone: false };
}

/** Escreve o cache completo. */
export async function writeDriveCache(data: DriveCacheData): Promise<void> {
  await initDriveCache();
  await _backend!.set(CACHE_KEY, data);
}

/** Obtém o id da pasta "Runora" do cache. */
export async function getCachedFolderId(): Promise<string | null> {
  const cache = await readDriveCache();
  return cache.folderId ?? null;
}

/** Guarda o id da pasta "Runora" no cache. */
export async function setCachedFolderId(folderId: string): Promise<void> {
  const cache = await readDriveCache();
  cache.folderId = folderId;
  await writeDriveCache(cache);
}

/** Obtém o id de um arquivo do cache. */
export async function getCachedFileId(fileName: string): Promise<string | null> {
  const cache = await readDriveCache();
  return cache.fileIds[fileName] ?? null;
}

/** Guarda o id de um arquivo no cache. */
export async function setCachedFileId(fileName: string, fileId: string): Promise<void> {
  const cache = await readDriveCache();
  cache.fileIds[fileName] = fileId;
  await writeDriveCache(cache);
}

/** Remove o id de um arquivo do cache (ex.: após 404). */
export async function deleteCachedFileId(fileName: string): Promise<void> {
  const cache = await readDriveCache();
  delete cache.fileIds[fileName];
  await writeDriveCache(cache);
}

/** Verifica se a migração da raiz já foi feita. */
export async function isMigrationDone(): Promise<boolean> {
  const cache = await readDriveCache();
  return cache.migrationDone === true;
}

/** Marca a migração da raiz como feita. */
export async function setMigrationDone(): Promise<void> {
  const cache = await readDriveCache();
  cache.migrationDone = true;
  await writeDriveCache(cache);
}

/** Limpa todo o cache (útil para testes ou "esquecer" o Drive). */
export async function clearDriveCache(): Promise<void> {
  await initDriveCache();
  await _backend!.delete(CACHE_KEY);
}

/** Indica se está usando fallback de memória. */
export function isUsingMemoryFallback(): boolean {
  return _memoryFallback;
}