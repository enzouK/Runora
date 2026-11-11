/**
 * Testes do cronômetro de sync (syncTiming).
 */
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  SyncTiming,
  countDriveCall,
  resetDriveCallCount,
  __setForceDev,
} from './syncTiming';

describe('syncTiming', () => {
  beforeEach(() => {
    resetDriveCallCount();
    __setForceDev(true);
  });
  afterEach(() => {
    __setForceDev(false);
  });

  it('countDriveCall() incrementa o contador', () => {
    countDriveCall();
    countDriveCall();
    assert.equal(resetDriveCallCount(), 2);
  });

  it('resetDriveCallCount() zera e retorna o valor anterior', () => {
    countDriveCall();
    assert.equal(resetDriveCallCount(), 1);
    assert.equal(resetDriveCallCount(), 0);
  });

  it('SyncTiming: mark() acumula tempo e chamadas por etapa', async () => {
    const t = new SyncTiming();
    // simula uma etapa
    t.mark('etapa1');
    await new Promise((r) => setTimeout(r, 50));
    t.mark('etapa2');
    const entries = t.getEntries();
    assert.equal(entries.length, 2);
    assert.equal(entries[0].stage, 'início'); // primeira mark fecha 'início'
    assert.equal(entries[1].stage, 'etapa1'); // segunda mark fecha 'etapa1'
    assert.ok(entries[1].ms >= 50); // tempo entre primeira e segunda mark
  });

  it('SyncTiming: track() mede tempo e chama a função', async () => {
    const t = new SyncTiming();
    let called = false;
    await t.track('teste', async () => {
      await new Promise((r) => setTimeout(r, 30));
      called = true;
    });
    assert.ok(called);
    // track() chama mark('teste') que fecha a etapa 'início' (tempo desde construção até aqui).
    // O tempo da função fica na etapa 'teste', que só é fechada por getReport() ou próximo mark().
    const entries = t.getEntries();
    assert.equal(entries.length, 1);
    assert.equal(entries[0].stage, 'início');
    // getReport() fecha a etapa atual ('teste') e inclui no relatório
    const report = t.getReport();
    assert.ok(report.includes('teste'));
    assert.ok(report.includes('TOTAL'));
  });

  it('SyncTiming: getReport() formata o relatório corretamente', async () => {
    const t = new SyncTiming();
    await t.track('etapa1', async () => {
      await new Promise((r) => setTimeout(r, 20));
    });
    await t.track('etapa2', async () => {
      await new Promise((r) => setTimeout(r, 10));
    });
    const report = t.getReport();
    assert.ok(report.includes('etapa1'));
    assert.ok(report.includes('etapa2'));
    assert.ok(report.includes('TOTAL'));
  });

  it('SyncTiming: getTotalMs() e getTotalCalls() retornam totais', async () => {
    const t = new SyncTiming();
    countDriveCall();
    countDriveCall();
    await t.track('etapa', async () => {});
    assert.ok(t.getTotalMs() >= 0);
    assert.equal(t.getTotalCalls(), 2);
  });
});