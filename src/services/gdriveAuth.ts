/**
 * Login do Google (PC/desktop) — popup do Google Identity Services (GIS).
 *
 * Fica num módulo à parte (sem `window`, sem `import.meta.env`) para poder ser
 * testado no Node junto com o resto da suíte.
 *
 * Por que este módulo existe:
 * o GIS avisa o **fechamento da janela do login** pelo `error_callback`
 * (`type: 'popup_closed'`). Sem tratar esse callback, a Promise do login fica
 * pendurada para sempre e o botão Sync do app trava em "Sincronizando…"
 * quando o usuário fecha a janela do Google sem conectar a conta.
 */

/** O pedaço do token client do GIS que usamos. */
export interface GisTokenClient {
  callback?: (r: Record<string, unknown>) => void;
  error_callback?: (e: { type?: string; message?: string }) => void;
  requestAccessToken: (opts: { prompt: string }) => void;
}

/** Tempo máximo do popup do login (5 min) — depois disso o app se recupera. */
export const GIS_TOKEN_TIMEOUT_MS = 5 * 60 * 1000;

/**
 * O usuário desistiu do login (fechou a janela do Google, negou o consentimento
 * etc.). Separate dos outros erros para a UI poder dizer "login cancelado"
 * em vez de "sessão expirada".
 */
export class LoginCancelledError extends Error {
  constructor(message = 'Login do Google cancelado — a janela foi fechada sem conectar a conta.') {
    super(message);
    this.name = 'LoginCancelledError';
  }
}

/** Mensagem amigável para cada tipo de erro do GIS. */
export function loginCancelledMessage(type?: string): string {
  if (type === 'popup_closed' || type === 'popup_closed_by_user') {
    return 'Login do Google cancelado — a janela foi fechada sem conectar a conta.';
  }
  return 'O login do Google não foi concluído. Tente de novo.';
}

/**
 * Espera o token do popup do GIS.
 *
 * Resolve com a resposta do Google; rejeita em qualquer final diferente:
 * popup fechado/cancelado, erro devolvido pelo Google, exceção thrown na hora
 * de abrir o popup ou tempo esgotado. Nunca fica pendurada.
 */
export function waitForGisToken(
  client: GisTokenClient,
  prompt: '' | 'consent',
  timeoutMs = GIS_TOKEN_TIMEOUT_MS
): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    let done = false;
    const timer = setTimeout(() => {
      if (done) return;
      done = true;
      reject(new Error('O login do Google demorou demais. Tente de novo.'));
    }, timeoutMs);

    const finish = (fn: () => void) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      fn();
    };

    client.callback = (r) => {
      if (r && r.error) {
        finish(() => reject(new Error(String(r.error_description || r.error))));
        return;
      }
      finish(() => resolve(r));
    };
    // O GIS chama este callback quando o popup é fechado sem responder —
    // era exatamente o que faltava (o botão ficava travado em "Sincronizando").
    client.error_callback = (e) => {
      finish(() => reject(new LoginCancelledError(loginCancelledMessage(e?.type))));
    };

    try {
      client.requestAccessToken({ prompt });
    } catch (e) {
      finish(() =>
        reject(new Error((e as Error)?.message ?? 'Não foi possível abrir o login do Google.'))
      );
    }
  });
}
