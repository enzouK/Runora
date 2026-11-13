/**
 * Login do Google no PC (popup do GIS).
 *
 * O caso que motivou este arquivo: o usuário fecha a janela do Google sem
 * conectar a conta → o GIS chama o `error_callback` ('popup_closed') → se o
 * app não escutar esse callback, a Promise do login fica pendurada e o botão
 * Sync trava em "Sincronizando…".
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  waitForGisToken,
  LoginCancelledError,
  type GisTokenClient,
} from './gdriveAuth';

/** Token client falso: o teste decide quando o "popup" responde. */
function fakeClient() {
  const client: GisTokenClient & {
    /** Simula o Google devolvendo o token. */
    succeed: (r: Record<string, unknown>) => void;
    /** Simula o Google devolvendo um erro no callback. */
    failWith: (r: Record<string, unknown>) => void;
    /** Simula o usuário fechando a janela do login. */
    closePopup: (type?: string) => void;
    /** O prompt pedido ao GIS. */
    promptAsked: string | null;
    /** O client foi criado com handler de erro? (o GIS exige um dos dois) */
    opened: boolean;
  } = {
    promptAsked: null,
    opened: false,
    requestAccessToken: (opts: { prompt: string }) => {
      client.opened = true;
      client.promptAsked = opts.prompt;
    },
    // os handlers são instalados pelo `waitForGisToken` no MESMO objeto —
    // por isso chamamos `client.callback`/`client.error_callback` agora.
    succeed: (r) => client.callback?.(r),
    failWith: (r) => client.callback?.(r),
    closePopup: (type) => client.error_callback?.({ type }),
  };
  return client;
}

describe('waitForGisToken (popup do login do Google)', () => {
  it('resolve quando o Google devolve o token', async () => {
    const client = fakeClient();
    const p = waitForGisToken(client, 'consent');
    client.succeed({ access_token: 'abc', expires_in: 3600 });
    const resp = await p;
    assert.equal(resp.access_token, 'abc');
    assert.equal(client.promptAsked, 'consent');
  });

  it('rejeita quando o usuário fecha a janela do Google (popup_closed)', async () => {
    const client = fakeClient();
    const p = waitForGisToken(client, '');
    client.closePopup('popup_closed');
    await assert.rejects(p, (e: unknown) => {
      assert.ok(e instanceof LoginCancelledError, 'deve ser LoginCancelledError');
      assert.match((e as Error).message, /cancelado/i);
      return true;
    });
  });

  it('rejeita quando o popup é fechado sem o usuário (popup_closed_by_user)', async () => {
    const client = fakeClient();
    const p = waitForGisToken(client, '');
    client.closePopup('popup_closed_by_user');
    await assert.rejects(p, LoginCancelledError);
  });

  it('rejeita com o erro devolvido pelo Google no callback', async () => {
    const client = fakeClient();
    const p = waitForGisToken(client, 'consent');
    client.failWith({ error: 'access_denied', error_description: 'Acesso negado' });
    await assert.rejects(p, (e: unknown) => {
      assert.ok(!(e instanceof LoginCancelledError), 'não é cancelamento, é recusa do Google');
      assert.match((e as Error).message, /Acesso negado/);
      return true;
    });
  });

  it('rejeita quando o popup estoura o tempo limite', async () => {
    const client = fakeClient();
    await assert.rejects(waitForGisToken(client, '', 20), /demorou demais/i);
  });

  it('rejeita quando o requestAccessToken lança erro na hora', async () => {
    const client = fakeClient();
    client.requestAccessToken = () => {
      throw new Error('popup bloqueado');
    };
    await assert.rejects(waitForGisToken(client, ''), /popup bloqueado/);
  });

  it('ignora uma resposta tardia depois do cancelamento', async () => {
    const client = fakeClient();
    const p = waitForGisToken(client, '');
    client.closePopup('popup_closed');
    // o Google "responde" depois (o popup às vezes chega a mandar o token):
    // a Promise já rejeitou e não pode virar resolve depois.
    client.succeed({ access_token: 'tarde' });
    await assert.rejects(p, LoginCancelledError);
  });
});
