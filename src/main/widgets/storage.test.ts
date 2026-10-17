import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
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

  it('treats a corrupt file as empty', () => {
    fs.writeFileSync(path.join(dir, 'hello.json'), '{not json')
    expect(storage.get('hello', 'a')).toBeUndefined()
    storage.set('hello', 'a', 1)
    expect(storage.get('hello', 'a')).toBe(1)
  })

  it('picks up edits made to the file by something else', async () => {
    storage.watch()
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
