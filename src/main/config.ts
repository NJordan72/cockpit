import fs from 'node:fs'
import path from 'node:path'
import {
  CONFIG_VERSION,
  migrateConfig,
  pushRecentDir,
  pushRecentPage,
  readAppearance,
  type AppearanceSettings,
  type CockpitConfig,
  type LauncherSettings,
  type WindowState
} from '@shared/config'
import { cockpitHome } from './paths'

/**
 * Reads and writes ~/.cockpit/config.json. Writes are atomic (temp file +
 * rename). Edits made by hand while the app runs are picked up and reported
 * through onExternalChange.
 */
export class ConfigStore {
  readonly file: string
  private config: CockpitConfig
  private lastWritten = ''
  private watcher: fs.FSWatcher | null = null
  private debounce: NodeJS.Timeout | null = null

  constructor(private readonly onExternalChange: (c: CockpitConfig) => void) {
    const dir = cockpitHome()
    fs.mkdirSync(dir, { recursive: true })
    this.file = path.join(dir, 'config.json')
    this.config = this.read()
    // Write back so the file always shows every option with its current value.
    this.write()
  }

  get(): CockpitConfig {
    return this.config
  }

  /** Run through migration, so a bad layout from the chrome can't corrupt the file. */
  setWindows(windows: WindowState[]): void {
    this.config = migrateConfig({ ...this.config, windows })
    this.write()
  }

  updateWindow(id: string, fn: (w: WindowState) => WindowState): void {
    const { windows } = this.config
    if (!windows.some((w) => w.id === id)) return
    this.setWindows(windows.map((w) => (w.id === id ? fn(w) : w)))
  }

  setAppearance(appearance: AppearanceSettings): void {
    // Through migration as a whole, so a window whose layout is gone falls back.
    this.config = migrateConfig({ ...this.config, appearance: readAppearance({ appearance }) })
    this.write()
  }

  setLauncher(launcher: LauncherSettings): void {
    this.config = { ...this.config, launcher: migrateConfig({ launcher }).launcher }
    this.write()
  }

  addRecentDir(dir: string, presetId: string): void {
    const entry = { path: dir, presetId, at: Date.now() }
    this.config = { ...this.config, recentDirs: pushRecentDir(this.config.recentDirs, entry) }
    this.write()
  }

  addRecentPage(url: string): void {
    const recentPages = pushRecentPage(this.config.recentPages, { url, at: Date.now() })
    this.config = { ...this.config, recentPages }
    this.write()
  }

  /** Give a recent page the title it set. Pages not in the list are left out. */
  setRecentPageTitle(url: string, title: string): void {
    const page = this.config.recentPages.find((p) => p.url === url)
    if (!page || page.title === title) return
    const recentPages = this.config.recentPages.map((p) => (p === page ? { ...p, title } : p))
    this.config = { ...this.config, recentPages }
    this.write()
  }

  watch(): void {
    // Watch the directory: an editor's atomic save replaces the file's inode.
    this.watcher = fs.watch(path.dirname(this.file), (_event, name) => {
      if (name !== path.basename(this.file)) return
      if (this.debounce) clearTimeout(this.debounce)
      this.debounce = setTimeout(() => {
        this.reloadIfChanged()
      }, 150)
    })
  }

  close(): void {
    this.watcher?.close()
    if (this.debounce) clearTimeout(this.debounce)
  }

  private reloadIfChanged(): void {
    let text: string
    try {
      text = fs.readFileSync(this.file, 'utf8')
    } catch {
      return
    }
    if (text === this.lastWritten) return
    let raw: unknown
    try {
      raw = JSON.parse(text)
    } catch {
      // Half-written or mid-edit; wait for the next save.
      return
    }
    // The chrome owns the open windows and their tabs; a hand edit can't
    // rearrange open panes. The appearance and each window's layout do come
    // from the file, so they can be edited by hand.
    const read = migrateConfig(raw)
    const windows = this.config.windows.map((w) => {
      const edited = read.windows.find((r) => r.id === w.id)
      return edited ? { ...w, layout: edited.layout, panelsHidden: edited.panelsHidden } : w
    })
    this.config = migrateConfig({ ...read, windows })
    this.lastWritten = text
    this.onExternalChange(this.config)
  }

  private read(): CockpitConfig {
    try {
      const raw: unknown = JSON.parse(fs.readFileSync(this.file, 'utf8'))
      this.backUpOlder(raw)
      return migrateConfig(raw)
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
        // Keep the broken file for the user instead of overwriting it silently.
        const backup = `${this.file}.broken-${Date.now().toString()}`
        try {
          fs.copyFileSync(this.file, backup)
          console.warn(`config.json could not be read; saved a copy to ${backup}`)
        } catch {
          // nothing to back up
        }
      }
      return migrateConfig(undefined)
    }
  }

  /**
   * Keep a copy of a file from an older version before it's rewritten, so
   * going back to an older build doesn't lose what this one moved. Once only.
   */
  private backUpOlder(raw: unknown): void {
    const version =
      typeof raw === 'object' && raw !== null && 'version' in raw ? raw.version : undefined
    if (typeof version !== 'number' || version >= CONFIG_VERSION) return
    const backup = path.join(path.dirname(this.file), `config.v${String(version)}.json`)
    try {
      fs.copyFileSync(this.file, backup, fs.constants.COPYFILE_EXCL)
    } catch {
      // already there
    }
  }

  private write(): void {
    const text = JSON.stringify(this.config, null, 2) + '\n'
    if (text === this.lastWritten) return
    const tmp = `${this.file}.tmp`
    fs.writeFileSync(tmp, text, { mode: 0o600 })
    fs.renameSync(tmp, this.file)
    this.lastWritten = text
  }
}
