import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { MAX_STORAGE_BYTES, WidgetStorage } from './storage'

let dir: string
let changes: [string, string, unknown][]
let storage: WidgetStorage

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cockpit-storage-'))
  changes = []
  storage = new WidgetStorage(dir, (id, key, value) => changes.push([id, key, value]))
})

afterEach(() => {
  storage.close()
  fs.rmSync(dir, { recursive: true, force: true })
})

const waitFor = async (cond: () => boolean): Promise<void> => {
  for (let i = 0; i < 100 && !cond(); i++) await new Promise((r) => setTimeout(r, 20))
}

describe('WidgetStorage', () => {
  it('stores JSON values per widget in data/<id>.json', () => {
    storage.set('hello', 'count', 3)
    storage.set('hello', 'prefs', { view: 'doing' })
    storage.set('other', 'count', 9)
    expect(storage.get('hello', 'count')).toBe(3)
    expect(storage.get('hello', 'prefs')).toEqual({ view: 'doing' })
    expect(storage.get('hello', 'missing')).toBeUndefined()
    expect(storage.keys('hello')).toEqual(['count', 'prefs'])
    expect(JSON.parse(fs.readFileSync(path.join(dir, 'hello.json'), 'utf8'))).toEqual({
      count: 3,
      prefs: { view: 'doing' }
    })
    // A fresh instance reads what was written.
    expect(new WidgetStorage(dir, () => undefined).get('other', 'count')).toBe(9)
  })

  it('reports changes, but not writes of an equal value', () => {
    storage.set('hello', 'a', 1)
    storage.set('hello', 'a', 1)
    storage.set('hello', 'a', 2)
    storage.set('hello', 'a', undefined)
    expect(changes).toEqual([
      ['hello', 'a', 1],
      ['hello', 'a', 2],
      ['hello', 'a', undefined]
    ])
    expect(storage.keys('hello')).toEqual([])
  })

  it('normalizes values through JSON', () => {
    storage.set('hello', 'd', { when: new Date(0), skip: undefined })
    expect(storage.get('hello', 'd')).toEqual({ when: '1970-01-01T00:00:00.000Z' })
  })

  it('rejects bad keys, non-JSON values, and oversized data', () => {
    expect(() => storage.set('hello', '', 1)).toThrow('key')
    expect(() => storage.get('hello', 7)).toThrow('key')
    const cyclic: Record<string, unknown> = {}
    cyclic.self = cyclic
    expect(() => storage.set('hello', 'c', cyclic)).toThrow('not JSON')
    expect(() => storage.set('hello', 'big', 'x'.repeat(MAX_STORAGE_BYTES))).toThrow('limited')
    expect(storage.keys('hello')).toEqual([])
  })

  it('reads a corrupt file as empty but refuses to overwrite it', () => {
    const file = path.join(dir, 'hello.json')
    fs.writeFileSync(file, '{"a": 1,')
    expect(storage.get('hello', 'a')).toBeUndefined()
    expect(() => storage.set('hello', 'b', 2)).toThrow('not a JSON object')
    expect(fs.readFileSync(file, 'utf8')).toBe('{"a": 1,')
    fs.writeFileSync(file, '{"a": 1}')
    storage.set('hello', 'b', 2)
    expect(JSON.parse(fs.readFileSync(file, 'utf8'))).toEqual({ a: 1, b: 2 })
  })

  it('keeps an edit made just before a set', () => {
    storage.set('hello', 'a', 1)
    fs.writeFileSync(path.join(dir, 'hello.json'), JSON.stringify({ a: 1, edited: true }))
    changes = []
    storage.set('hello', 'b', 2)
    expect(storage.get('hello', 'edited')).toBe(true)
    expect(changes).toEqual([
      ['hello', 'edited', true],
      ['hello', 'b', 2]
    ])
  })

  it('treats keys like __proto__ and toString as plain keys', () => {
    expect(storage.get('hello', 'toString')).toBeUndefined()
    storage.set('hello', '__proto__', { x: 1 })
    storage.set('hello', 'toString', 'fine')
    expect(storage.get('hello', '__proto__')).toEqual({ x: 1 })
    expect(storage.keys('hello').sort()).toEqual(['__proto__', 'toString'])
    expect(new WidgetStorage(dir, () => undefined).get('hello', '__proto__')).toEqual({ x: 1 })
  })

  it('picks up edits made to the file by something else', async () => {
    storage.watch()
    // macOS file watching takes a moment to start; under a busy test run an
    // edit made at once can be missed. (In the app, edits come much later.)
    await new Promise((r) => setTimeout(r, 200))
    storage.set('hello', 'a', 1)
    storage.set('hello', 'b', 2)
    changes = []
    fs.writeFileSync(path.join(dir, 'hello.json'), JSON.stringify({ a: 1, b: 3, c: 4 }))
    await waitFor(() => changes.length >= 2)
    expect(changes).toEqual([
      ['hello', 'b', 3],
      ['hello', 'c', 4]
    ])
    expect(storage.get('hello', 'c')).toBe(4)
  })
})
