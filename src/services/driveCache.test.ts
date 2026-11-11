/**
 * Testes do cache persistente do Drive (driveCache).
 */
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  createMemoryBackend,
  __setMemoryBackendForTests,
  readDriveCache,
  writeDriveCache,
  getCachedFolderId,
  setCachedFolderId,
  getCachedFileId,
  setCachedFileId,
  deleteCachedFileId,
  isMigrationDone,
  setMigrationDone,
  clearDriveCache,
} from './driveCache';

describe('driveCache (MemoryBackend)', () => {
  beforeEach(() => {
    __setMemoryBackendForTests();
    // limpa antes de cada teste
    clearDriveCache();
  });

  it('read/write básico', async () => {
    await writeDriveCache({ folderId: 'folder123', fileIds: { 'file.json': 'id456' }, migrationDone: true });
    const data = await readDriveCache();
    assert.equal(data.folderId, 'folder123');
    assert.equal(data.fileIds['file.json'], 'id456');
    assert.equal(data.migrationDone, true);
  });

  it('folderId', async () => {
    assert.equal(await getCachedFolderId(), null);
    await setCachedFolderId('my-folder');
    assert.equal(await getCachedFolderId(), 'my-folder');
  });

  it('fileIds', async () => {
    assert.equal(await getCachedFileId('meta.json'), null);
    await setCachedFileId('meta.json', 'meta-id');
    assert.equal(await getCachedFileId('meta.json'), 'meta-id');
    await deleteCachedFileId('meta.json');
    assert.equal(await getCachedFileId('meta.json'), null);
  });

  it('migration flag', async () => {
    assert.equal(await isMigrationDone(), false);
    await setMigrationDone();
    assert.equal(await isMigrationDone(), true);
  });

  it('clear limpa tudo', async () => {
    await setCachedFolderId('f');
    await setCachedFileId('x', '1');
    await setMigrationDone();
    await clearDriveCache();
    const data = await readDriveCache();
    assert.equal(data.folderId, undefined);
    assert.deepEqual(data.fileIds, {});
    assert.equal(data.migrationDone, false);
  });

  it('dados padrão quando cache vazio', async () => {
    await clearDriveCache();
    const data = await readDriveCache();
    assert.deepEqual(data, { fileIds: {}, migrationDone: false });
  });
});