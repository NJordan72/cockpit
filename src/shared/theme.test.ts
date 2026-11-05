import { describe, expect, it } from 'bun:test'
import { DEFAULT_THEME, mixHex, resolveTheme, themeVars, type ThemeDefinition } from './theme'
import { BUILT_IN_THEMES } from './themes'

const def = (id: string, extra: Partial<ThemeDefinition> = {}): ThemeDefinition => ({
  id,
  name: id,
  tokens: {},
  terminal: {},
  ...extra
})

const FONT = 'Menlo'

describe('resolveTheme', () => {
  it('gives the defaults, with the terminal font as the mono font, for the default theme', () => {
    const t = resolveTheme(BUILT_IN_THEMES, 'midnight', {}, FONT)
    expect(t.id).toBe('midnight')
    expect(t.tokens).toEqual({ ...DEFAULT_THEME, fontMono: FONT })
    expect(t.terminal.background).toBe(DEFAULT_THEME.bg)
    expect(t.terminal.brightBlack).toBe('#565f89')
    expect(t.css).toEqual([])
  })

  it('falls back to the default theme for an unknown id', () => {
    const t = resolveTheme(BUILT_IN_THEMES, 'nope', {}, FONT)
    expect(t.id).toBe('midnight')
  })

  it('layers a theme over what it extends, and overrides over both', () => {
    const themes = [
      ...BUILT_IN_THEMES,
      def('neon', {
        extends: 'amber',
        tokens: { accent: '#39ff14' },
        terminal: { cursor: '#39ff14' },
        css: 'cockpit-asset://themes/neon/theme.css'
      })
    ]
    const t = resolveTheme(themes, 'neon', { fg: '#ffffff' }, FONT)
    expect(t.id).toBe('neon')
    expect(t.tokens.accent).toBe('#39ff14')
    // From amber.
    expect(t.tokens.bg).toBe('#0c0d0f')
    expect(t.tokens.radius).toBe('0px')
    expect(t.terminal.brightWhite).toBe('#fffaf0')
    expect(t.terminal.cursor).toBe('#39ff14')
    expect(t.tokens.fg).toBe('#ffffff')
    expect(t.css).toEqual(['cockpit-asset://themes/neon/theme.css'])
  })

  it('lists stylesheets base first', () => {
    const themes = [
      def('a', { css: 'a.css' }),
      def('b', { extends: 'a' }),
      def('c', { extends: 'b', css: 'c.css' })
    ]
    expect(resolveTheme(themes, 'c', {}, FONT).css).toEqual(['a.css', 'c.css'])
  })

  it('stops at a cycle', () => {
    const themes = [
      def('a', { extends: 'b', tokens: { accent: '#aaaaaa' } }),
      def('b', { extends: 'a', tokens: { accent: '#bbbbbb', fg: '#bbbbbb' } })
    ]
    const t = resolveTheme(themes, 'a', {}, FONT)
    expect(t.tokens.accent).toBe('#aaaaaa')
    expect(t.tokens.fg).toBe('#bbbbbb')
  })

  it('follows at most a few levels of extends', () => {
    // Only t0 sets fg.
    const themes = Array.from({ length: 10 }, (_, i) =>
      def(`t${String(i)}`, {
        extends: i > 0 ? `t${String(i - 1)}` : undefined,
        tokens: i === 0 ? { fg: '#123456' } : { accent: `#00000${String(i)}` }
      })
    )
    expect(resolveTheme(themes, 't2', {}, FONT).tokens.fg).toBe('#123456')
    const deep = resolveTheme(themes, 't9', {}, FONT)
    expect(deep.tokens.accent).toBe('#000009')
    expect(deep.tokens.fg).toBe(DEFAULT_THEME.fg)
  })

  it('drops values that could break out of a style block', () => {
    const themes = [
      def('x', {
        tokens: { bg: 'red; } body { display: none', fg: '</style>' },
        terminal: { red: '#f00}' }
      })
    ]
    const t = resolveTheme(themes, 'x', { accent: '{' }, FONT)
    expect(t.tokens.bg).toBe(DEFAULT_THEME.bg)
    expect(t.tokens.fg).toBe(DEFAULT_THEME.fg)
    expect(t.tokens.accent).toBe(DEFAULT_THEME.accent)
    expect(t.terminal.red).toBe(DEFAULT_THEME.red)
  })

  it('derives a readable palette for light themes', () => {
    const t = resolveTheme([def('light', { tokens: { colorScheme: 'light' } })], 'light', {}, FONT)
    // "black" text must show on the background, so it's the text color.
    expect(t.terminal.black).toBe(t.tokens.fg)
    expect(t.terminal.brightWhite).toBe(t.tokens.bg)
  })
})

describe('mixHex', () => {
  it('mixes two hex colors', () => {
    expect(mixHex('#ffffff', '#000000', 0.5)).toBe('#808080')
    expect(mixHex('#fff', '#000', 1)).toBe('#ffffff')
  })

  it('returns the first color when either isn’t hex', () => {
    expect(mixHex('rgb(1 2 3)', '#000', 0.5)).toBe('rgb(1 2 3)')
  })
})

describe('themeVars', () => {
  it('names every token as a CSS variable', () => {
    const vars = themeVars({ ...DEFAULT_THEME, fontMono: FONT })
    expect(vars['--bg-raised']).toBe(DEFAULT_THEME.bgRaised)
    expect(vars['--accent-fg']).toBe(DEFAULT_THEME.accentFg)
    expect(vars['--color-scheme']).toBe('dark')
    expect(vars['--font-mono']).toBe(FONT)
  })
})

describe('built-in themes', () => {
  it('have unique ids and only known, safe values', () => {
    const ids = BUILT_IN_THEMES.map((t) => t.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const t of BUILT_IN_THEMES) {
      const resolved = resolveTheme(BUILT_IN_THEMES, t.id, {}, FONT)
      for (const [key, value] of Object.entries(t.tokens)) {
        expect(resolved.tokens[key as keyof typeof resolved.tokens]).toBe(value)
      }
    }
  })
})
