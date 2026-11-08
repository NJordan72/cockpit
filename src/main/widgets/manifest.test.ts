import { describe, expect, it } from 'bun:test'
import { parseManifest, sessionsAllow } from './manifest'

const base = {
  id: 'shortcut-stories',
  name: 'Shortcut Stories',
  version: '1.0.0',
  entry: 'index.html',
  sizing: 'fill' as const,
  permissions: {
    network: ['api.app.shortcut.com'],
    openExternal: ['https://app.shortcut.com/*'],
    secrets: ['shortcut-token'],
    storage: true,
    sessions: 'read' as const
  }
}

describe('parseManifest', () => {
  it('reads the example manifest from the build plan', () => {
    const { manifest, network, openExternal } = parseManifest(base, 'shortcut-stories')
    expect(manifest).toEqual({
      ...base,
      description: null,
      permissions: { ...base.permissions }
    })
    expect(network).toHaveLength(1)
    expect(openExternal).toHaveLength(1)
  })

  it('fills in defaults and grants nothing by default', () => {
    const { manifest } = parseManifest({ id: 'x', name: 'X' }, 'x')
    expect(manifest).toMatchObject({ entry: 'index.html', sizing: 'fill', version: '0.0.0' })
    expect(manifest.permissions).toEqual({
      network: [],
      openExternal: [],
      secrets: [],
      storage: false,
      sessions: null
    })
  })

  it('reads each sessions level, and false as none', () => {
    const level = (sessions: unknown): unknown =>
      parseManifest({ id: 'x', name: 'X', permissions: { sessions } }, 'x').manifest.permissions
        .sessions
    expect([level('read'), level('label'), level('prompt'), level(false)]).toEqual([
      'read',
      'label',
      'prompt',
      null
    ])
  })

  it('lets each sessions level do what the ones below it do', () => {
    expect(sessionsAllow('read', 'read')).toBe(true)
    expect(sessionsAllow('read', 'label')).toBe(false)
    expect(sessionsAllow('label', 'read')).toBe(true)
    expect(sessionsAllow('label', 'label')).toBe(true)
    expect(sessionsAllow('label', 'prompt')).toBe(false)
    expect(sessionsAllow('prompt', 'label')).toBe(true)
    expect(sessionsAllow(null, 'read')).toBe(false)
  })

  it('requires the id to match the folder', () => {
    expect(() => parseManifest(base, 'other')).toThrow('folder is named "other"')
  })

  it.each([
    [{ id: 'Bad_Id' }, '"id"'],
    [{ id: '123' }, '"id"'],
    [{ id: '0x10' }, '"id"'],
    [{ id: 'xn--abc' }, '"id"'],
    [{ id: 'a'.repeat(64) }, '"id"'],
    [{ name: '' }, '"name"'],
    [{ entry: '../outside.html' }, '"entry"'],
    [{ entry: '/abs.html' }, '"entry"'],
    [{ entry: 'app.js' }, '"entry"'],
    [{ sizing: 'huge' }, '"sizing"'],
    [{ permissions: { netwrok: [] } }, 'unknown permission "netwrok"'],
    [{ permissions: { network: 'api.example.com' } }, 'list of strings'],
    [{ permissions: { network: ['example.com/path'] } }, 'permissions.network[0]'],
    [{ permissions: { openExternal: ['https://example.com'] } }, 'permissions.openExternal[0]'],
    [{ permissions: { secrets: ['../x'] } }, 'permissions.secrets[0]'],
    [{ permissions: { storage: 'yes' } }, 'permissions.storage'],
    [{ permissions: { sessions: 'write' } }, 'permissions.sessions'],
    [{ permissions: { sessions: true } }, 'permissions.sessions']
  ])('rejects %j', (patch, message) => {
    expect(() =>
      parseManifest({ ...base, ...patch }, (patch as { id?: string }).id ?? base.id)
    ).toThrow(message)
  })

  it('rejects non-objects', () => {
    expect(() => parseManifest([], 'x')).toThrow('JSON object')
    expect(() => parseManifest(null, 'x')).toThrow('JSON object')
  })
})
