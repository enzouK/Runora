import opencodeThemes from '../opencode-themes.json';

/**
 * Paletas de cores dos temas built-in do OpenCode (33 temas),
 * extraídas de github.com/anomalyco/opencode → packages/tui/src/theme/assets/*.json
 *
 * Cada tema tem variantes `dark` e `light`. Temas somente-dark
 * (aura, ayu, catppuccin-frappe, catppuccin-macchiato, nightowl)
 * repetem as cores do dark no light.
 */
export interface ThemePalette {
  primary: string;
  secondary: string;
  accent: string;
  error: string;
  warning: string;
  success: string;
  info: string;
  text: string;
  textMuted: string;
  background: string;
  backgroundPanel: string;
  backgroundElement: string;
  border: string;
  borderActive: string;
  borderSubtle: string;
}

export interface ColorTheme {
  dark: ThemePalette;
  light: ThemePalette;
  /** Modos realmente definidos no tema original (dark-only repete no light) */
  modes: string[];
}

export const COLOR_THEMES = opencodeThemes as unknown as Record<string, ColorTheme>;

/** Nome padrão quando nenhum tema de cor está selecionado */
export const DEFAULT_COLOR_THEME = 'opencode';

/** Lista ordenada de nomes de temas para o seletor */
export const COLOR_THEME_NAMES = Object.keys(COLOR_THEMES).sort((a, b) =>
  a.localeCompare(b),
);

export function getColorTheme(id: string): ColorTheme | undefined {
  return COLOR_THEMES[id];
}

/** Paleta aplicada conforme o modo claro/escuro atual */
export function getPalette(id: string, mode: 'light' | 'dark'): ThemePalette {
  const theme = COLOR_THEMES[id] ?? COLOR_THEMES[DEFAULT_COLOR_THEME];
  return mode === 'dark' ? theme.dark : theme.light;
}
