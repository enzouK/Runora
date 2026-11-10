/**
 * Fase 5 do sync: preferências, temas e extensões vão para o Drive.
 *
 * Aqui são testadas as decisões (quem leva: Drive ou local) e a
 * aplicação das preferências/temas. O FS das extensões precisa do navegador,
 * então é testado no emulador.
 */
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { StorageService } from './storage';
import {
  applyExtrasPayload,
  buildExtrasPayload,
  decideSyncSide,
  hashAddonEntries,
  hashExtras,
  type SyncAddonEntry,
} from './syncExtras';

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

describe('Fase 5 — decide qual lado leva (extras e extensões)', () => {
  it('sem base (aparelho novo) o Drive ganha', () => {
    assert.equal(decideSyncSide(null, 'local', 'remote'), 'remote');
  });

  it('sem arquivo no Drive, o local sobe', () => {
    assert.equal(decideSyncSide('base', 'local', null), 'local');
    assert.equal(decideSyncSide(null, 'local', null), 'local');
  });

  it('só o Drive mudou → aplica o do Drive', () => {
    assert.equal(decideSyncSide('base', 'base', 'novo'), 'remote');
  });

  it('só o local mudou → sobe o local', () => {
    assert.equal(decideSyncSide('base', 'novo', 'base'), 'local');
  });

  it('os dois mudaram → o local leva (não se perde o que o usuário fez)', () => {
    assert.equal(decideSyncSide('base', 'novo', 'outro'), 'local');
  });

  it('nada mudou → não mexe em nada', () => {
    assert.equal(decideSyncSide('base', 'base', 'base'), 'none');
  });
});

describe('Fase 5 — preferências e temas', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('lê as preferências + temas do aparelho', () => {
    StorageService.setRolloverHour(5);
    StorageService.setTheme('dark');
    StorageService.setColorTheme('blue');
    const payload = buildExtrasPayload();
    assert.equal(payload.theme, 'dark');
    assert.equal(payload.colorTheme, 'blue');
    assert.equal(payload.prefs.rolloverHour, 5);
  });

  it('o hash muda quando uma preferência muda', () => {
    const a = buildExtrasPayload();
    const h1 = hashExtras(a);
    StorageService.setRolloverHour(6);
    const h2 = hashExtras(buildExtrasPayload());
    assert.notEqual(h1, h2);
  });

  it('o hash muda quando a configuração do autosync muda (vai para o Drive)', () => {
    const h1 = hashExtras(buildExtrasPayload());
    localStorage.setItem(
      'runora_prefs',
      JSON.stringify({ ...StorageService.getPrefs(), autoSync: false })
    );
    const h2 = hashExtras(buildExtrasPayload());
    assert.notEqual(h1, h2);
  });

  it('aplica o que veio do Drive (preferências e tema)', () => {
    StorageService.setTheme('light');
    applyExtrasPayload({ prefs: { rolloverHour: 3 }, theme: 'dark', colorTheme: 'green' });
    assert.equal(StorageService.getTheme(), 'dark');
    assert.equal(StorageService.getColorTheme(), 'green');
    assert.equal(StorageService.getRolloverHour(), 3);
  });

  it('não mexe no tema/preferências quando o usuário ficou com a versão daqui', () => {
    StorageService.setTheme('light');
    StorageService.setRolloverHour(4);
    applyExtrasPayload(
      { prefs: { rolloverHour: 9 }, theme: 'dark', colorTheme: 'green' },
      { keepTheme: true, keepPrefs: true }
    );
    assert.equal(StorageService.getTheme(), 'light');
    assert.equal(StorageService.getRolloverHour(), 4);
  });

  it('mescla as preferências (não apaga as que o Drive não conhece)', () => {
    StorageService.setBrowserFieldPrefs({ 'nt-1': ['Frente'] });
    applyExtrasPayload({ prefs: { rolloverHour: 3 }, theme: 'system', colorTheme: 'blue' });
    const prefs = StorageService.getPrefs();
    assert.equal(prefs.rolloverHour, 3);
    assert.ok(prefs.browserFields, 'as preferências locais continuam lá');
  });
});

describe('Fase 5 — índice das extensões', () => {
  const mk = (id: string, hash: string, enabled = true): SyncAddonEntry => ({
    id,
    name: id,
    version: '1.0.0',
    enabled,
    files: 2,
    hash,
  });

  it('o hash do conjunto não depende da ordem', () => {
    const a = hashAddonEntries([mk('a', '1'), mk('b', '2')]);
    const b = hashAddonEntries([mk('b', '2'), mk('a', '1')]);
    assert.equal(a, b);
  });

  it('o hash muda quando uma extensão muda (ou liga/desliga)', () => {
    const base = hashAddonEntries([mk('a', '1')]);
    assert.notEqual(base, hashAddonEntries([mk('a', '2')]));
    assert.notEqual(base, hashAddonEntries([mk('a', '1', false)]));
    assert.notEqual(base, hashAddonEntries([mk('a', '1'), mk('b', '2')]));
  });
});
