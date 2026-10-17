// Colors and fonts shared by the chrome, the terminals, and widgets. Each key
// becomes a CSS variable (bgRaised -> --bg-raised) in the chrome and in every
// widget. config.json's "theme" overrides individual keys.

export const DEFAULT_THEME = {
  bg: '#1e1f24',
  bgRaised: '#26282f',
  bgHover: '#2e3039',
  fg: '#d8dae0',
  muted: '#8a8f9c',
  border: '#2c2e36',
  accent: '#7aa2f7',
  danger: '#f7768e',
  red: '#f7768e',
  green: '#9ece6a',
  yellow: '#e0af68',
  blue: '#7aa2f7',
  magenta: '#bb9af7',
  cyan: '#7dcfff',
  fontUi: '-apple-system, BlinkMacSystemFont, sans-serif',
  /** Defaults to the terminal font. */
  fontMono: ''
}

export type ThemeKey = keyof typeof DEFAULT_THEME
export type Theme = Record<ThemeKey, string>
export type ThemeOverrides = Partial<Theme>

export const THEME_KEYS = Object.keys(DEFAULT_THEME) as ThemeKey[]

/** Values end up inside a <style> block, so they can't close it or start a new rule. */
export function isSafeThemeValue(v: unknown): v is string {
  return typeof v === 'string' && v.length > 0 && v.length <= 300 && !/[;{}<>\\]/.test(v)
}

export function resolveTheme(overrides: ThemeOverrides, terminalFont: string): Theme {
  const theme: Theme = { ...DEFAULT_THEME, fontMono: terminalFont }
  for (const key of THEME_KEYS) {
    const v = overrides[key]
    if (isSafeThemeValue(v)) theme[key] = v
  }
  return theme
}

const cssName = (key: string): string => '--' + key.replace(/[A-Z]/g, (c) => '-' + c.toLowerCase())

/** { '--bg': '#1e1f24', '--bg-raised': ... } */
export function themeVars(theme: Theme): Record<string, string> {
  return Object.fromEntries(THEME_KEYS.map((k) => [cssName(k), theme[k]]))
}

export function themeCss(vars: Record<string, string>): string {
  const body = Object.entries(vars)
    .filter(([, v]) => isSafeThemeValue(v))
    .map(([k, v]) => `${k}: ${v};`)
    .join(' ')
  return `:root { ${body} }`
}
