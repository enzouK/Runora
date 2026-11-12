/**
 * Fase 5 do sync — "Extensões e preferências vão para o Drive".
 *
 * Além do backup da coleção (.colpkg), o Drive passa a guardar:
 *   runora-sync-extras.json      preferências do app + temas
 *   runora-sync-addons.json      índice das extensões (id, nome, versão, ligado)
 *   runora-sync-addons.zip       as extensões completas (código + config)
 *
 * Assim um aparelho novo, só de conectar a conta, fica igual ao outro —
 * sem baixar extensão por extensão.
 *
 * Regras:
 * - versões antigas do app ignoram esses arquivos (são extras na pasta);
 * - as extensões atuais são guardadas em backup local antes de qualquer
 *   substituição;
 * - a decisão (aplicar o do Drive / enviar o daqui / não mexer) é a mesma do
 *   sync item a item: quem mudou em relação à base comum leva.
 */
import { StorageService } from './storage';
import { hashValue } from './syncItems';

/** Conteúdo dos "extras" (preferências + temas). */
export interface SyncExtrasPayload {
  prefs: Record<string, unknown>;
  theme: string;
  colorTheme: string;
}

/** O arquivo `runora-sync-extras.json` no Drive. */
export interface SyncExtrasFile extends SyncExtrasPayload {
  app: 'runora';
  version: 1;
  uploadedAt: number;
  deviceId: string;
  deviceName: string;
}

/** Uma extensão, como aparece no índice `runora-sync-addons.json`. */
export interface SyncAddonEntry {
  id: string;
  name: string;
  version: string;
  /** Ligada ou desligada neste aparelho. */
  enabled: boolean;
  /** Quantos arquivos a extensão tem. */
  files: number;
  /** Hash do conteúdo (código + config) — muda quando o arquivo muda. */
  hash: string;
}

/** O arquivo `runora-sync-addons.json` no Drive. */
export interface SyncAddonsIndex {
  app: 'runora';
  version: 1;
  uploadedAt: number;
  deviceId: string;
  deviceName: string;
  addons: SyncAddonEntry[];
  /** Hash do conjunto de extensões (o mesmo dos dois lados). */
  hash: string;
}

/** Quem leva: o do Drive, o daqui, ou ninguém (iguais). */
export type SyncSide = 'remote' | 'local' | 'none';

/**
 * Decide o que fazer com um arquivo do Drive (extras ou extensões).
 *
 * - sem base ainda (aparelho novo): o Drive manda → o aparelho fica igual;
 * - só o Drive mudou: aplica o do Drive;
 * - o local mudou: sobe o local (não se perde o que o usuário acabou de fazer);
 * - os dois mudaram: CONFLITO (o usuário decide);
 * - nada mudou: não mexe em nada.
 */
export function decideSyncSide(
  baseHash: string | null,
  localHash: string,
  remoteHash: string | null
): SyncSide {
  if (!remoteHash) return 'local'; // o Drive não tem esse arquivo → sobe o daqui
  if (!baseHash) return 'remote'; // sem base → o Drive manda (aparelho novo fica igual)
  if (localHash === remoteHash) return 'none'; // já são iguais no Drive e aqui

  const remoteChanged = remoteHash !== baseHash;
  const localChanged = localHash !== baseHash;

  if (remoteChanged && localChanged) return 'local'; // T9 / regra anterior: local leva em caso de disputa de extras
  if (remoteChanged) return 'remote';
  if (localChanged) return 'local';
  return 'none';
}

/** As preferências + temas deste aparelho. */
export function buildExtrasPayload(): SyncExtrasPayload {
  return {
    prefs: StorageService.getPrefs(),
    theme: StorageService.getTheme(),
    colorTheme: StorageService.getColorTheme(),
  };
}

/** Hash dos extras (o mesmo cálculo dos dois lados). */
export function hashExtras(payload: SyncExtrasPayload): string {
  return hashValue(payload);
}

/**
 * Aplica os extras que vieram do Drive.
 * `keepTheme`/`keepPrefs` deixam de fora o que o usuário acabou de decidir
 * neste mesmo sync (evita o app trocar de tema por baixo da panera).
 */
export function applyExtrasPayload(
  payload: SyncExtrasPayload,
  opts?: { keepTheme?: boolean; keepPrefs?: boolean }
): void {
  if (!opts?.keepPrefs && payload.prefs && typeof payload.prefs === 'object') {
    StorageService.mergePrefs(payload.prefs);
  }
  if (!opts?.keepTheme) {
    if (payload.theme === 'light' || payload.theme === 'dark' || payload.theme === 'system') {
      StorageService.setTheme(payload.theme);
    }
    if (payload.colorTheme) StorageService.setColorTheme(payload.colorTheme);
  }
}

/** Hash do conjunto de extensões (o mesmo dos dois lados). */
export function hashAddonEntries(entries: SyncAddonEntry[]): string {
  const sorted = [...entries].sort((a, b) => a.id.localeCompare(b.id));
  return hashValue(sorted);
}

/** Base (estado comum do último sync) de um arquivo do Drive. */
export interface SyncSideBase {
  hash: string;
  uploadedAt: number;
}

/**
 * Aplica o tema na tela. O app só aplica o tema no boot, então quando o
 * tema chega do Drive é preciso atualizar a página (classes do <html>).
 */
export function refreshThemeInDom(): void {
  if (typeof document === 'undefined' || typeof window === 'undefined') return;
  const theme = StorageService.getTheme();
  const root = document.documentElement;
  const prefersDark =
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-color-scheme: dark)').matches;
  if (theme === 'dark' || (theme === 'system' && prefersDark)) {
    root.classList.add('dark');
  } else {
    root.classList.remove('dark');
  }
  root.dataset.colorTheme = StorageService.getColorTheme();
}
