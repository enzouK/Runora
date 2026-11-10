/**
 * Configuração do autosync com o Google Drive.
 *
 * - `autoSync`       → timer ligado ou desligado (padrão: ligado)
 * - `autoSyncOnOpen` → sync ao abrir o app (padrão: ligado)
 * - `autoSyncMinutes`→ intervalo em MINUTOS (padrão: 5; a tela mostra em horas)
 *
 * Estas opções são PREFERÊNCIAS do app (registro `runora_prefs`), então:
 * - mudar aqui acende o alerta amarelo do botão Sync (evento de preferência);
 * - vão para o Drive junto com as outras preferências.
 *
 * Migração: quem já tinha as chaves antigas fica como estava — o valor antigo
 * é adotado uma vez e gravado no registro. As chaves antigas continuam sendo
 * escritas junto, para versões anteriores do app continuarem funcionando.
 *
 * A tela mostra o intervalo em minutos ou horas; aqui ele é sempre salvo em
 * minutos (1 hora = 60 minutos).
 */
import { dispatchSettingsChanged } from './storage';

/** Chave DENTRO do registro de preferências: timer ligado? */
export const AUTO_SYNC_PREF_KEY = 'autoSync';
/** Chave DENTRO do registro de preferências: sync ao abrir o app? */
export const AUTO_SYNC_ON_OPEN_PREF_KEY = 'autoSyncOnOpen';
/** Chave DENTRO do registro de preferências: intervalo (minutos). */
export const AUTO_SYNC_MINUTES_PREF_KEY = 'autoSyncMinutes';

/** Chaves antigas — mantidas para migração (leitura) e versões anteriores. */
export const AUTO_SYNC_ENABLED_KEY = 'runora_auto_sync';
export const AUTO_SYNC_ON_OPEN_KEY = 'runora_auto_sync_open';
export const AUTO_SYNC_INTERVAL_KEY = 'runora_gdrive_autosync_minutes';

/** De quanto em quanto tempo o autosync roda (padrão: 5 minutos). */
export const DEFAULT_AUTO_SYNC_MINUTES = 5;
/** Limites aceitos para o intervalo (1 minuto … 24 horas). */
export const MIN_AUTO_SYNC_MINUTES = 1;
export const MAX_AUTO_SYNC_MINUTES = 24 * 60;

/** O timer do autosync está ligado? (padrão: ligado). */
export function getAutoSyncEnabled(): boolean {
  return readBooleanPref(AUTO_SYNC_PREF_KEY, [AUTO_SYNC_ENABLED_KEY], true);
}

/** Liga/desliga o autosync (timer). */
export function setAutoSyncEnabled(on: boolean): void {
  writeBoolPref(AUTO_SYNC_PREF_KEY, on, AUTO_SYNC_ENABLED_KEY);
}

/** A sincronização ao abrir o aplicativo está ligada? (padrão: ligada). */
export function getAutoSyncOnOpen(): boolean {
  // Migração: quem já tinha desligado o autosync antigo não passa a
  // sincronizar ao abrir o app — as duas opções ficam independentes.
  return readBooleanPref(AUTO_SYNC_ON_OPEN_PREF_KEY, [AUTO_SYNC_ON_OPEN_KEY, AUTO_SYNC_ENABLED_KEY], true);
}

/** Liga/desliga a sincronização ao abrir o aplicativo. */
export function setAutoSyncOnOpen(on: boolean): void {
  writeBoolPref(AUTO_SYNC_ON_OPEN_PREF_KEY, on, AUTO_SYNC_ON_OPEN_KEY);
}

/** De quanto em quanto tempo o autosync roda — em MINUTOS. */
export function getAutoSyncIntervalMinutes(): number {
  const prefs = readPrefs();
  const current = prefs[AUTO_SYNC_MINUTES_PREF_KEY];
  if (typeof current === 'number' && Number.isFinite(current)) {
    return clampMinutes(current);
  }
  // migração: adota o valor das chaves antigas (uma vez só — após isto vale
  // o registro de preferências, inclusive o que vier do Drive)
  const raw = Number(localStorage.getItem(AUTO_SYNC_INTERVAL_KEY));
  if (Number.isFinite(raw) && raw > 0) {
    const adopted = clampMinutes(raw);
    writeMinutesPref(adopted);
    return adopted;
  }
  return DEFAULT_AUTO_SYNC_MINUTES;
}

/** Salva o intervalo do autosync (em minutos). Valores fora dos limites são ajustados. */
export function setAutoSyncIntervalMinutes(minutes: number): void {
  writeMinutesPref(sanitizeMinutes(minutes));
}

/* ── leitura/escrita do registro de preferências ────────────────────────── */

/** Lê o registro de preferências (leitura direta, sem depender do Storage). */
function readPrefs(): Record<string, unknown> {
  try {
    const raw = localStorage.getItem('runora_prefs');
    const parsed = raw ? JSON.parse(raw) : null;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

/** Grava uma preferência e avisa a tela (o alerta amarelo do Sync observa). */
function writePrefsKey(key: string, value: unknown): void {
  const prefs = { ...readPrefs(), [key]: value };
  localStorage.setItem('runora_prefs', JSON.stringify(prefs));
  dispatchSettingsChanged();
}

function writeBoolPref(key: string, value: boolean, legacyKey: string): void {
  writePrefsKey(key, value);
  // as chaves antigas continuam valendo para versões anteriores do app
  localStorage.setItem(legacyKey, value ? '1' : '0');
}

function writeMinutesPref(minutes: number): void {
  writePrefsKey(AUTO_SYNC_MINUTES_PREF_KEY, minutes);
  localStorage.setItem(AUTO_SYNC_INTERVAL_KEY, String(minutes));
}

function readBooleanPref(key: string, legacyKeys: string[], fallback: boolean): boolean {
  const current = readPrefs()[key];
  if (typeof current === 'boolean') return current;
  // migração: adota a chave antiga (uma vez só — depois o registro decide,
  // inclusive o valor que vier do Drive)
  for (const legacy of legacyKeys) {
    const raw = localStorage.getItem(legacy);
    if (raw !== null) {
      const adopted = raw !== '0';
      writePrefsKey(key, adopted);
      return adopted;
    }
  }
  return fallback;
}

function clampMinutes(minutes: number): number {
  return Math.min(MAX_AUTO_SYNC_MINUTES, Math.max(MIN_AUTO_SYNC_MINUTES, Math.round(minutes)));
}

function sanitizeMinutes(minutes: number): number {
  return Number.isFinite(minutes) ? clampMinutes(minutes) : DEFAULT_AUTO_SYNC_MINUTES;
}
