import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { WidgetCallResult } from '@shared/widgets'
import { WidgetBroker, type BrokerDeps } from './broker'
import { parseManifest } from './manifest'
import type { LoadedWidget } from './registry'
import type { SecretStore } from './secrets'
import { WidgetStorage } from './storage'

vi.mock('electron', () => ({ safeStorage: {} }))

function widget(id: string, permissions: Record<string, unknown>): LoadedWidget {
  const parsed = parseManifest({ id, name: id, permissions }, id)
  return {
    info: { id, dir: `~/w/${id}`, revision: 1, manifest: parsed.manifest, error: null },
    root: `/w/${id}`,
    parsed
  }
}

class MemorySecrets {
  values = new Map<string, string>()
  get(id: string, name: string): Promise<string | null> {
    return Promise.resolve(this.values.get(`${id}/${name}`) ?? null)
  }
  set(id: string, name: string, value: string): Promise<void> {
    this.values.set(`${id}/${name}`, value)
    return Promise.resolve()
  }
  delete(id: string, name: string): Promise<void> {
    this.values.delete(`${id}/${name}`)
    return Promise.resolve()
  }
}

let dir: string
let secrets: MemorySecrets
let prompt: BrokerDeps['promptSecret']
let opened: string[]
let broker: WidgetBroker

const widgets = {
  full: widget('full', {
    network: ['api.example.com'],
    openExternal: ['https://app.example.com/*'],
    secrets: ['token'],
    storage: true,
    sessions: 'read'
  }),
  bare: widget('bare', {})
}

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cockpit-broker-'))
  secrets = new MemorySecrets()
  prompt = vi.fn(() => Promise.resolve<string | null>('typed-in'))
  opened = []
  broker = new WidgetBroker({
    widget: (id) => widgets[id as keyof typeof widgets],
    storage: new WidgetStorage(dir, () => undefined),
    secrets: secrets as unknown as SecretStore,
    promptSecret: (w, name) => prompt(w, name),
    sessions: () => [],
    openExternal: (url) => {
      opened.push(url)
      return Promise.resolve()
    }
  })
})

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true })
})

const errorCode = (r: WidgetCallResult): string | null => (r.ok ? null : r.error.code)

describe('WidgetBroker', () => {
  it('refuses unknown widgets and methods', async () => {
    expect(errorCode(await broker.call('nope', 'storage.get', { key: 'a' }))).toBe('not_found')
    expect(errorCode(await broker.call('full', 'eval', {}))).toBe('invalid_argument')
    expect(errorCode(await broker.call('full', 42, {}))).toBe('invalid_argument')
  })

  it('grants nothing a manifest does not declare', async () => {
    const calls: [string, unknown][] = [
      ['fetch', { url: 'https://api.example.com/' }],
      ['storage.get', { key: 'a' }],
      ['storage.set', { key: 'a', value: 1 }],
      ['storage.keys', {}],
      ['secrets.get', { name: 'token' }],
      ['secrets.set', { name: 'token', value: 'x' }],
      ['secrets.delete', { name: 'token' }],
      ['openExternal', { url: 'https://app.example.com/' }],
      ['sessions.list', {}]
    ]
    for (const [method, params] of calls) {
      expect(errorCode(await broker.call('bare', method, params)), method).toBe('permission_denied')
    }
    expect(opened).toEqual([])
    expect(prompt).not.toHaveBeenCalled()
  })

  it('keeps storage separate per widget', async () => {
    await broker.call('full', 'storage.set', { key: 'a', value: { n: 1 } })
    expect(await broker.call('full', 'storage.get', { key: 'a' })).toEqual({
      ok: true,
      value: { n: 1 }
    })
    expect(await broker.call('full', 'storage.keys', {})).toEqual({ ok: true, value: ['a'] })
  })

  it('only hands out declared secrets, prompting once when missing', async () => {
    expect(errorCode(await broker.call('full', 'secrets.get', { name: 'other' }))).toBe(
      'permission_denied'
    )
    expect(await broker.call('full', 'secrets.get', { name: 'token', prompt: false })).toEqual({
      ok: true,
      value: null
    })
    expect(prompt).not.toHaveBeenCalled()
    expect(await broker.call('full', 'secrets.get', { name: 'token' })).toEqual({
      ok: true,
      value: 'typed-in'
    })
    expect(secrets.values.get('full/token')).toBe('typed-in')
    await broker.call('full', 'secrets.get', { name: 'token' })
    expect(prompt).toHaveBeenCalledTimes(1)
  })

  it('reports a dismissed prompt as cancelled and stores nothing', async () => {
    prompt = vi.fn(() => Promise.resolve(null))
    expect(errorCode(await broker.call('full', 'secrets.get', { name: 'token' }))).toBe('cancelled')
    expect(secrets.values.size).toBe(0)
  })

  it('validates secret values', async () => {
    expect(errorCode(await broker.call('full', 'secrets.set', { name: 'token', value: '' }))).toBe(
      'invalid_argument'
    )
    expect(errorCode(await broker.call('full', 'secrets.set', { name: 'token', value: 7 }))).toBe(
      'invalid_argument'
    )
  })

  it('opens only matching URLs, passing on the normalized form', async () => {
    expect(
      (await broker.call('full', 'openExternal', { url: 'https://APP.example.com/s/1' })).ok
    ).toBe(true)
    expect(
      errorCode(await broker.call('full', 'openExternal', { url: 'https://example.com/' }))
    ).toBe('permission_denied')
    expect(errorCode(await broker.call('full', 'openExternal', { url: 'not a url' }))).toBe(
      'invalid_argument'
    )
    expect(opened).toEqual(['https://app.example.com/s/1'])
  })

  it('refuses fetches to unlisted hosts before any request', async () => {
    const r = await broker.call('full', 'fetch', { url: 'https://evil.example.net/' })
    expect(r).toMatchObject({ ok: false, error: { code: 'permission_denied' } })
  })
})
