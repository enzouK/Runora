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
  markFileAbsent,
  clearFileAbsent,
  isFileMarkedAbsent,
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

  it('cache negativo: marca, confirma e limpa a ausência', async () => {
    assert.equal(await isFileMarkedAbsent('runora-sync-extras.json'), false);
    await markFileAbsent('runora-sync-extras.json');
    assert.equal(await isFileMarkedAbsent('runora-sync-extras.json'), true);
    // o id não pode existir junto com a marca de ausência
    await setCachedFileId('runora-sync-extras.json', 'id-antigo');
    await deleteCachedFileId('runora-sync-extras.json');
    assert.equal(await isFileMarkedAbsent('runora-sync-extras.json'), true);
    // o arquivo voltou a existir → limpa a marca
    await clearFileAbsent('runora-sync-extras.json');
    assert.equal(await isFileMarkedAbsent('runora-sync-extras.json'), false);
  });

  it('cache negativo: clearFileAbsent sem marca não estraga o cache', async () => {
    await setCachedFileId('x.json', 'id-x');
    await clearFileAbsent('x.json');
    const data = await readDriveCache();
    assert.equal(data.fileIds['x.json'], 'id-x');
    assert.deepEqual(data.absentFiles ?? {}, {});
  });

  it('cache negativo: guardar ausência não apaga folderId/migration', async () => {
    await setCachedFolderId('folder-1');
    await setMigrationDone();
    await markFileAbsent('runora-sync-delta-meta.json');
    const data = await readDriveCache();
    assert.equal(data.folderId, 'folder-1');
    assert.equal(data.migrationDone, true);
    assert.ok(data.absentFiles?.['runora-sync-delta-meta.json']);
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