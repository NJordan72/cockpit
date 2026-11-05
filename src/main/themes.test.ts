import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { assetFile } from './assets'
import { parseThemeFile, ThemeStore } from './themes'

const noCss = (): null => null

describe('parseThemeFile', () => {
  it('reads name, extends, tokens, and palette, dropping unknown keys', () => {
    const def = parseThemeFile(
      'neon',
      JSON.stringify({
        name: 'Neon',
        extends: 'amber',
        tokens: { accent: '#39ff14', sparkle: '#fff', bg: 'x}' },
        terminal: { cursor: '#39ff14', glitter: '#fff' }
      }),
      noCss
    )
    expect(def).toEqual({
      id: 'neon',
      name: 'Neon',
      extends: 'amber',
      tokens: { accent: '#39ff14' },
      terminal: { cursor: '#39ff14' }
    })
  })

  it('links theme.css when it exists, with its revision', () => {
    const def = parseThemeFile('neon', '{}', (f) => (f === 'theme.css' ? 1234 : null))
    expect(def.css).toBe('cockpit-asset://themes/neon/theme.css?v=1234')
    expect(def.error).toBeUndefined()
  })

  it('names a missing stylesheet only when one was asked for', () => {
    expect(parseThemeFile('a', '{}', noCss).error).toBeUndefined()
    expect(parseThemeFile('a', '{"css":"look.css"}', noCss).error).toMatch(/look\.css/)
  })

  it('refuses a stylesheet outside the folder', () => {
    for (const css of ['../x.css', '/etc/x.css', 'a/../../x.css', 7]) {
      const def = parseThemeFile('a', JSON.stringify({ css }), () => 1)
      expect(def.css).toBeUndefined()
      expect(def.error).toBeDefined()
    }
  })

  it('reports bad JSON and leaves the theme empty', () => {
    const def = parseThemeFile('a', '{', noCss)
    expect(def.error).toMatch(/not valid JSON/)
    expect(def.tokens).toEqual({})
    expect(parseThemeFile('a', '[]', noCss).error).toMatch(/object/)
  })

  it('ignores a theme that extends itself', () => {
    expect(parseThemeFile('a', '{"extends":"a"}', noCss).extends).toBeUndefined()
  })
})

let tmp: string
let store: ThemeStore | null = null

beforeEach(() => {
  tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'cockpit-themes-')))
})

afterEach(() => {
  store?.close()
  store = null
  fs.rmSync(tmp, { recursive: true, force: true })
})

function makeTheme(dir: string, json: unknown, css?: string): void {
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, 'theme.json'), JSON.stringify(json))
  if (css !== undefined) fs.writeFileSync(path.join(dir, 'theme.css'), css)
}

describe('ThemeStore', () => {
  it('lists built-ins, then folders, following symlinks', () => {
    const dir = path.join(tmp, 'themes')
    makeTheme(path.join(dir, 'neon'), { name: 'Neon', extends: 'amber' }, '.x{}')
    makeTheme(path.join(tmp, 'elsewhere'), { name: 'Linked' })
    fs.symlinkSync(path.join(tmp, 'elsewhere'), path.join(dir, 'linked'))
    store = new ThemeStore(dir, () => undefined)
    store.start()
    const list = store.list()
    expect(list.map((t) => t.id)).toEqual(['midnight', 'amber', 'paper', 'linked', 'neon'])
    expect(list.find((t) => t.id === 'neon')?.css).toMatch(
      /^cockpit-asset:\/\/themes\/neon\/theme\.css\?v=\d+$/
    )
    expect(store.root('linked')).toBe(path.join(tmp, 'elsewhere'))
  })

  it("explains folders it can't use", () => {
    const dir = path.join(tmp, 'themes')
    makeTheme(path.join(dir, 'amber'), {})
    makeTheme(path.join(dir, 'Upper'), {})
    fs.mkdirSync(path.join(dir, 'empty'))
    store = new ThemeStore(dir, () => undefined)
    store.start()
    const errors = Object.fromEntries(
      store
        .list()
        .filter((t) => t.error)
        .map((t) => [t.id, t.error])
    )
    expect(errors.Upper).toMatch(/lowercase/)
    expect(errors.empty).toMatch(/no theme\.json/)
    // The built-in amber is still there, unharmed.
    expect(store.list().filter((t) => t.id === 'amber' && !t.error)).toHaveLength(1)
    expect(store.root('amber')).toBeNull()
  })

  it('reports an edit', async () => {
    const dir = path.join(tmp, 'themes')
    makeTheme(path.join(dir, 'neon'), { tokens: { accent: '#000000' } })
    const seen: string[] = []
    store = new ThemeStore(dir, (list) => {
      const accent = list.find((t) => t.id === 'neon')?.tokens.accent
      if (accent) seen.push(accent)
    })
    store.start()
    await new Promise((r) => setTimeout(r, 300))
    makeTheme(path.join(dir, 'neon'), { tokens: { accent: '#ffffff' } })
    for (let i = 0; i < 100 && !seen.includes('#ffffff'); i++)
      await new Promise((r) => setTimeout(r, 20))
    expect(seen).toContain('#ffffff')
  })
})

describe('assetFile', () => {
  const roots = {
    theme: (id: string) => (id === 'neon' ? '/home/.cockpit/themes/neon' : null),
    images: () => '/home/.cockpit/images'
  }

  it('maps theme and image URLs into their folders', () => {
    expect(assetFile('cockpit-asset://themes/neon/img/bg.png', roots)).toEqual({
      file: '/home/.cockpit/themes/neon/img/bg.png',
      root: '/home/.cockpit/themes/neon',
      type: 'image/png'
    })
    expect(assetFile('cockpit-asset://images/banner.gif?v=3', roots)?.file).toBe(
      '/home/.cockpit/images/banner.gif'
    )
    expect(assetFile('cockpit-asset://themes/neon/theme.css', roots)?.type).toMatch(/text\/css/)
  })

  it('leaves the type open for a name without an extension', () => {
    expect(assetFile('cockpit-asset://images/banner', roots)).toEqual({
      file: '/home/.cockpit/images/banner',
      root: '/home/.cockpit/images',
      type: null
    })
  })

  it('refuses unknown themes, other file types, and escapes', () => {
    for (const url of [
      'cockpit-asset://themes/nope/a.png',
      'cockpit-asset://themes/neon/theme.json',
      'cockpit-asset://themes/neon/a.html',
      'cockpit-asset://themes/neon/%2e%2e/%2e%2e/x.png',
      'cockpit-asset://themes/neon/..%2f..%2fx.png',
      'cockpit-asset://themes/neon/a%5cb.png',
      'cockpit-asset://other/a.png',
      'cockpit-widget://neon/a.png',
      'not a url'
    ]) {
      expect(assetFile(url, roots), url).toBeNull()
    }
  })
})
