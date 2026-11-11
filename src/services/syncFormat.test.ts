import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { isOldFormatBackup, OLD_DEVICE_WARNING } from './syncFormat';

describe('isOldFormatBackup — detecção de aparelho antigo', () => {
  it('detecta: META sem marcador vindo de outro aparelho = app antigo', () => {
    assert.equal(
      isOldFormatBackup({ deviceId: 'outro-device' }, 'meu-device'),
      true
    );
  });

  it('não detecta: META com marcador syncFormat=state (app atualizado)', () => {
    assert.equal(
      isOldFormatBackup({ deviceId: 'outro-device', syncFormat: 'state' }, 'meu-device'),
      false
    );
  });

  it('não detecta: META sem marcador, mas escrito por este mesmo aparelho', () => {
    // foi o build anterior deste aparelho que escreveu → não é "outro aparelho"
    assert.equal(isOldFormatBackup({ deviceId: 'meu-device' }, 'meu-device'), false);
  });

  it('não detecta: não há META no Drive (nenhum backup ainda)', () => {
    assert.equal(isOldFormatBackup(null, 'meu-device'), false);
    assert.equal(isOldFormatBackup(undefined, 'meu-device'), false);
  });

  it('detecta: META sem deviceId e sem marcador (formato desconhecido = antigo)', () => {
    assert.equal(isOldFormatBackup({}, 'meu-device'), true);
  });

  it('o aviso menciona que é preciso atualizar o outro aparelho', () => {
    assert.match(OLD_DEVICE_WARNING, /versão antiga/);
    assert.match(OLD_DEVICE_WARNING, /atualize/i);
  });
});
