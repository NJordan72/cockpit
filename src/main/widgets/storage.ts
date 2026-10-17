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

/** Own properties only, so keys like "toString" and "__proto__" are plain keys. */
const own = (data: Data, key: string): unknown => (Object.hasOwn(data, key) ? data[key] : undefined)

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
  /** What each widget's file held when last read or written. */
  private cache = new Map<string, Entry>()
  private watcher: fs.FSWatcher | null = null
  private timers = new Map<string, NodeJS.Timeout>()

  constructor(
    readonly dir: string,
    private readonly onChange: StorageListener
  ) {}

  get(widgetId: string, key: unknown): unknown {
    return own(this.current(widgetId, false).data, checkKey(key))
  }

  keys(widgetId: string): string[] {
    return Object.keys(this.current(widgetId, false).data)
  }

  /** `undefined` removes the key. Values are stored as JSON. */
  set(widgetId: string, key: unknown, value: unknown): void {
    const k = checkKey(key)
    // Read the file first, so an edit made since the last read isn't lost.
    const entry = this.current(widgetId, true)
    let json: string | undefined
    try {
      json = toJson(value)
    } catch (err) {
      throw new WidgetCallError(
        'invalid_argument',
        `storage value for "${k}" is not JSON: ${(err as Error).message}`
      )
    }
    const rest = Object.entries(entry.data).filter(([other]) => other !== k)
    // fromEntries defines own properties, even for a key named __proto__.
    const next: Data = Object.fromEntries(
      json === undefined ? rest : [...rest, [k, JSON.parse(json) as unknown]]
    )
    if (JSON.stringify(own(entry.data, k)) === JSON.stringify(own(next, k))) return
    const text = JSON.stringify(next, null, 2) + '\n'
    if (Buffer.byteLength(text) > MAX_STORAGE_BYTES) {
      throw new WidgetCallError(
        'too_large',
        `storage is limited to ${MAX_STORAGE_BYTES / 1024 / 1024} MB per widget`
      )
    }
    this.write(widgetId, text)
    this.cache.set(widgetId, { data: next, text })
    this.onChange(widgetId, k, own(next, k))
  }

  watch(): void {
    fs.mkdirSync(this.dir, { recursive: true })
    this.watcher = fs.watch(this.dir, (_event, name) => {
      const id = name?.endsWith('.json') ? name.slice(0, -5) : null
      // Widgets that haven't used storage yet have nothing to compare against.
      if (!id || !this.cache.has(id)) return
      clearTimeout(this.timers.get(id))
      this.timers.set(
        id,
        setTimeout(() => {
          this.timers.delete(id)
          this.current(id, false)
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

  /**
   * The widget's data as the file holds it now. If something else changed
   * the file since the last read, each key that differs is reported. A file
   * that isn't a JSON object is refused when `strict` (so a write can't
   * replace it) and otherwise read as the last good data.
   */
  private current(widgetId: string, strict: boolean): Entry {
    const before = this.cache.get(widgetId)
    let text = ''
    try {
      text = fs.readFileSync(this.file(widgetId), 'utf8')
    } catch {
      // missing: empty
    }
    if (before?.text === text) return before
    let data: Data = {}
    try {
      const parsed: unknown = text.trim() ? JSON.parse(text) : {}
      if (!isObj(parsed)) throw new Error('not an object')
      data = parsed
    } catch {
      if (strict) {
        throw new WidgetCallError(
          'unavailable',
          `${this.file(widgetId)} is not a JSON object; fix or delete it`
        )
      }
      return before ?? { data, text: '' }
    }
    const entry = { data, text }
    this.cache.set(widgetId, entry)
    if (before) {
      for (const key of new Set([...Object.keys(before.data), ...Object.keys(data)])) {
        if (JSON.stringify(own(before.data, key)) !== JSON.stringify(own(data, key))) {
          this.onChange(widgetId, key, own(data, key))
        }
      }
    }
    return entry
  }

  private write(widgetId: string, text: string): void {
    fs.mkdirSync(this.dir, { recursive: true })
    const file = this.file(widgetId)
    const tmp = `${file}.tmp`
    fs.writeFileSync(tmp, text, { mode: 0o600 })
    fs.renameSync(tmp, file)
  }
}
