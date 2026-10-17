// User themes: ~/.cockpit/themes/<id>/theme.json, with an optional
// stylesheet and the images and fonts it uses. Folders may be symlinks.
// Changes to any of them are picked up live.
import fs from 'node:fs'
import path from 'node:path'
import { themeAssetUrl } from '@shared/assets'
import { readPalette, readTokens, type ThemeDefinition } from '@shared/theme'
import { BUILT_IN_THEMES } from '@shared/themes'
import { abbreviateHome } from './paths'
import { TreeWatcher } from './watch'

export const THEME_FILE = 'theme.json'
const DEFAULT_CSS = 'theme.css'

/** Theme ids go into URLs and the menu. */
export const THEME_ID = /^[a-z0-9][a-z0-9_-]{0,63}$/

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

/** A relative path that stays inside the theme folder. */
const safeRelative = (p: string): boolean =>
  p.length > 0 &&
  p.length <= 200 &&
  !path.isAbsolute(p) &&
  !p.includes('\\') &&
  !p.includes('\0') &&
  !p.split('/').includes('..')

/**
 * A theme definition from the text of a theme.json. `cssRevision` is the
 * stylesheet's modification time when it exists, null when it doesn't.
 */
export function parseThemeFile(
  id: string,
  text: string,
  cssRevision: (file: string) => number | null
): ThemeDefinition {
  const failed = (error: string): ThemeDefinition => ({
    id,
    name: id,
    tokens: {},
    terminal: {},
    error
  })
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch (err) {
    return failed(`${THEME_FILE} is not valid JSON: ${(err as Error).message}`)
  }
  if (!isObj(raw)) return failed(`${THEME_FILE} must be an object`)
  const name = typeof raw.name === 'string' && raw.name.trim() ? raw.name.trim().slice(0, 60) : id
  const def: ThemeDefinition = {
    id,
    name,
    tokens: readTokens(raw.tokens),
    terminal: readPalette(raw.terminal)
  }
  if (typeof raw.extends === 'string' && raw.extends !== id) def.extends = raw.extends
  const cssFile = raw.css === undefined ? DEFAULT_CSS : raw.css
  if (typeof cssFile !== 'string' || !safeRelative(cssFile)) {
    return { ...def, error: '"css" must be a path inside the theme folder' }
  }
  const revision = cssRevision(cssFile)
  if (revision !== null) def.css = themeAssetUrl(id, cssFile, revision)
  else if (raw.css !== undefined) def.error = `stylesheet "${cssFile}" not found`
  return def
}

/** The built-in themes and those in the themes folder, kept up to date. */
export class ThemeStore {
  private user: ThemeDefinition[] = []
  private roots = new Map<string, string>()
  private readonly watcher: TreeWatcher

  constructor(
    readonly dir: string,
    private readonly onChange: (themes: ThemeDefinition[]) => void
  ) {
    this.watcher = new TreeWatcher(dir, () => {
      const before = JSON.stringify(this.user)
      this.load()
      if (JSON.stringify(this.user) !== before) this.onChange(this.list())
    })
  }

  start(): void {
    this.watcher.start()
    this.load()
  }

  close(): void {
    this.watcher.close()
  }

  list(): ThemeDefinition[] {
    return [...BUILT_IN_THEMES, ...this.user]
  }

  /** Real path of a user theme's folder. */
  root(id: string): string | null {
    return this.roots.get(id) ?? null
  }

  private load(): void {
    const themes: ThemeDefinition[] = []
    const roots = new Map<string, string>()
    let names: string[] = []
    try {
      names = fs.readdirSync(this.dir).sort()
    } catch {
      // no folder yet
    }
    const builtIn = new Set(BUILT_IN_THEMES.map((t) => t.id))
    for (const name of names) {
      if (name.startsWith('.')) continue
      let root: string
      try {
        root = fs.realpathSync(path.join(this.dir, name))
        if (!fs.statSync(root).isDirectory()) continue
      } catch {
        continue
      }
      const fail = (error: string): void => {
        themes.push({ id: name, name, tokens: {}, terminal: {}, dir: abbreviateHome(root), error })
      }
      if (!THEME_ID.test(name)) {
        fail('folder name must be lowercase letters, digits, - and _')
        continue
      }
      if (builtIn.has(name)) {
        fail(`"${name}" is a built-in theme; use another folder name and "extends": "${name}"`)
        continue
      }
      let text: string
      try {
        text = fs.readFileSync(path.join(root, THEME_FILE), 'utf8')
      } catch {
        fail(`no ${THEME_FILE} in the folder`)
        continue
      }
      const def = parseThemeFile(name, text, (file) => {
        try {
          const full = fs.realpathSync(path.join(root, file))
          if (!full.startsWith(root + path.sep)) return null
          return Math.round(fs.statSync(full).mtimeMs)
        } catch {
          return null
        }
      })
      themes.push({ ...def, dir: abbreviateHome(root) })
      roots.set(name, root)
    }
    this.user = themes
    this.roots = roots
  }
}
