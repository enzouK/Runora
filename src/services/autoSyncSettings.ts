/**
 * Configuração do autosync com o Google Drive.
 *
 * Fica num módulo separado (sem dependências) para poder ser lido e testado
 * sem carregar o resto do app.
 *
 * - `runora_auto_sync`             → "1" (timer ligado) ou "0" (timer desligado)
 * - `runora_auto_sync_open`        → "1" (sync ao abrir o app) ou "0" (desligado)
 * - `runora_gdrive_autosync_minutes` → intervalo em MINUTOS
 *
 * A tela mostra o intervalo em minutos ou horas; aqui ele é sempre salvo em
 * minutos (1 hora = 60 minutos).
 */

/** Chave do localStorage com o intervalo (em minutos). */
export const AUTO_SYNC_INTERVAL_KEY = 'runora_gdrive_autosync_minutes';
/** Chave do localStorage com o liga/desliga do timer. */
export const AUTO_SYNC_ENABLED_KEY = 'runora_auto_sync';
/** Chave do localStorage com o liga/desliga do sync ao abrir o app. */
export const AUTO_SYNC_ON_OPEN_KEY = 'runora_auto_sync_open';

/** De quanto em quanto tempo o autosync roda (padrão: 5 minutos). */
export const DEFAULT_AUTO_SYNC_MINUTES = 5;
/** Limites aceitos para o intervalo (1 minuto … 24 horas). */
export const MIN_AUTO_SYNC_MINUTES = 1;
export const MAX_AUTO_SYNC_MINUTES = 24 * 60;

/** O autosync (timer) está ligado? (padrão: ligado). */
export function getAutoSyncEnabled(): boolean {
  return localStorage.getItem(AUTO_SYNC_ENABLED_KEY) !== '0';
}

/** Liga/desliga o autosync (timer). */
export function setAutoSyncEnabled(on: boolean): void {
  localStorage.setItem(AUTO_SYNC_ENABLED_KEY, on ? '1' : '0');
}

/** A sincronização ao abrir o aplicativo está ligada? (padrão: ligada). */
export function getAutoSyncOnOpen(): boolean {
  const explicit = localStorage.getItem(AUTO_SYNC_ON_OPEN_KEY);
  if (explicit !== null) return explicit !== '0';
  // Migração (uma vez só): quem já tinha desligado o autosync antigo não
  // passa a sincronizar ao abrir o app. Depois disso, as duas opções ficam
  // independentes de verdade.
  const fallback = localStorage.getItem(AUTO_SYNC_ENABLED_KEY) !== '0';
  localStorage.setItem(AUTO_SYNC_ON_OPEN_KEY, fallback ? '1' : '0');
  return fallback;
}

/** Liga/desliga a sincronização ao abrir o aplicativo. */
export function setAutoSyncOnOpen(on: boolean): void {
  localStorage.setItem(AUTO_SYNC_ON_OPEN_KEY, on ? '1' : '0');
}

/** De quanto em quanto tempo o autosync roda — em MINUTOS. */
export function getAutoSyncIntervalMinutes(): number {
  const raw = Number(localStorage.getItem(AUTO_SYNC_INTERVAL_KEY));
  if (!Number.isFinite(raw) || raw <= 0) return DEFAULT_AUTO_SYNC_MINUTES;
  return Math.min(MAX_AUTO_SYNC_MINUTES, Math.max(MIN_AUTO_SYNC_MINUTES, Math.round(raw)));
}

/** Salva o intervalo do autosync (em minutos). Valores fora dos limites são ajustados. */
export function setAutoSyncIntervalMinutes(minutes: number): void {
  const safe = Number.isFinite(minutes)
    ? Math.min(MAX_AUTO_SYNC_MINUTES, Math.max(MIN_AUTO_SYNC_MINUTES, Math.round(minutes)))
    : DEFAULT_AUTO_SYNC_MINUTES;
  localStorage.setItem(AUTO_SYNC_INTERVAL_KEY, String(safe));
}
