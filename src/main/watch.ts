import fs from 'node:fs'
import path from 'node:path'

const DELAY_MS = 150

/** Editor droppings that shouldn't count as a change. */
const ignored = (name: string): boolean =>
  name.split(path.sep).some((part) => part.startsWith('.')) || name.endsWith('~')

/**
 * Calls onChange, debounced, when anything under `dir` changes, including
 * inside the targets of symlinks in it (fs.watch doesn't follow them).
 */
export class TreeWatcher {
  /** Real path -> watcher, for the folder itself and each symlink target. */
  private watchers = new Map<string, fs.FSWatcher>()
  private timer: NodeJS.Timeout | null = null

  constructor(
    readonly dir: string,
    private readonly onChange: () => void
  ) {}

  start(): void {
    fs.mkdirSync(this.dir, { recursive: true })
    this.sync()
  }

  close(): void {
    if (this.timer) clearTimeout(this.timer)
    for (const w of this.watchers.values()) w.close()
    this.watchers.clear()
  }

  private changed(file: string | null): void {
    if (file && ignored(file)) return
    if (this.timer) clearTimeout(this.timer)
    this.timer = setTimeout(() => {
      this.timer = null
      // A link may have been added or removed.
      this.sync()
      this.onChange()
    }, DELAY_MS)
  }

  /** Watch the folder and the current targets of its symlinks. */
  private sync(): void {
    const roots = new Set<string>()
    try {
      roots.add(fs.realpathSync(this.dir))
      for (const e of fs.readdirSync(this.dir, { withFileTypes: true })) {
        if (!e.isSymbolicLink()) continue
        try {
          roots.add(fs.realpathSync(path.join(this.dir, e.name)))
        } catch {
          // broken link
        }
      }
    } catch {
      // The folder is gone; nothing to watch until it comes back.
    }
    for (const [root, w] of this.watchers) {
      if (roots.has(root)) continue
      w.close()
      this.watchers.delete(root)
    }
    for (const root of roots) {
      if (this.watchers.has(root)) continue
      try {
        const recursive = fs.statSync(root).isDirectory()
        const w = fs.watch(root, { recursive }, (_event, file) => {
          this.changed(file)
        })
        w.on('error', () => {
          w.close()
          this.watchers.delete(root)
        })
        this.watchers.set(root, w)
      } catch (err) {
        console.warn(`could not watch ${root}:`, err)
      }
    }
  }
}
