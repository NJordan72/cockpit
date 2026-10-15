import { describe, expect, it } from 'vitest'
import {
  DEFAULT_KEYBINDINGS,
  defaultConfig,
  migrateConfig,
  normalizeSizes,
  pushRecentDir
} from './config'

describe('migrateConfig', () => {
  it('returns defaults for missing or garbage input', () => {
    expect(migrateConfig(undefined)).toEqual(defaultConfig())
    expect(migrateConfig('nope')).toEqual(defaultConfig())
    expect(migrateConfig([])).toEqual(defaultConfig())
  })

  it('round-trips a default config unchanged', () => {
    const c = defaultConfig()
    expect(migrateConfig(JSON.parse(JSON.stringify(c)))).toEqual(c)
  })

  it('keeps valid user presets and adds a shell preset if missing', () => {
    const c = migrateConfig({
      presets: [{ id: 'claude', name: 'Claude', command: 'claude --verbose', cwd: '~/dev/x' }]
    })
    expect(c.presets.map((p) => p.id)).toEqual(['shell', 'claude'])
    expect(c.presets[1]).toEqual({
      id: 'claude',
      name: 'Claude',
      command: 'claude --verbose',
      cwd: '~/dev/x'
    })
  })

  it('drops malformed and duplicate presets', () => {
    const c = migrateConfig({
      presets: [{ id: 'shell', name: 'Sh' }, { id: 'shell', name: 'dup' }, { name: 'no id' }, 42]
    })
    expect(c.presets).toEqual([{ id: 'shell', name: 'Sh', cwd: '~' }])
  })

  it('overrides individual keybindings and ignores unknown actions', () => {
    const c = migrateConfig({ keybindings: { newTab: 'Cmd+N', bogus: 'Cmd+B', splitRight: 7 } })
    expect(c.keybindings.newTab).toBe('Cmd+N')
    expect(c.keybindings.splitRight).toBe(DEFAULT_KEYBINDINGS.splitRight)
    expect(c.keybindings).not.toHaveProperty('bogus')
  })

  it('clamps terminal settings', () => {
    expect(migrateConfig({ terminal: { fontSize: 2 } }).terminal.fontSize).toBe(13)
    expect(migrateConfig({ terminal: { fontSize: 15 } }).terminal.fontSize).toBe(15)
  })

  it('repairs a layout: bad nodes dropped, single-child splits collapsed, missing presets become shell', () => {
    const c = migrateConfig({
      layout: {
        activeTabId: 'gone',
        tabs: [
          {
            id: 't1',
            activePaneId: 'nope',
            root: {
              type: 'split',
              id: 's1',
              direction: 'row',
              sizes: [3, 1, 1],
              children: [
                { type: 'pane', id: 'p1', presetId: 'claude', cwd: '~/dev/a' },
                { type: 'pane', id: 'p2' },
                { type: 'pane', id: 'p3', presetId: 'deleted-preset', cwd: '~/dev/b' }
              ]
            }
          },
          { id: 't2', root: { type: 'split', id: 's2', direction: 'row', children: [] } },
          {
            id: 't3',
            root: {
              type: 'split',
              id: 's3',
              direction: 'column',
              children: [{ type: 'pane', id: 'p4', presetId: 'shell' }]
            }
          }
        ]
      }
    })
    expect(c.layout.activeTabId).toBe('t1')
    expect(c.layout.tabs.map((t) => t.id)).toEqual(['t1', 't3'])
    const t1 = c.layout.tabs[0]
    expect(t1?.activePaneId).toBe('p1')
    expect(t1?.root).toEqual({
      type: 'split',
      id: 's1',
      direction: 'row',
      sizes: [0.5, 0.5],
      children: [
        { type: 'pane', id: 'p1', presetId: 'claude', cwd: '~/dev/a' },
        { type: 'pane', id: 'p3', presetId: 'shell', cwd: '~/dev/b' }
      ]
    })
    expect(c.layout.tabs[1]?.root).toEqual({ type: 'pane', id: 'p4', presetId: 'shell', cwd: '~' })
  })

  it('rejects duplicate ids in a layout', () => {
    const c = migrateConfig({
      layout: {
        tabs: [
          {
            id: 't1',
            root: {
              type: 'split',
              id: 's1',
              direction: 'row',
              children: [
                { type: 'pane', id: 'p1', presetId: 'shell' },
                { type: 'pane', id: 'p1', presetId: 'shell' }
              ]
            }
          }
        ]
      }
    })
    expect(c.layout.tabs[0]?.root).toEqual({ type: 'pane', id: 'p1', presetId: 'shell', cwd: '~' })
  })
})

describe('normalizeSizes', () => {
  it('scales to sum to 1', () => {
    expect(normalizeSizes([1, 3], 2)).toEqual([0.25, 0.75])
  })
  it('falls back to equal sizes for bad input', () => {
    expect(normalizeSizes([1], 2)).toEqual([0.5, 0.5])
    expect(normalizeSizes([1, -1], 2)).toEqual([0.5, 0.5])
    expect(normalizeSizes('x', 3)).toEqual([1 / 3, 1 / 3, 1 / 3])
  })
})

describe('pushRecentDir', () => {
  it('moves an existing dir to the front and caps the list', () => {
    expect(pushRecentDir(['a', 'b', 'c'], 'b')).toEqual(['b', 'a', 'c'])
    const many = Array.from({ length: 30 }, (_, i) => `d${i}`)
    expect(pushRecentDir(many, 'new')).toHaveLength(20)
  })
})
