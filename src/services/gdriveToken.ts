/**
 * Decisões sobre a sessão do Google (renovação do token) — funções **puras**,
 * sem `window` e sem rede, para poderem ser testadas no Node.
 *
 * POR QUE ISTO EXISTE (bug de 13/11/2026):
 *
 * O `ensureToken()` do `gdriveSync.ts` tratava **qualquer** falha na
 * renovação do token como "sessão expirada" e **apagava** o token guardado no
 * `localStorage`. Um simples blip de rede — o WebView subindo logo depois de
 * uma atualização do APK — bastava para o app **jogar fora uma sessão que
 * continuava válida** no Google. Foi o que aconteceu: o dono perdeu o login
 * do emulador sem motivo nenhum (e o token, conferido depois na API do
 * Google, ainda dava HTTP 200).
 *
 * A regra agora:
 * - o **Google recusou a permissão** (`invalid_grant`, `invalid_client`… ou
 *   qualquer 4xx do endpoint de token) → a sessão morreu → apagar o token e
 *   pedir para reconectar;
 * - **não houve resposta do Google** (sem internet, timeout) ou o Google
 *   deu erro do servidor (5xx, 429) → é passageiro → **manter** o token e
 *   avisar que não deu para falar com o Google agora.
 */

/** Mensagem quando a sessão do Google realmente acabou. */
export const SESSION_EXPIRED_MESSAGE =
  'Sessão do Google expirada. Abra a aba Sync e reconecte sua conta.';

/** Mensagem quando a falha foi passageira (rede / Google instável). */
export const NO_CONNECTION_MESSAGE =
  'Não consegui falar com o Google agora. Verifique a internet e tente sincronizar de novo.';

/**
 * Códigos do Google que significam "esta permissão morreu de vez" — o token
 * guardado não serve mais e a sessão tem que ser refeita.
 */
const DEAD_SESSION_CODES = new Set([
  'invalid_grant', // o refresh token foi revogado ou expirou
  'invalid_client', // o client_id/secret do app não valem
  'invalid_scope',
  'unauthorized_client',
  'access_denied',
]);

/** Códigos que são passageiros — a sessão continua boa. */
const TRANSIENT_CODES = new Set([
  'slow_down',
  'temporarily_unavailable',
  'internal_failure',
  'backend_error',
  'rate_limit_exceeded',
]);

/**
 * Erro de renovação do token — sabe se foi o **Google** quem recusou ou se a
 * requisição nem chegou nele.
 */
export class TokenRenewalError extends Error {
  /** Código devolvido pelo Google (ex.: `invalid_grant`). */
  readonly code?: string;
  /** Status HTTP da resposta (ausente = a resposta não chegou). */
  readonly status?: number;

  constructor(message: string, options: { code?: string; status?: number } = {}) {
    super(message);
    this.name = 'TokenRenewalError';
    this.code = options.code;
    this.status = options.status;
  }
}

/** O token guardado no aparelho deve ser **apagado**? */
export function shouldDropStoredToken(error: unknown): boolean {
  if (!(error instanceof TokenRenewalError)) return false;
  // Código passageiro → nunca apaga a sessão.
  if (error.code && TRANSIENT_CODES.has(error.code)) return false;
  // Código que mata a sessão → apaga.
  if (error.code && DEAD_SESSION_CODES.has(error.code)) return true;
  // Sem código: se o Google respondeu com 4xx, a renovação foi recusada de
  // vez → apaga. 5xx/429/408 (ou nenhuma resposta) → passageiro → mantém.
  if (typeof error.status === 'number') {
    if (error.status === 429 || error.status === 408) return false; // pediu pra esperar
    return error.status >= 400 && error.status < 500;
  }
  return false;
}

/** A falha foi só de rede (a requisição não chegou ao Google)? */
export function isNetworkFailure(error: unknown): boolean {
  return error instanceof TokenRenewalError && typeof error.status !== 'number';
}

/** Mensagem para o usuário, conforme o tipo da falha. */
export function tokenErrorMessage(error: unknown): string {
  return shouldDropStoredToken(error) ? SESSION_EXPIRED_MESSAGE : NO_CONNECTION_MESSAGE;
}

/**
 * Extrai o código de erro do corpo JSON do endpoint de token do Google
 * (ex.: `{"error":"invalid_grant","error_description":"Bad Request"}`).
 */
export function parseGoogleTokenError(body: string): string | undefined {
  try {
    const json = JSON.parse(body) as { error?: unknown };
    return typeof json.error === 'string' ? json.error : undefined;
  } catch {
    return undefined;
  }
}
