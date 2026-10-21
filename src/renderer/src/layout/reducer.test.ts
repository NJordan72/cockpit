import { describe, expect, it } from 'vitest'
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
    expect(l.activeTabId).toBe(l.tabs[1]?.id)
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
    expect(next.activeTabId).toBe(base.tabs[0]?.id)
    expect(layoutReducer(next, { type: 'cycleTab', delta: -1 }).activeTabId).toBe(base.tabs[1]?.id)
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
})
