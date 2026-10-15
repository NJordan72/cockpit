import { describe, expect, it } from 'vitest'
import type { LayoutNode, PaneNode, SplitNode } from '@shared/config'
import { allPanes, arrange, dragSizes, neighbor, removePane, splitPane } from './model'

const pane = (id: string): PaneNode => ({ type: 'pane', id, presetId: 'shell', cwd: '~' })
const ids = (n: LayoutNode): string[] => allPanes(n).map((p) => p.id)

describe('splitPane', () => {
  it('turns a single pane into a split', () => {
    const root = splitPane(pane('a'), 'a', 'row', pane('b')) as SplitNode
    expect(root.type).toBe('split')
    expect(root.direction).toBe('row')
    expect(ids(root)).toEqual(['a', 'b'])
    expect(root.sizes).toEqual([0.5, 0.5])
  })

  it('adds a sibling when splitting the same direction, halving the target', () => {
    const one = splitPane(pane('a'), 'a', 'row', pane('b'))
    const two = splitPane(one, 'a', 'row', pane('c')) as SplitNode
    expect(ids(two)).toEqual(['a', 'c', 'b'])
    expect(two.sizes).toEqual([0.25, 0.25, 0.5])
  })

  it('nests when splitting the other direction', () => {
    const one = splitPane(pane('a'), 'a', 'row', pane('b'))
    const two = splitPane(one, 'b', 'column', pane('c')) as SplitNode
    expect(two.children[1]?.type).toBe('split')
    expect(ids(two)).toEqual(['a', 'b', 'c'])
  })
})

describe('removePane', () => {
  it('collapses a split left with one child', () => {
    const root = splitPane(pane('a'), 'a', 'row', pane('b'))
    expect(removePane(root, 'b')).toEqual(pane('a'))
  })

  it('renormalizes sizes', () => {
    const root: SplitNode = {
      type: 'split',
      id: 's',
      direction: 'row',
      children: [pane('a'), pane('b'), pane('c')],
      sizes: [0.5, 0.25, 0.25]
    }
    const after = removePane(root, 'a') as SplitNode
    expect(after.sizes).toEqual([0.5, 0.5])
  })

  it('returns null for the last pane', () => {
    expect(removePane(pane('a'), 'a')).toBeNull()
  })
})

describe('arrange and neighbor', () => {
  // a | (b / c)
  const root = splitPane(splitPane(pane('a'), 'a', 'row', pane('b')), 'b', 'column', pane('c'))
  const { panes, dividers } = arrange(root)

  it('lays out rects', () => {
    expect(panes.get('a')).toEqual({ x: 0, y: 0, w: 0.5, h: 1 })
    expect(panes.get('b')).toEqual({ x: 0.5, y: 0, w: 0.5, h: 0.5 })
    expect(panes.get('c')).toEqual({ x: 0.5, y: 0.5, w: 0.5, h: 0.5 })
    expect(dividers).toHaveLength(2)
  })

  it('moves focus geometrically', () => {
    expect(neighbor(panes, 'a', 'right')).toBe('b')
    expect(neighbor(panes, 'c', 'left')).toBe('a')
    expect(neighbor(panes, 'b', 'down')).toBe('c')
    expect(neighbor(panes, 'c', 'up')).toBe('b')
    expect(neighbor(panes, 'a', 'left')).toBeNull()
    expect(neighbor(panes, 'b', 'up')).toBeNull()
  })
})

describe('dragSizes', () => {
  const split: SplitNode = {
    type: 'split',
    id: 's',
    direction: 'row',
    children: [pane('a'), pane('b')],
    sizes: [0.5, 0.5]
  }
  const rect = { x: 0, y: 0, w: 1, h: 1 }

  it('moves the divider to the pointer', () => {
    const [a, b] = dragSizes(split, rect, 0, 0.3)
    expect(a).toBeCloseTo(0.3)
    expect(b).toBeCloseTo(0.7)
  })

  it('clamps to a minimum size', () => {
    expect(dragSizes(split, rect, 0, -1)[0]).toBeCloseTo(0.05)
    expect(dragSizes(split, rect, 0, 2)[1]).toBeCloseTo(0.05)
  })

  it('works inside a nested split rect', () => {
    const [a] = dragSizes(split, { x: 0.5, y: 0, w: 0.5, h: 1 }, 0, 0.6)
    expect(a).toBeCloseTo(0.2)
  })
})
