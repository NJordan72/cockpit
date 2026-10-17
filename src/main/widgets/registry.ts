// Finds widgets in ~/.cockpit/widgets/ and watches them. Each entry is a
// folder, or a symlink to one: symlinks are followed and the real folder is
// watched, so a widget installed as a link to a repo reloads when the repo's
// files change.
import fs from 'node:fs'
import path from 'node:path'
import type { WidgetInfo } from '@shared/widgets'
import { abbreviateHome } from '../paths'
import { MANIFEST_FILE, parseManifest, WIDGET_ID, type ParsedManifest } from './manifest'

export interface LoadedWidget {
  info: WidgetInfo
  /** Real path of the widget folder. */
  root: string | null
  parsed: ParsedManifest | null
}

interface Folder {
  root: string
  watcher: fs.FSWatcher
}

const RELOAD_DELAY_MS = 150

/** Editor droppings that shouldn't reload a widget. */
const ignoredChange = (name: string): boolean =>
  name.split(path.sep).some((part) => part.startsWith('.')) || name.endsWith('~')

export class WidgetRegistry {
  private widgets = new Map<string, LoadedWidget>()
  private folders = new Map<string, Folder>()
  private dirWatcher: fs.FSWatcher | null = null
  private rescanTimer: NodeJS.Timeout | null = null
  private reloadTimers = new Map<string, NodeJS.Timeout>()

  constructor(
    readonly dir: string,
    private readonly onChange: (widgets: WidgetInfo[]) => void
  ) {}

  start(): void {
    fs.mkdirSync(this.dir, { recursive: true })
    this.rescan()
    this.dirWatcher = fs.watch(this.dir, () => {
      if (this.rescanTimer) clearTimeout(this.rescanTimer)
      this.rescanTimer = setTimeout(() => {
        this.rescanTimer = null
        if (this.rescan()) this.onChange(this.list())
      }, RELOAD_DELAY_MS)
    })
  }

  close(): void {
    this.dirWatcher?.close()
    if (this.rescanTimer) clearTimeout(this.rescanTimer)
    for (const t of this.reloadTimers.values()) clearTimeout(t)
    for (const f of this.folders.values()) f.watcher.close()
    this.folders.clear()
  }

  list(): WidgetInfo[] {
    return [...this.widgets.values()].map((w) => w.info).sort((a, b) => a.id.localeCompare(b.id))
  }

  get(id: string): LoadedWidget | undefined {
    return this.widgets.get(id)
  }

  /** Re-read the folder list. Returns whether anything changed. */
  private rescan(): boolean {
    let names: string[]
    try {
      names = fs.readdirSync(this.dir).filter((n) => !n.startsWith('.'))
    } catch {
      names = []
    }
    let changed = false
    const present = new Set<string>()
    for (const name of names) {
      const prev = this.widgets.get(name)
      const next = this.load(name, prev?.info.revision ?? 1)
      if (!next) continue
      present.add(name)
      if (
        !prev ||
        JSON.stringify(prev.info) !== JSON.stringify(next.info) ||
        prev.root !== next.root
      ) {
        // A retargeted symlink is a new widget as far as the iframe is concerned.
        if (prev && prev.root !== next.root) next.info.revision = prev.info.revision + 1
        this.widgets.set(name, next)
        changed = true
      }
      this.watchFolder(name, next.root)
    }
    for (const id of [...this.widgets.keys()]) {
      if (present.has(id)) continue
      this.widgets.delete(id)
      this.watchFolder(id, null)
      changed = true
    }
    return changed
  }

  /** null when the entry isn't a folder at all (a README, say). */
  private load(name: string, revision: number): LoadedWidget | null {
    const full = path.join(this.dir, name)
    const fail = (error: string, root: string | null = null): LoadedWidget => ({
      info: { id: name, dir: abbreviateHome(root ?? full), revision, manifest: null, error },
      root,
      parsed: null
    })

    let isLink = false
    try {
      isLink = fs.lstatSync(full).isSymbolicLink()
    } catch {
      return null
    }
    let stat: fs.Stats
    try {
      stat = fs.statSync(full)
    } catch {
      if (!isLink) return null
      let target = '?'
      try {
        target = fs.readlinkSync(full)
      } catch {
        // keep '?'
      }
      return fail(`broken symlink (points to ${target})`)
    }
    if (!stat.isDirectory()) return null

    const root = fs.realpathSync(full)
    if (!WIDGET_ID.test(name)) {
      return fail('folder name must be lowercase letters, digits, and dashes', root)
    }
    let text: string
    try {
      text = fs.readFileSync(path.join(root, MANIFEST_FILE), 'utf8')
    } catch {
      return fail(`no ${MANIFEST_FILE} in the folder`, root)
    }
    let raw: unknown
    try {
      raw = JSON.parse(text)
    } catch (err) {
      return fail(`${MANIFEST_FILE} is not valid JSON: ${(err as Error).message}`, root)
    }
    let parsed: ParsedManifest
    try {
      parsed = parseManifest(raw, name)
    } catch (err) {
      return fail(`${MANIFEST_FILE}: ${(err as Error).message}`, root)
    }
    if (!fs.existsSync(path.join(root, parsed.manifest.entry))) {
      return fail(`entry file "${parsed.manifest.entry}" not found`, root)
    }
    return {
      info: {
        id: name,
        dir: abbreviateHome(root),
        revision,
        manifest: parsed.manifest,
        error: null
      },
      root,
      parsed
    }
  }

  private watchFolder(id: string, root: string | null): void {
    const current = this.folders.get(id)
    if (current?.root === root) return
    current?.watcher.close()
    this.folders.delete(id)
    if (!root) return
    try {
      const watcher = fs.watch(root, { recursive: true }, (_event, file) => {
        if (file && ignoredChange(file)) return
        clearTimeout(this.reloadTimers.get(id))
        this.reloadTimers.set(
          id,
          setTimeout(() => {
            this.reloadTimers.delete(id)
            this.reloadOne(id)
          }, RELOAD_DELAY_MS)
        )
      })
      this.folders.set(id, { root, watcher })
    } catch (err) {
      console.warn(`could not watch widget folder ${root}:`, err)
    }
  }

  /** A file inside a widget changed: re-read it and bump its revision. */
  private reloadOne(id: string): void {
    const prev = this.widgets.get(id)
    if (!prev) return
    const next = this.load(id, prev.info.revision + 1)
    if (!next) {
      this.widgets.delete(id)
      this.watchFolder(id, null)
    } else {
      this.widgets.set(id, next)
      this.watchFolder(id, next.root)
    }
    this.onChange(this.list())
  }
}
