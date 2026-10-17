// cockpit.storage: one JSON object per widget in ~/.cockpit/data/<id>.json.
// Writes are atomic. Edits made to the file by something else (a script, an
// editor) are picked up and reported key by key, like the widget's own sets.
import fs from 'node:fs'
import path from 'node:path'
import { WidgetCallError } from './errors'

export const MAX_STORAGE_BYTES = 5 * 1024 * 1024
const MAX_KEY_LENGTH = 200

type Data = Record<string, unknown>

interface Entry {
  data: Data
  /** File contents as last read or written, to tell our writes from others'. */
  text: string
}

export type StorageListener = (widgetId: string, key: string, value: unknown) => void

/** JSON.stringify, which returns undefined for undefined and functions despite its type. */
const toJson = JSON.stringify as (value: unknown) => string | undefined

const isObj = (v: unknown): v is Data => typeof v === 'object' && v !== null && !Array.isArray(v)

function checkKey(key: unknown): string {
  if (typeof key !== 'string' || key.length === 0 || key.length > MAX_KEY_LENGTH) {
    throw new WidgetCallError(
      'invalid_argument',
      `storage key must be a non-empty string of at most ${MAX_KEY_LENGTH} characters`
    )
  }
  return key
}

export class WidgetStorage {
  private cache = new Map<string, Entry>()
  private watcher: fs.FSWatcher | null = null
  private timers = new Map<string, NodeJS.Timeout>()

  constructor(
    readonly dir: string,
    private readonly onChange: StorageListener
  ) {}

  get(widgetId: string, key: unknown): unknown {
    return this.load(widgetId).data[checkKey(key)]
  }

  keys(widgetId: string): string[] {
    return Object.keys(this.load(widgetId).data)
  }

  /** `undefined` removes the key. Values are stored as JSON. */
  set(widgetId: string, key: unknown, value: unknown): void {
    const k = checkKey(key)
    const entry = this.load(widgetId)
    let json: string | undefined
    try {
      json = toJson(value)
    } catch (err) {
      throw new WidgetCallError(
        'invalid_argument',
        `storage value for "${k}" is not JSON: ${(err as Error).message}`
      )
    }
    const next: Data = Object.fromEntries(Object.entries(entry.data).filter(([key]) => key !== k))
    if (json !== undefined) next[k] = JSON.parse(json) as unknown
    if (JSON.stringify(entry.data[k]) === JSON.stringify(next[k])) return
    const text = JSON.stringify(next, null, 2) + '\n'
    if (Buffer.byteLength(text) > MAX_STORAGE_BYTES) {
      throw new WidgetCallError(
        'too_large',
        `storage is limited to ${MAX_STORAGE_BYTES / 1024 / 1024} MB per widget`
      )
    }
    this.write(widgetId, text)
    this.cache.set(widgetId, { data: next, text })
    this.onChange(widgetId, k, next[k])
  }

  watch(): void {
    fs.mkdirSync(this.dir, { recursive: true })
    this.watcher = fs.watch(this.dir, (_event, name) => {
      const id = name?.endsWith('.json') ? name.slice(0, -5) : null
      if (!id) return
      clearTimeout(this.timers.get(id))
      this.timers.set(
        id,
        setTimeout(() => {
          this.timers.delete(id)
          this.reload(id)
        }, 100)
      )
    })
  }

  close(): void {
    this.watcher?.close()
    for (const t of this.timers.values()) clearTimeout(t)
    this.timers.clear()
  }

  private file(widgetId: string): string {
    return path.join(this.dir, `${widgetId}.json`)
  }

  private load(widgetId: string): Entry {
    let entry = this.cache.get(widgetId)
    if (!entry) {
      entry = this.read(widgetId) ?? { data: {}, text: '' }
      this.cache.set(widgetId, entry)
    }
    return entry
  }

  private read(widgetId: string): Entry | null {
    let text: string
    try {
      text = fs.readFileSync(this.file(widgetId), 'utf8')
    } catch {
      return null
    }
    try {
      const data: unknown = JSON.parse(text)
      return { data: isObj(data) ? data : {}, text }
    } catch {
      return null
    }
  }

  /** Someone else changed the file: report each key that differs. */
  private reload(widgetId: string): void {
    const before = this.cache.get(widgetId)
    if (!before) return // not loaded yet; the first get reads it fresh
    let text = ''
    try {
      text = fs.readFileSync(this.file(widgetId), 'utf8')
    } catch {
      // deleted: treat as empty
    }
    if (text === before.text) return
    let data: Data = {}
    if (text) {
      try {
        const parsed: unknown = JSON.parse(text)
        data = isObj(parsed) ? parsed : {}
      } catch {
        return // mid-write or a typo; wait for the next save
      }
    }
    this.cache.set(widgetId, { data, text })
    const keys = new Set([...Object.keys(before.data), ...Object.keys(data)])
    for (const key of keys) {
      if (JSON.stringify(before.data[key]) !== JSON.stringify(data[key])) {
        this.onChange(widgetId, key, data[key])
      }
    }
  }

  private write(widgetId: string, text: string): void {
    fs.mkdirSync(this.dir, { recursive: true })
    const file = this.file(widgetId)
    const tmp = `${file}.tmp`
    fs.writeFileSync(tmp, text, { mode: 0o600 })
    fs.renameSync(tmp, file)
  }
}
