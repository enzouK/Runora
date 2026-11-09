import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import {
  AUTO_SYNC_ENABLED_KEY,
  AUTO_SYNC_INTERVAL_KEY,
  AUTO_SYNC_ON_OPEN_KEY,
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

/** O localStorage não existe no Node — substituto em memória. */
class MemoryStorage {
  private map = new Map<string, string>();
  getItem(key: string): string | null {
    return this.map.has(key) ? this.map.get(key)! : null;
  }
  setItem(key: string, value: string): void {
    this.map.set(key, String(value));
  }
  removeItem(key: string): void {
    this.map.delete(key);
  }
  clear(): void {
    this.map.clear();
  }
}

Object.defineProperty(globalThis, 'localStorage', {
  value: new MemoryStorage(),
  configurable: true,
  writable: true,
});

describe('configuração do autosync (ligar/desligar + intervalo)', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('o autosync começa ligado, com 5 minutos de intervalo', () => {
    assert.equal(getAutoSyncEnabled(), true);
    assert.equal(getAutoSyncIntervalMinutes(), DEFAULT_AUTO_SYNC_MINUTES);
    assert.equal(DEFAULT_AUTO_SYNC_MINUTES, 5);
  });

  it('dá para desligar e ligar o autosync', () => {
    setAutoSyncEnabled(false);
    assert.equal(getAutoSyncEnabled(), false);
    setAutoSyncEnabled(true);
    assert.equal(getAutoSyncEnabled(), true);
  });

  it('dá para desligar e ligar a sincronização ao abrir o app', () => {
    // padrão: ligada
    assert.equal(getAutoSyncOnOpen(), true);
    setAutoSyncOnOpen(false);
    assert.equal(getAutoSyncOnOpen(), false);
    setAutoSyncOnOpen(true);
    assert.equal(getAutoSyncOnOpen(), true);
  });

  it('as duas opções são independentes', () => {
    setAutoSyncEnabled(false);
    setAutoSyncOnOpen(true);
    assert.equal(getAutoSyncEnabled(), false);
    assert.equal(getAutoSyncOnOpen(), true);

    setAutoSyncEnabled(true);
    setAutoSyncOnOpen(false);
    assert.equal(getAutoSyncEnabled(), true);
    assert.equal(getAutoSyncOnOpen(), false);
  });

  it('quem já tinha desligado o autosync antigo continua sem sync ao abrir', () => {
    // valor antigo gravado, sem a opção nova
    localStorage.setItem(AUTO_SYNC_ENABLED_KEY, '0');
    assert.equal(getAutoSyncOnOpen(), false);
    // a migração acontece uma vez só (a partir daí as opções são independentes)
    assert.equal(localStorage.getItem(AUTO_SYNC_ON_OPEN_KEY), '0');
    setAutoSyncEnabled(true);
    assert.equal(getAutoSyncOnOpen(), false);
    // a opção nova tem prioridade
    setAutoSyncOnOpen(true);
    assert.equal(getAutoSyncOnOpen(), true);
  });

  it('guarda o intervalo escolhido (em minutos)', () => {
    setAutoSyncIntervalMinutes(30);
    assert.equal(getAutoSyncIntervalMinutes(), 30);
    setAutoSyncIntervalMinutes(120); // 2 horas
    assert.equal(getAutoSyncIntervalMinutes(), 120);
    assert.equal(localStorage.getItem(AUTO_SYNC_INTERVAL_KEY), '120');
  });

  it('aceita valores absurdos sem quebrar (limites)', () => {
    setAutoSyncIntervalMinutes(0);
    assert.equal(getAutoSyncIntervalMinutes(), MIN_AUTO_SYNC_MINUTES);
    setAutoSyncIntervalMinutes(-10);
    assert.equal(getAutoSyncIntervalMinutes(), MIN_AUTO_SYNC_MINUTES);
    setAutoSyncIntervalMinutes(999999);
    assert.equal(getAutoSyncIntervalMinutes(), MAX_AUTO_SYNC_MINUTES);
    setAutoSyncIntervalMinutes(Number.NaN);
    assert.equal(getAutoSyncIntervalMinutes(), DEFAULT_AUTO_SYNC_MINUTES);
  });

  it('ignora um valor gravado que não é número', () => {
    localStorage.setItem(AUTO_SYNC_INTERVAL_KEY, 'abc');
    assert.equal(getAutoSyncIntervalMinutes(), DEFAULT_AUTO_SYNC_MINUTES);
  });

  it('usa as chaves de localStorage esperadas', () => {
    assert.equal(AUTO_SYNC_ENABLED_KEY, 'runora_auto_sync');
    assert.equal(AUTO_SYNC_ON_OPEN_KEY, 'runora_auto_sync_open');
    assert.equal(AUTO_SYNC_INTERVAL_KEY, 'runora_gdrive_autosync_minutes');
  });
});
