import { describe, expect, it } from 'bun:test'
import type { Layout, PaneNode } from '@shared/config'
import { allPanes, findPane } from './model'
import { layoutReducer, type LayoutAction } from './reducer'

const pane = (id: string): PaneNode => ({ type: 'pane', id, presetId: 'shell', cwd: '~' })
const run = (actions: LayoutAction[], start: Layout = { tabs: [], activeTabId: null }): Layout =>
  actions.reduce(layoutReducer, start)

describe('layoutReducer', () => {
  it('opens tabs after the active one and selects them', () => {
    const l = run([
      { type: 'newTab', pane: pane('a') },
      { type: 'newTab', pane: pane('b') }
    ])
    expect(l.tabs).toHaveLength(2)
    expect(l.activeTabId).toBe(l.tabs[1]?.id ?? null)
  })

  it('opens a background tab after the active one and leaves the active tab selected', () => {
    const l = run([
      { type: 'newTab', pane: pane('a') },
      { type: 'newTab', pane: pane('b') },
      { type: 'newTab', pane: pane('c'), background: true }
    ])
    expect(l.tabs.map((t) => t.activePaneId)).toEqual(['a', 'b', 'c'])
    expect(l.activeTabId).toBe(l.tabs[1]?.id ?? null)
  })

  it('splits and focuses the new pane', () => {
    const l = run([
      { type: 'newTab', pane: pane('a') },
      { type: 'split', paneId: 'a', direction: 'row', pane: pane('b') }
    ])
    expect(l.tabs[0]?.activePaneId).toBe('b')
    expect(allPanes(l.tabs[0]?.root ?? pane('x')).map((p) => p.id)).toEqual(['a', 'b'])
  })

  it('closing the focused pane focuses its neighbour', () => {
    const l = run([
      { type: 'newTab', pane: pane('a') },
      { type: 'split', paneId: 'a', direction: 'row', pane: pane('b') },
      { type: 'split', paneId: 'b', direction: 'row', pane: pane('c') },
      { type: 'focusPane', paneId: 'c' },
      { type: 'closePane', paneId: 'c' }
    ])
    expect(l.tabs[0]?.activePaneId).toBe('b')
  })

  it('closing the last pane closes the tab and selects the next one', () => {
    const l = run([
      { type: 'newTab', pane: pane('a') },
      { type: 'newTab', pane: pane('b') },
      { type: 'newTab', pane: pane('c') },
      { type: 'selectTabIndex', index: 1 },
      { type: 'closePane', paneId: 'b' }
    ])
    expect(l.tabs).toHaveLength(2)
    expect(l.tabs.find((t) => t.id === l.activeTabId)?.activePaneId).toBe('c')
  })

  it('clearing a pane gives it a new id in the same place, still focused', () => {
    const l = run([
      { type: 'newTab', pane: pane('a') },
      { type: 'split', paneId: 'a', direction: 'row', pane: pane('b') },
      { type: 'clearPane', paneId: 'b' }
    ])
    const ids = allPanes(l.tabs[0]?.root ?? pane('x')).map((p) => p.id)
    expect(ids).toHaveLength(2)
    expect(ids[0]).toBe('a')
    expect(ids[1]).not.toBe('b')
    expect(l.tabs[0]?.activePaneId).toBe(ids[1])
  })

  it('clearing to resume marks the new pane until it has started', () => {
    let l = run([
      { type: 'newTab', pane: pane('a') },
      { type: 'clearPane', paneId: 'a', resume: true }
    ])
    const id = l.tabs[0]?.activePaneId ?? ''
    expect(findPane(l.tabs[0]?.root ?? pane('x'), id)?.resume).toBe(true)
    l = layoutReducer(l, { type: 'setCwd', paneId: id, cwd: pane('x').cwd })
    expect(findPane(l.tabs[0]?.root ?? pane('x'), id)?.resume).toBeUndefined()
  })

  it('closing everything leaves no active tab', () => {
    const l = run([
      { type: 'newTab', pane: pane('a') },
      { type: 'closePane', paneId: 'a' }
    ])
    expect(l).toEqual({ tabs: [], activeTabId: null })
  })

  it('cycles tabs with wraparound', () => {
    const base = run([
      { type: 'newTab', pane: pane('a') },
      { type: 'newTab', pane: pane('b') }
    ])
    const next = layoutReducer(base, { type: 'cycleTab', delta: 1 })
    expect(next.activeTabId).toBe(base.tabs[0]?.id ?? null)
    expect(layoutReducer(next, { type: 'cycleTab', delta: -1 }).activeTabId).toBe(
      base.tabs[1]?.id ?? null
    )
  })

  it('moves focus by direction', () => {
    const l = run([
      { type: 'newTab', pane: pane('a') },
      { type: 'split', paneId: 'a', direction: 'row', pane: pane('b') },
      { type: 'focusDirection', direction: 'left' }
    ])
    expect(l.tabs[0]?.activePaneId).toBe('a')
  })

  it('records a pane cwd without touching other state', () => {
    const before = run([{ type: 'newTab', pane: pane('a') }])
    const after = layoutReducer(before, { type: 'setCwd', paneId: 'a', cwd: '~/dev/x' })
    expect(after.tabs[0]?.root).toEqual({ ...pane('a'), cwd: '~/dev/x' })
    expect(layoutReducer(after, { type: 'setCwd', paneId: 'a', cwd: '~/dev/x' })).toBe(after)
  })

  it('records where a web pane went, and leaves terminals alone', () => {
    const web: PaneNode = { ...pane('w'), url: 'https://a.dev/' }
    const before = run([{ type: 'newTab', pane: web }])
    const after = layoutReducer(before, {
      type: 'setPage',
      paneId: 'w',
      url: 'https://a.dev/b',
      title: 'B'
    })
    expect(after.tabs[0]?.root).toEqual({ ...web, url: 'https://a.dev/b', title: 'B' })
    expect(
      layoutReducer(after, { type: 'setPage', paneId: 'w', url: 'https://a.dev/b', title: 'B' })
    ).toBe(after)
    const term = run([{ type: 'newTab', pane: pane('t') }])
    expect(layoutReducer(term, { type: 'setPage', paneId: 't', url: 'https://x.dev/' })).toBe(term)
  })

  it("keeps a pull request pane's title, and ignores other panes", () => {
    const prPane: PaneNode = { ...pane('p'), pr: { repo: 'o/r', number: 7 } }
    const l = run([
      { type: 'newTab', pane: prPane },
      { type: 'newTab', pane: pane('t') }
    ])
    const after = layoutReducer(l, { type: 'setPrTitle', paneId: 'p', title: 'Fix login' })
    expect(after.tabs[0]?.root).toEqual({ ...prPane, title: 'Fix login' })
    expect(layoutReducer(after, { type: 'setPrTitle', paneId: 'p', title: 'Fix login' })).toBe(
      after
    )
    expect(layoutReducer(l, { type: 'setPrTitle', paneId: 't', title: 'x' })).toBe(l)
  })

  it('moves a tab to a new position and keeps the selection', () => {
    const l = run([
      { type: 'newTab', pane: pane('a') },
      { type: 'newTab', pane: pane('b') },
      { type: 'newTab', pane: pane('c') }
    ])
    const order = (x: Layout): string[] => x.tabs.map((t) => t.activePaneId)
    const [a, , c] = l.tabs
    if (!a || !c) throw new Error('expected three tabs')
    expect(order(layoutReducer(l, { type: 'moveTab', tabId: a.id, index: 2 }))).toEqual([
      'b',
      'c',
      'a'
    ])
    const moved = layoutReducer(l, { type: 'moveTab', tabId: c.id, index: 0 })
    expect(order(moved)).toEqual(['c', 'a', 'b'])
    expect(moved.activeTabId).toBe(l.activeTabId)
    expect(order(layoutReducer(l, { type: 'moveTab', tabId: a.id, index: 99 }))).toEqual([
      'b',
      'c',
      'a'
    ])
    expect(layoutReducer(l, { type: 'moveTab', tabId: a.id, index: 0 })).toBe(l)
    expect(layoutReducer(l, { type: 'moveTab', tabId: 'nope', index: 0 })).toBe(l)
  })

  describe('tab names, colors, and pins', () => {
    const three = (): Layout =>
      run([
        { type: 'newTab', pane: pane('a') },
        { type: 'newTab', pane: pane('b') },
        { type: 'newTab', pane: pane('c') }
      ])
    const order = (x: Layout): string[] => x.tabs.map((t) => t.activePaneId)
    const idOf = (x: Layout, paneId: string): string => {
      const t = x.tabs.find((t) => t.activePaneId === paneId)
      if (!t) throw new Error(`no tab for ${paneId}`)
      return t.id
    }

    it('names a tab, trimmed, and an empty name goes back to the automatic one', () => {
      const l = three()
      const id = idOf(l, 'a')
      const named = layoutReducer(l, { type: 'renameTab', tabId: id, name: '  PR babysitter ' })
      expect(named.tabs[0]?.name).toBe('PR babysitter')
      const cleared = layoutReducer(named, { type: 'renameTab', tabId: id, name: '   ' })
      expect(cleared.tabs[0]).not.toHaveProperty('name')
      const long = layoutReducer(l, { type: 'renameTab', tabId: id, name: 'x'.repeat(500) })
      expect(long.tabs[0]?.name).toHaveLength(80)
    })

    it('sets and clears a color', () => {
      const l = three()
      const id = idOf(l, 'b')
      const red = layoutReducer(l, { type: 'colorTab', tabId: id, color: 'red' })
      expect(red.tabs[1]?.color).toBe('red')
      expect(
        layoutReducer(red, { type: 'colorTab', tabId: id, color: null }).tabs[1]
      ).not.toHaveProperty('color')
    })

    it('pins a tab to the right end and unpins it next to the pinned ones', () => {
      let l = three()
      l = layoutReducer(l, { type: 'pinTab', tabId: idOf(l, 'a'), pinned: true })
      expect(order(l)).toEqual(['b', 'c', 'a'])
      l = layoutReducer(l, { type: 'pinTab', tabId: idOf(l, 'b'), pinned: true })
      expect(order(l)).toEqual(['c', 'a', 'b'])
      expect(layoutReducer(l, { type: 'pinTab', tabId: idOf(l, 'b'), pinned: true })).toBe(l)
      l = layoutReducer(l, { type: 'pinTab', tabId: idOf(l, 'b'), pinned: false })
      expect(order(l)).toEqual(['c', 'b', 'a'])
      expect(l.tabs[1]).not.toHaveProperty('pinned')
    })

    it('opens a new tab before the pinned ones when a pinned tab is active', () => {
      let l = three()
      l = layoutReducer(l, { type: 'pinTab', tabId: idOf(l, 'a'), pinned: true })
      l = layoutReducer(l, { type: 'selectTab', tabId: idOf(l, 'a') })
      l = layoutReducer(l, { type: 'newTab', pane: pane('d') })
      expect(order(l)).toEqual(['b', 'c', 'd', 'a'])
      expect(l.activeTabId).toBe(idOf(l, 'd'))
    })

    it('keeps a moved tab in its own group', () => {
      let l = three()
      l = layoutReducer(l, { type: 'pinTab', tabId: idOf(l, 'c'), pinned: true })
      expect(order(layoutReducer(l, { type: 'moveTab', tabId: idOf(l, 'a'), index: 2 }))).toEqual([
        'b',
        'a',
        'c'
      ])
      expect(layoutReducer(l, { type: 'moveTab', tabId: idOf(l, 'c'), index: 0 })).toBe(l)
    })
  })

  describe('with tabs the bar leaves out', () => {
    // b is hidden; the bar shows a, c, d.
    const four = (): Layout =>
      run([
        { type: 'newTab', pane: pane('a') },
        { type: 'newTab', pane: pane('b') },
        { type: 'newTab', pane: pane('c') },
        { type: 'newTab', pane: pane('d') }
      ])
    const ids = (l: Layout, ...panes: string[]): string[] =>
      panes.map((p) => l.tabs.find((t) => t.activePaneId === p)?.id ?? '')
    const activePane = (l: Layout): string | undefined =>
      l.tabs.find((t) => t.id === l.activeTabId)?.activePaneId

    it('cycles and numbers through the shown tabs only', () => {
      let l = four()
      const shown = ids(l, 'a', 'c', 'd')
      l = layoutReducer(l, { type: 'selectTab', tabId: shown[0] ?? '' })
      l = layoutReducer(l, { type: 'cycleTab', delta: 1, shown })
      expect(activePane(l)).toBe('c')
      l = layoutReducer(l, { type: 'cycleTab', delta: -1, shown })
      l = layoutReducer(l, { type: 'cycleTab', delta: -1, shown })
      expect(activePane(l)).toBe('d')
      l = layoutReducer(l, { type: 'selectTabIndex', index: 1, shown })
      expect(activePane(l)).toBe('c')
      expect(layoutReducer(l, { type: 'selectTabIndex', index: 3, shown })).toBe(l)
    })

    it('closing the active tab selects the next shown one', () => {
      let l = four()
      const shown = ids(l, 'a', 'c', 'd')
      l = layoutReducer(l, { type: 'selectTab', tabId: shown[0] ?? '' })
      const closed = layoutReducer(l, { type: 'closeTab', tabId: shown[0] ?? '', shown })
      expect(activePane(closed)).toBe('c')
      // Without the list, the tab that took its place is chosen, hidden or not.
      expect(activePane(layoutReducer(l, { type: 'closeTab', tabId: shown[0] ?? '' }))).toBe('b')
      // At the end, the shown tab before it.
      l = layoutReducer(l, { type: 'selectTab', tabId: shown[2] ?? '' })
      const last = layoutReducer(l, { type: 'closePane', paneId: 'd', shown: ids(l, 'a', 'd') })
      expect(activePane(last)).toBe('a')
    })
  })
})
