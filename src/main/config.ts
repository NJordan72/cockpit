import fs from 'node:fs'
import path from 'node:path'
import { migrateConfig, pushRecentDir, type CockpitConfig, type Layout } from '@shared/config'
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

  setLayout(layout: Layout): void {
    this.config = migrateConfig({ ...this.config, layout })
    this.write()
  }

  addRecentDir(dir: string): void {
    this.config = { ...this.config, recentDirs: pushRecentDir(this.config.recentDirs, dir) }
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
    // The renderer owns the live layout; a hand edit can't rearrange open panes.
    this.config = { ...migrateConfig(raw), layout: this.config.layout }
    this.lastWritten = text
    this.onExternalChange(this.config)
  }

  private read(): CockpitConfig {
    try {
      return migrateConfig(JSON.parse(fs.readFileSync(this.file, 'utf8')))
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

  private write(): void {
    const text = JSON.stringify(this.config, null, 2) + '\n'
    if (text === this.lastWritten) return
    const tmp = `${this.file}.tmp`
    fs.writeFileSync(tmp, text, { mode: 0o600 })
    fs.renameSync(tmp, this.file)
    this.lastWritten = text
  }
}
