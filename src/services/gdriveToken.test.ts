/**
 * A sessão do Google pode ser apagada por engano?
 *
 * O caso real (13/11/2026): o emulador perdeu o login do Google do nada. O
 * app tentou renovar o token logo depois de uma atualização do APK, a
 * requisição falhou por um instante (o WebView ainda subindo) e o app
 * mostrou "Sessão do Google expirada" e **apagou** o token guardado — que
 * continuava válido no Google (testado na API: HTTP 200).
 *
 * Estes testes travam a regra: só se apaga o token quando o **Google** diz
 * que a permissão morreu.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  NO_CONNECTION_MESSAGE,
  SESSION_EXPIRED_MESSAGE,
  TokenRenewalError,
  isNetworkFailure,
  parseGoogleTokenError,
  shouldDropStoredToken,
  tokenErrorMessage,
} from './gdriveToken';

describe('devo apagar o token guardado?', () => {
  it('NÃO apaga quando a requisição nem chegou ao Google (sem internet)', () => {
    const erro = new TokenRenewalError('Failed to fetch');
    assert.equal(shouldDropStoredToken(erro), false, 'sem resposta do Google → sessão mantida');
    assert.equal(isNetworkFailure(erro), true);
    assert.equal(tokenErrorMessage(erro), NO_CONNECTION_MESSAGE);
  });

  it('NÃO apaga quando o Google dá erro do servidor (500)', () => {
    const erro = new TokenRenewalError('500', { status: 500 });
    assert.equal(shouldDropStoredToken(erro), false, 'erro do servidor → sessão mantida');
    assert.equal(tokenErrorMessage(erro), NO_CONNECTION_MESSAGE);
  });

  it('NÃO apaga quando o Google pede para esperar (429 / slow_down)', () => {
    assert.equal(shouldDropStoredToken(new TokenRenewalError('429', { status: 429 })), false);
    assert.equal(shouldDropStoredToken(new TokenRenewalError('408', { status: 408 })), false);
    assert.equal(
      shouldDropStoredToken(new TokenRenewalError('slow_down', { status: 400, code: 'slow_down' })),
      false
    );
  });

  it('APAGA quando o Google diz invalid_grant (refresh token revogado/expirado)', () => {
    const erro = new TokenRenewalError('invalid_grant', { status: 400, code: 'invalid_grant' });
    assert.equal(shouldDropStoredToken(erro), true);
    assert.equal(tokenErrorMessage(erro), SESSION_EXPIRED_MESSAGE);
  });

  it('APAGA quando o Google diz invalid_client (client_id/secret do app não valem)', () => {
    const erro = new TokenRenewalError('invalid_client', { status: 401, code: 'invalid_client' });
    assert.equal(shouldDropStoredToken(erro), true);
  });

  it('APAGA quando o Google recusa a renovação com 4xx sem código conhecido', () => {
    assert.equal(shouldDropStoredToken(new TokenRenewalError('Bad Request', { status: 400 })), true);
  });

  it('NÃO apaga com um erro que não vem da renovação (ex.: popup do GIS falhou)', () => {
    assert.equal(shouldDropStoredToken(new Error('popup bloqueado')), false);
  });
});

describe('leitura do erro do Google', () => {
  it('lê o código do corpo JSON', () => {
    const corpo = '{"error":"invalid_grant","error_description":"Bad Request"}';
    assert.equal(parseGoogleTokenError(corpo), 'invalid_grant');
  });

  it('devolve undefined quando o corpo não é JSON', () => {
    assert.equal(parseGoogleTokenError('<html>500</html>'), undefined);
    assert.equal(parseGoogleTokenError(''), undefined);
  });

  it('ignora um corpo JSON sem "error"', () => {
    assert.equal(parseGoogleTokenError('{"foo":1}'), undefined);
  });
});
