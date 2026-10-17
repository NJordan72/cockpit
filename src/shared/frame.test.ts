import { describe, expect, it } from 'vitest'
import {
  dragDivider,
  edges,
  findNode,
  isShown,
  panel,
  panels,
  placeWidgets,
  readFrame,
  setActiveTab,
  toggleCollapsed,
  toggleMode,
  visiblePanels,
  type FrameNode,
  type FrameState
} from './frame'
import { BUILT_IN_LAYOUTS, builtInLayout } from './layouts'

const NONE: FrameState = { absent: new Set(), panelsHidden: false }

const kinds = (n: FrameNode): string[] => panels(n).map((p) => p.widget ?? p.panel)

describe('readFrame', () => {
  it('keeps the built-in layouts as they are', () => {
    for (const l of BUILT_IN_LAYOUTS) expect(readFrame(l.tree)).toEqual(l.tree)
  })

  it('reads its own output back the same, generated ids included', () => {
    const raw = {
      type: 'split',
      direction: 'row',
      children: [
        { type: 'panel', panel: 'clock' },
        { type: 'panel', panel: 'workspace' },
        { type: 'panel', panel: 'tabbar' }
      ]
    }
    const once = readFrame(raw)
    expect(readFrame(once)).toEqual(once)
    expect(findNode(once, 'n0-0')?.type).toBe('panel')
  })

  it('makes a usable tree out of nothing', () => {
    for (const raw of [undefined, null, 'x', [], {}, { type: 'split', children: [] }]) {
      const tree = readFrame(raw)
      expect(kinds(tree)).toContain('workspace')
      expect(kinds(tree)).toContain('tabbar')
    }
  })

  it('adds a tab bar above the terminals when the layout has none', () => {
    const tree = readFrame({
      type: 'split',
      direction: 'row',
      children: [
        { type: 'panel', panel: 'workspace', size: 500 },
        { type: 'panel', panel: 'clock' }
      ]
    })
    const terminals = findNode(tree, 'n-terminals')
    expect(terminals).toMatchObject({ type: 'split', direction: 'column', size: 500 })
    expect(terminals?.type === 'split' && kinds(terminals)).toEqual(['tabbar', 'workspace'])
    expect(findNode(tree, 'workspace')?.size).toBeUndefined()
  })

  it('keeps one workspace, one tab bar, and each widget once', () => {
    const tree = readFrame({
      type: 'split',
      direction: 'column',
      children: [
        { type: 'panel', panel: 'tabbar' },
        { type: 'panel', panel: 'workspace' },
        { type: 'panel', panel: 'workspace' },
        { type: 'panel', panel: 'tabbar' },
        { type: 'panel', panel: 'widget', widget: 'hello' },
        { type: 'panel', panel: 'widget', widget: 'hello', id: 'other' }
      ]
    })
    expect(kinds(tree).filter((k) => k === 'workspace')).toHaveLength(1)
    expect(kinds(tree).filter((k) => k === 'tabbar')).toHaveLength(1)
    expect(kinds(tree).filter((k) => k === 'hello')).toHaveLength(1)
  })

  it('drops unknown panels, bad widget ids, and unsafe ids', () => {
    const tree = readFrame({
      type: 'split',
      direction: 'column',
      children: [
        { type: 'panel', panel: 'tabbar' },
        { type: 'panel', panel: 'workspace' },
        { type: 'panel', panel: 'aquarium' },
        { type: 'panel', panel: 'widget', widget: '../x' },
        { type: 'panel', panel: 'clock', id: '"><script>' }
      ]
    })
    expect(kinds(tree)).toEqual(['tabbar', 'workspace', 'clock'])
    expect(panels(tree).map((p) => p.id)).not.toContain('"><script>')
  })

  it('unwraps a plain split of one child, keeping the split’s size', () => {
    const tree = readFrame({
      type: 'split',
      direction: 'row',
      children: [
        { type: 'panel', panel: 'tabbar' },
        { type: 'panel', panel: 'workspace' },
        {
          type: 'split',
          direction: 'column',
          size: 300,
          children: [{ type: 'panel', panel: 'clock', size: 99 }]
        }
      ]
    })
    expect(panels(tree).find((p) => p.panel === 'clock')?.size).toBe(300)
  })

  it('clamps sizes and reads auto, flex, max, and collapsed', () => {
    const tree = readFrame({
      type: 'split',
      direction: 'column',
      children: [
        { type: 'panel', panel: 'tabbar' },
        { type: 'panel', panel: 'workspace' },
        { type: 'panel', panel: 'clock', size: 1e9 },
        { type: 'panel', panel: 'monitor', size: 'auto', max: 0.5, collapsed: true },
        { type: 'panel', panel: 'image', flex: -1, size: 2 }
      ]
    })
    const [, , clock, monitor, image] = panels(tree)
    expect(clock?.size).toBe(4000)
    expect(monitor).toMatchObject({ size: 'auto', max: 0.5, collapsed: true })
    expect(image?.flex).toBeUndefined()
    expect(image?.size).toBe(24)
  })

  it('reads panel options and ignores bad ones', () => {
    const tree = readFrame({
      type: 'split',
      direction: 'column',
      children: [
        { type: 'panel', panel: 'tabbar' },
        { type: 'panel', panel: 'workspace' },
        { type: 'panel', panel: 'activity', tab: 'git' },
        { type: 'panel', panel: 'activity', tab: 'diary' },
        { type: 'panel', panel: 'image', src: 'cat.gif', fit: 'contain', position: 'top left' },
        { type: 'panel', panel: 'image', position: 'url(x)', fit: 'stretch' },
        { type: 'panel', panel: 'clock', seconds: false, hour12: 'yes' }
      ]
    })
    const [, , a1, a2, i1, i2, c] = panels(tree)
    expect(a1?.tab).toBe('git')
    expect(a2?.tab).toBeUndefined()
    expect(i1).toMatchObject({ src: 'cat.gif', fit: 'contain', position: 'top left' })
    expect(i2?.position).toBeUndefined()
    expect(i2?.fit).toBeUndefined()
    expect(c).toMatchObject({ seconds: false })
    expect(c?.hour12).toBeUndefined()
  })

  it('always has a group for new widgets', () => {
    // The group with the most widgets gets it.
    const tree = readFrame({
      type: 'split',
      direction: 'row',
      children: [
        { type: 'panel', panel: 'tabbar' },
        { type: 'panel', panel: 'workspace' },
        {
          type: 'split',
          id: 'right',
          direction: 'column',
          children: [
            { type: 'panel', panel: 'widget', widget: 'a' },
            { type: 'panel', panel: 'widget', widget: 'b' }
          ]
        }
      ]
    })
    expect(findNode(tree, 'right')).toMatchObject({ widgets: 'rest' })
    // With nowhere obvious, a column is added on the right.
    const bare = readFrame({ type: 'panel', panel: 'workspace' })
    expect(findNode(bare, 'n-widgets')).toMatchObject({ widgets: 'rest', title: 'Widgets' })
  })

  it('keeps only the first group marked for new widgets', () => {
    const tree = readFrame({
      type: 'split',
      direction: 'row',
      children: [
        { type: 'panel', panel: 'tabbar' },
        { type: 'panel', panel: 'workspace' },
        { type: 'split', id: 'a', direction: 'column', widgets: 'rest', children: [] },
        { type: 'split', id: 'b', direction: 'column', widgets: 'rest', children: [] }
      ]
    })
    expect(findNode(tree, 'a')?.type !== 'panel' && findNode(tree, 'a')).toMatchObject({
      widgets: 'rest'
    })
    // b had nothing else in it, so it's gone.
    expect(findNode(tree, 'b')).toBeNull()
  })

  it('stops at a depth limit', () => {
    let deep: unknown = { type: 'panel', panel: 'clock' }
    for (let i = 0; i < 20; i++) {
      deep = { type: 'split', direction: 'row', title: 'x', children: [deep] }
    }
    expect(kinds(readFrame(deep))).not.toContain('clock')
  })

  it('points a tabs node at a child that exists', () => {
    const tree = readFrame({
      type: 'tabs',
      id: 't',
      active: 'nope',
      children: [
        { type: 'panel', panel: 'workspace' },
        { type: 'panel', panel: 'tabbar' }
      ]
    })
    expect(findNode(tree, 't')).toMatchObject({ active: 'workspace' })
  })
})

describe('placeWidgets', () => {
  const tree = builtInLayout('classic') ?? readFrame(null)

  it('adds unplaced widgets to the group for them, and returns the same tree when none are', () => {
    const placed = placeWidgets(tree, ['hello', 'shortcut-stories'])
    expect(
      findNode(placed, 'widgets')?.type !== 'panel' && kinds(findNode(placed, 'widgets') ?? tree)
    ).toEqual(['hello', 'shortcut-stories'])
    expect(placeWidgets(placed, ['hello'])).toBe(placed)
  })

  it('selects the first new widget in an empty tabs group', () => {
    const tabs = toggleMode(tree, 'widgets')
    const placed = placeWidgets(tabs, ['hello'])
    expect(findNode(placed, 'widgets')).toMatchObject({ type: 'tabs', active: 'widget:hello' })
  })
})

describe('visibility', () => {
  const tree = placeWidgets(builtInLayout('classic') ?? readFrame(null), ['a', 'b'])

  it('shows everything present and expanded', () => {
    const v = visiblePanels(tree, NONE)
    for (const id of ['tabbar', 'workspace', 'sessions', 'activity', 'widget:a', 'widget:b'])
      expect(v.has(id)).toBe(true)
  })

  it('hides collapsed panels and leaves absent ones out', () => {
    const t = toggleCollapsed(tree, 'widget:a')
    const v = visiblePanels(t, { absent: new Set(['activity']), panelsHidden: false })
    expect(v.has('widget:a')).toBe(false)
    expect(v.has('activity')).toBe(false)
    expect(v.has('widget:b')).toBe(true)
  })

  it('shows only the selected tab', () => {
    const t = setActiveTab(toggleMode(tree, 'widgets'), 'widgets', 'widget:b')
    const v = visiblePanels(t, NONE)
    expect(v.has('widget:a')).toBe(false)
    expect(v.has('widget:b')).toBe(true)
  })

  it('falls back to the first present tab when the selected one is absent', () => {
    const t = setActiveTab(toggleMode(tree, 'widgets'), 'widgets', 'widget:b')
    const v = visiblePanels(t, { absent: new Set(['widget:b']), panelsHidden: false })
    expect(v.has('widget:a')).toBe(true)
  })

  it('keeps only the terminals and the tab bar while panels are hidden', () => {
    const st = { absent: new Set<string>(), panelsHidden: true }
    expect([...visiblePanels(tree, st)].sort()).toEqual(['tabbar', 'workspace'])
    expect(isShown(findNode(tree, 'sidebar') ?? tree, st)).toBe(false)
  })

  it('counts a group with nothing present as not shown', () => {
    const st = { absent: new Set(['widget:a', 'widget:b']), panelsHidden: false }
    expect(isShown(findNode(tree, 'widgets') ?? tree, st)).toBe(false)
  })
})

describe('edges', () => {
  it('finds what touches the top and left of the window', () => {
    const classic = builtInLayout('classic') ?? readFrame(null)
    const e = edges(classic, NONE)
    expect(e.get('tabbar')).toEqual({ top: true, left: true })
    expect(e.get('workspace')).toEqual({ top: false, left: true })
    expect(e.get('sessions')).toEqual({ top: false, left: false })

    const cockpit = builtInLayout('cockpit') ?? readFrame(null)
    const c = edges(cockpit, NONE)
    expect(c.get('image')).toEqual({ top: true, left: true })
    expect(c.get('clock')).toEqual({ top: true, left: false })
    expect(c.get('tabbar')).toEqual({ top: false, left: true })
  })

  it('moves the top edge down when the banner is hidden', () => {
    const cockpit = builtInLayout('cockpit') ?? readFrame(null)
    const c = edges(cockpit, { absent: new Set(), panelsHidden: true })
    expect(c.get('tabbar')).toEqual({ top: true, left: true })
  })

  it('puts a titled group’s children below its title row', () => {
    const tree = placeWidgets(builtInLayout('classic') ?? readFrame(null), ['a'])
    const moved: FrameNode = {
      type: 'split',
      id: 'top',
      direction: 'column',
      children: [findNode(tree, 'widgets') ?? tree, panel('tabbar'), panel('workspace')]
    }
    const e = edges(moved, NONE)
    expect(e.get('widgets')).toEqual({ top: true, left: true })
    expect(e.get('widget:a')).toEqual({ top: false, left: true })
  })
})

describe('dragDivider', () => {
  const split = (children: FrameNode[]): FrameNode => ({
    type: 'split',
    id: 's',
    direction: 'row',
    children
  })

  it('resizes a fixed panel against a flexible one', () => {
    const tree = split([panel('workspace'), panel('clock', { size: 300 })])
    const next = dragDivider(
      tree,
      's',
      ['workspace', 'clock'],
      { px: [700, 300], min: [320, 48] },
      100
    )
    expect(findNode(next, 'clock')?.size).toBe(200)
    expect(findNode(next, 'workspace')?.size).toBeUndefined()
  })

  it('keeps each side at its minimum', () => {
    const tree = split([panel('workspace'), panel('clock', { size: 300 })])
    const next = dragDivider(
      tree,
      's',
      ['workspace', 'clock'],
      { px: [700, 300], min: [320, 48] },
      -900
    )
    expect(findNode(next, 'clock')?.size).toBe(680)
  })

  it('moves the shares of two flexible panels', () => {
    const tree = split([panel('image', { flex: 3 }), panel('clock', { flex: 1 })])
    const next = dragDivider(tree, 's', ['image', 'clock'], { px: [600, 200], min: [48, 48] }, -200)
    expect(findNode(next, 'image')?.flex).toBeCloseTo(2)
    expect(findNode(next, 'clock')?.flex).toBeCloseTo(2)
  })

  it('moves only the fixed side next to a panel that fits its content', () => {
    const tree: FrameNode = {
      type: 'split',
      id: 's',
      direction: 'column',
      children: [panel('image', { size: 180 }), panel('tabbar'), panel('workspace')]
    }
    const start = { px: [180, 34] as [number, number], min: [48, 48] as [number, number] }
    const grown = dragDivider(
      tree,
      's',
      ['image', 'tabbar'],
      { ...start, auto: { side: 1, room: 400 } },
      500
    )
    expect(findNode(grown, 'image')?.size).toBe(400)
    expect(findNode(grown, 'tabbar')?.size).toBeUndefined()
    const shrunk = dragDivider(
      tree,
      's',
      ['image', 'tabbar'],
      { ...start, auto: { side: 1, room: 400 } },
      -500
    )
    expect(findNode(shrunk, 'image')?.size).toBe(48)
  })
})

describe('folding', () => {
  it('only keeps a fold inside a column split', () => {
    const tree = readFrame({
      type: 'split',
      direction: 'row',
      collapsed: true,
      children: [
        { type: 'panel', panel: 'clock', collapsed: true },
        {
          type: 'split',
          direction: 'column',
          children: [
            { type: 'panel', panel: 'tabbar' },
            { type: 'panel', panel: 'workspace' },
            { type: 'panel', panel: 'monitor', collapsed: true }
          ]
        },
        { type: 'tabs', children: [{ type: 'panel', panel: 'image', collapsed: true }] }
      ]
    })
    expect(tree.collapsed).toBeUndefined()
    const byKind = Object.fromEntries(panels(tree).map((p) => [p.panel, p.collapsed]))
    expect(byKind).toMatchObject({ clock: undefined, monitor: true, image: undefined })
  })

  it('unfolds widgets when their group becomes tabs, so none is stuck blank', () => {
    const tree = toggleCollapsed(
      placeWidgets(builtInLayout('classic') ?? readFrame(null), ['a', 'b']),
      'widget:a'
    )
    const tabs = toggleMode(tree, 'widgets')
    expect(findNode(tabs, 'widget:a')?.collapsed).toBeUndefined()
    expect(visiblePanels(tabs, NONE).has('widget:a')).toBe(true)
  })

  it('ignores a fold the panel can not show, when counting what is visible', () => {
    const tree: FrameNode = {
      type: 'split',
      id: 's',
      direction: 'row',
      children: [panel('workspace'), panel('clock', { collapsed: true })]
    }
    expect(visiblePanels(tree, NONE).has('clock')).toBe(true)
  })
})

describe('toggleMode', () => {
  it('switches a group between a column and tabs, and back', () => {
    const tree = placeWidgets(builtInLayout('classic') ?? readFrame(null), ['a', 'b'])
    const tabs = toggleMode(tree, 'widgets')
    expect(findNode(tabs, 'widgets')).toMatchObject({
      type: 'tabs',
      title: 'Widgets',
      widgets: 'rest',
      active: 'widget:a'
    })
    const back = toggleMode(tabs, 'widgets')
    expect(findNode(back, 'widgets')).toMatchObject({ type: 'split', direction: 'column' })
    expect(
      findNode(back, 'widgets')?.type !== 'panel' && kinds(findNode(back, 'widgets') ?? tree)
    ).toEqual(['a', 'b'])
  })
})
