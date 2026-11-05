import { describe, expect, it } from 'vitest'
import {
  ACTIVITY_MIN_HEIGHT,
  activeLayout,
  DEFAULT_KEYBINDINGS,
  DEFAULT_KIDS,
  defaultAppearance,
  defaultConfig,
  defaultSidebar,
  defaultWindow,
  migrateConfig,
  normalizeSizes,
  pushRecentDir,
  pushRecentPage,
  readSidebar,
  SIDEBAR_MAX_WIDTH,
  terminalFontStack,
  type CockpitConfig,
  type RecentDir,
  type WindowState
} from './config'
import { findNode } from './frame'

/** The main window, which a config always has. */
function win(c: CockpitConfig): WindowState {
  const w = c.windows[0]
  if (!w) throw new Error('no window')
  return w
}

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
    expect(migrateConfig({}).terminal.scrollback).toBe(5000)
    expect(migrateConfig({ terminal: { scrollback: 20_000 } }).terminal.scrollback).toBe(20_000)
    expect(migrateConfig({ terminal: { scrollback: -1 } }).terminal.scrollback).toBe(5000)
    expect(migrateConfig({ terminal: { scrollback: 1.5 } }).terminal.scrollback).toBe(5000)
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
    expect(win(c).activeTabId).toBe('t1')
    expect(win(c).tabs.map((t) => t.id)).toEqual(['t1', 't3'])
    const t1 = win(c).tabs[0]
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
    expect(win(c).tabs[1]?.root).toEqual({ type: 'pane', id: 'p4', presetId: 'shell', cwd: '~' })
  })

  it("keeps tabs' names, colors, and pins, with pinned tabs last", () => {
    const p = (id: string): object => ({ type: 'pane', id, presetId: 'shell', cwd: '~' })
    const c = migrateConfig({
      windows: [
        {
          id: 'main',
          hiddenDirs: ['~/dev/a', 7, '', '~/dev/a', '~/dev/b'],
          activeTabId: 't1',
          tabs: [
            { id: 't1', root: p('p1'), name: '  Deploys ', color: 'green', pinned: true },
            { id: 't2', root: p('p2'), name: 42, color: 'chartreuse', pinned: 'yes' },
            { id: 't3', root: p('p3'), name: '   ', color: 'magenta' }
          ]
        }
      ]
    })
    expect(win(c).tabs.map((t) => t.id)).toEqual(['t2', 't3', 't1'])
    expect(win(c).tabs[2]).toMatchObject({ name: 'Deploys', color: 'green', pinned: true })
    expect(win(c).tabs[0]).toEqual({ id: 't2', root: p('p2'), activePaneId: 'p2' })
    expect(win(c).tabs[1]).toEqual({
      id: 't3',
      root: p('p3'),
      activePaneId: 'p3',
      color: 'magenta'
    })
    expect(win(c).hiddenDirs).toEqual(['~/dev/a', '~/dev/b'])
    expect(defaultWindow().hiddenDirs).toEqual([])
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
    expect(win(c).tabs[0]?.root).toEqual({ type: 'pane', id: 'p1', presetId: 'shell', cwd: '~' })
  })

  it('keeps web panes with a web URL and drops other URLs', () => {
    const tab = (id: string, url: unknown): unknown => ({
      id,
      root: { type: 'pane', id: `p-${id}`, presetId: 'shell', url, title: 'Deck' }
    })
    const c = migrateConfig({
      layout: { tabs: [tab('a', 'file:///tmp/deck/index.html'), tab('b', 'javascript:alert(1)')] }
    })
    expect(win(c).tabs.map((t) => t.root)).toEqual([
      {
        type: 'pane',
        id: 'p-a',
        presetId: 'shell',
        cwd: '~',
        url: 'file:///tmp/deck/index.html',
        title: 'Deck'
      },
      { type: 'pane', id: 'p-b', presetId: 'shell', cwd: '~' }
    ])
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
  const dir = (path: string, at = 1): RecentDir => ({ path, presetId: 'shell', at })
  it('moves an existing dir to the front and caps the list', () => {
    const pushed = pushRecentDir([dir('a'), dir('b'), dir('c')], dir('b', 9))
    expect(pushed).toEqual([dir('b', 9), dir('a'), dir('c')])
    const many = Array.from({ length: 30 }, (_, i) => dir(`d${i}`))
    expect(pushRecentDir(many, dir('new'))).toHaveLength(20)
  })
})

describe('pushRecentPage', () => {
  it('moves a page to the front, keeping its title when it comes back without one', () => {
    const pages = [
      { url: 'https://a.test/', title: 'A', at: 1 },
      { url: 'https://b.test/', at: 1 }
    ]
    expect(pushRecentPage(pages, { url: 'https://b.test/', at: 9 })[0]).toEqual({
      url: 'https://b.test/',
      at: 9
    })
    expect(pushRecentPage(pages, { url: 'https://a.test/', at: 9 })).toEqual([
      { url: 'https://a.test/', title: 'A', at: 9 },
      { url: 'https://b.test/', at: 1 }
    ])
  })
})

describe('migrateConfig: recent dirs and launcher', () => {
  it('upgrades version 1 paths to entries with no time', () => {
    const c = migrateConfig({ version: 1, recentDirs: ['~/dev/a', '~/dev/b', '~/dev/a', 3] })
    expect(c.recentDirs).toEqual([
      { path: '~/dev/a', at: 0 },
      { path: '~/dev/b', at: 0 }
    ])
  })

  it('keeps valid entries and repairs bad fields', () => {
    const c = migrateConfig({
      recentDirs: [
        { path: '~/dev/a', presetId: 'codex', at: 5 },
        { path: '~/dev/b', presetId: '', at: -1 },
        { presetId: 'claude', at: 2 }
      ]
    })
    expect(c.recentDirs).toEqual([
      { path: '~/dev/a', presetId: 'codex', at: 5 },
      { path: '~/dev/b', at: 0 }
    ])
  })

  it('keeps recent pages that are web URLs, once each', () => {
    const c = migrateConfig({
      recentPages: [
        { url: 'https://a.test/', title: 'A', at: 5 },
        { url: 'javascript:alert(1)', at: 4 },
        { url: 'https://a.test/', at: 3 },
        { url: 'file:///tmp/x.html', title: '', at: -1 }
      ]
    })
    expect(c.recentPages).toEqual([
      { url: 'https://a.test/', title: 'A', at: 5 },
      { url: 'file:///tmp/x.html', at: 0 }
    ])
    expect(migrateConfig({}).recentPages).toEqual([])
  })

  it('remembers the launcher agent, defaulting to Claude Code', () => {
    expect(migrateConfig({}).launcher).toEqual({ presetId: 'claude' })
    expect(migrateConfig({ launcher: { presetId: 'codex' } }).launcher).toEqual({
      presetId: 'codex'
    })
    expect(migrateConfig({ launcher: { presetId: 7 } }).launcher).toEqual({ presetId: 'claude' })
  })

  it('keeps an editor command, defaulting to none', () => {
    expect(migrateConfig({}).editor).toBeNull()
    expect(migrateConfig({ editor: ' code -g ' }).editor).toBe('code -g')
    expect(migrateConfig({ editor: '  ' }).editor).toBeNull()
    expect(migrateConfig({ editor: ['zed'] }).editor).toBeNull()
  })
})

describe('migrateConfig: appearance', () => {
  it('adds it with defaults to a config from before widgets', () => {
    const c = migrateConfig({ version: 1, presets: [{ id: 'shell', name: 'Shell' }] })
    expect(c.appearance).toEqual(defaultAppearance())
    expect(c.keybindings.toggleSidebar).toBe('Cmd+B')
  })

  it("turns version 2's sidebar into the classic layout", () => {
    const c = migrateConfig({
      version: 2,
      sidebar: {
        visible: false,
        width: 400,
        mode: 'tabs',
        activeWidget: 'shortcut-stories',
        sessionsCollapsed: true,
        activity: { collapsed: true, height: 250, tab: 'git' },
        widgets: [
          { id: 'hello', collapsed: true, size: 2 },
          { id: 'shortcut-stories', collapsed: false, size: 1 }
        ]
      }
    })
    expect(c).not.toHaveProperty('sidebar')
    expect(win(c).layout).toBe('classic')
    expect(win(c).panelsHidden).toBe(true)
    const tree = activeLayout(c.appearance, win(c).layout)
    const sidebar = findNode(tree, 'sidebar')
    expect(sidebar?.size).toBe(400)
    expect(findNode(tree, 'sessions')?.collapsed).toBe(true)
    expect(findNode(tree, 'activity')).toMatchObject({ size: 250, tab: 'git', collapsed: true })
    expect(findNode(tree, 'widgets')).toMatchObject({
      type: 'tabs',
      widgets: 'rest',
      active: 'widget:shortcut-stories'
    })
    // A tab can't be folded, so the fold from stack mode is dropped.
    expect(findNode(tree, 'widget:hello')).toMatchObject({ flex: 2 })
    expect(findNode(tree, 'widget:hello')?.collapsed).toBeUndefined()
  })

  it('keeps a saved classic layout over a leftover sidebar', () => {
    const saved = { type: 'panel', panel: 'workspace' }
    const c = migrateConfig({
      sidebar: { width: 500 },
      appearance: { layouts: { classic: saved }, panelsHidden: false }
    })
    expect(findNode(activeLayout(c.appearance, win(c).layout), 'sidebar')).toBeNull()
    expect(win(c).panelsHidden).toBe(false)
  })

  it('falls back to the classic layout for one that does not exist', () => {
    expect(win(migrateConfig({ appearance: { layout: 'nope' } })).layout).toBe('classic')
    expect(win(migrateConfig({ appearance: { layout: 'cockpit' } })).layout).toBe('cockpit')
    const mine = migrateConfig({
      appearance: { layout: 'mine', layouts: { mine: { type: 'panel', panel: 'workspace' } } }
    })
    expect(win(mine).layout).toBe('mine')
  })

  it('drops layouts whose names could not be config keys', () => {
    const c = migrateConfig({
      appearance: { layouts: { Mine: {}, '../x': {}, ok: {} } }
    })
    expect(Object.keys(c.appearance.layouts)).toEqual(['ok'])
  })
})

describe('readSidebar (version 2)', () => {
  it('keeps valid placement and repairs the rest', () => {
    const sb = readSidebar({
      visible: false,
      width: 99999,
      mode: 'carousel',
      activeWidget: 'hello',
      sessionsCollapsed: 'yes',
      activity: { collapsed: true, height: 5, tab: 'diary' },
      widgets: [
        { id: 'hello', collapsed: true, size: 2 },
        { id: 'hello', collapsed: false },
        { id: 'shortcut-stories', size: -1 },
        { size: 1 },
        'junk'
      ]
    })
    expect(sb).toEqual({
      visible: false,
      width: SIDEBAR_MAX_WIDTH,
      mode: 'stack',
      activeWidget: 'hello',
      sessionsCollapsed: false,
      activity: { collapsed: true, height: ACTIVITY_MIN_HEIGHT, tab: 'log' },
      widgets: [
        { id: 'hello', collapsed: true, size: 2 },
        { id: 'shortcut-stories', collapsed: false, size: 1 }
      ]
    })
  })

  it('keeps the Activity panel settings', () => {
    const activity = { collapsed: false, height: 410, tab: 'git' }
    expect(readSidebar({ activity }).activity).toEqual(activity)
    expect(readSidebar({ activity: 'big' }).activity).toEqual(defaultSidebar().activity)
  })
})

describe('migrateConfig: theme', () => {
  it('keeps known theme colors and drops values that could break out of CSS', () => {
    const c = migrateConfig({
      theme: {
        accent: '#ff00ff',
        bg: 'red; } body { display: none',
        fg: '</style><script>alert(1)</script>',
        border: 42,
        sparkle: '#fff'
      }
    })
    expect(c.appearance.overrides).toEqual({ accent: '#ff00ff' })
  })

  it("moves version 2's theme into appearance.overrides", () => {
    const c = migrateConfig({ version: 2, theme: { accent: '#ff00ff' } })
    expect(c.appearance.overrides).toEqual({ accent: '#ff00ff' })
    expect(c.appearance.theme).toBe('midnight')
    expect(c).not.toHaveProperty('theme')
  })

  it('prefers appearance over a leftover top-level theme', () => {
    const c = migrateConfig({
      theme: { accent: '#ff00ff' },
      appearance: { theme: 'amber', overrides: { fg: '#fff' } }
    })
    expect(c.appearance.theme).toBe('amber')
    expect(c.appearance.overrides).toEqual({ fg: '#fff' })
  })

  it('falls back to the default theme for a name that could not be a folder', () => {
    for (const theme of ['', 'Amber', '../x', 'a/b', 7]) {
      expect(migrateConfig({ appearance: { theme } }).appearance.theme).toBe('midnight')
    }
  })
})

describe('migrateConfig: kids mode', () => {
  it('adds it with defaults to an older config', () => {
    const c = migrateConfig({ version: 2 })
    expect(c.kids).toEqual(DEFAULT_KIDS)
    expect(c.keybindings.kidsMode).toBe('Cmd+Shift+K')
  })

  it('keeps valid settings and repairs the rest', () => {
    expect(
      migrateConfig({
        kids: { name: ' Ava ', exitWord: 'LetMeOut', volume: 3, sound: 'notes', speak: false }
      }).kids
    ).toEqual({ name: 'Ava', exitWord: 'letmeout', volume: 1, sound: 'notes', speak: false })
    expect(migrateConfig({ kids: { volume: -1, sound: 'kazoo', speak: 'yes' } }).kids).toEqual({
      ...DEFAULT_KIDS,
      volume: 0
    })
  })

  it('refuses an exit word a child could type by chance', () => {
    for (const exitWord of ['bye', 'by e', 'cmd+q', '', 7, 'a'.repeat(33)]) {
      expect(migrateConfig({ kids: { exitWord } }).kids.exitWord).toBe(DEFAULT_KIDS.exitWord)
    }
  })
})

describe('terminalFontStack', () => {
  it('falls back to the Nerd Font symbols', () => {
    expect(terminalFontStack('Menlo, monospace')).toBe('Menlo, monospace, "Symbols Nerd Font Mono"')
  })
  it('leaves a stack that already names them alone', () => {
    const stack = '"Symbols Nerd Font", Menlo'
    expect(terminalFontStack(stack)).toBe(stack)
  })
})

describe('migrateConfig: windows', () => {
  const pane = (id: string): unknown => ({ type: 'pane', id, presetId: 'shell', cwd: '~' })
  const tab = (id: string, paneId: string): unknown => ({
    id,
    root: pane(paneId),
    activePaneId: paneId
  })

  it("makes version 3's tabs, layout, and Cmd+B state the main window", () => {
    const c = migrateConfig({
      version: 3,
      appearance: { layout: 'cockpit', panelsHidden: true },
      layout: { tabs: [tab('t1', 'p1')], activeTabId: 't1' }
    })
    expect(c.windows).toEqual([
      {
        id: 'main',
        layout: 'cockpit',
        panelsHidden: true,
        hiddenDirs: [],
        tabs: [{ id: 't1', root: pane('p1'), activePaneId: 'p1' }],
        activeTabId: 't1'
      }
    ])
    expect(c).not.toHaveProperty('layout')
    expect(c.appearance).not.toHaveProperty('layout')
  })

  it('keeps up to three windows with their place, and repairs the rest', () => {
    const c = migrateConfig({
      windows: [
        {
          id: 'main',
          layout: 'panels',
          bounds: { x: -1920, y: 0, width: 1920, height: 1080 },
          display: { id: 7, label: 'DELL' }
        },
        { id: 'main', layout: 'classic' },
        { id: 'Bad Id' },
        { id: 'w2', layout: 'gone', bounds: { x: 0, y: 0, width: 50, height: 50 } },
        { id: 'w3', display: { id: 1.5 } },
        { id: 'w4' }
      ]
    })
    expect(c.windows.map((w) => [w.id, w.layout])).toEqual([
      ['main', 'panels'],
      ['w2', 'classic'],
      ['w3', 'classic']
    ])
    expect(win(c)).toMatchObject({
      bounds: { x: -1920, y: 0, width: 1920, height: 1080 },
      display: { id: 7, label: 'DELL' }
    })
    expect(c.windows[1]).not.toHaveProperty('bounds')
    expect(c.windows[2]).not.toHaveProperty('display')
  })

  it('gives no two windows the same pane', () => {
    const c = migrateConfig({
      windows: [
        { id: 'main', tabs: [tab('t1', 'p1')] },
        { id: 'w2', tabs: [tab('t2', 'p1'), tab('t3', 'p3')] }
      ]
    })
    expect(c.windows[1]?.tabs.map((t) => t.id)).toEqual(['t3'])
  })

  it('always has a main window', () => {
    expect(migrateConfig({ windows: [] }).windows).toEqual([defaultWindow()])
  })
})
