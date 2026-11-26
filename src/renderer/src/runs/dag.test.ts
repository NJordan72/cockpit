import { describe, expect, it } from 'bun:test'
import type { RunItem } from '@shared/runs'
import { DAG_COL_GAP, DAG_NODE_WIDTH, layoutDag } from './dag'

const item = (id: string, after: string[] = []): RunItem => ({
  id,
  title: `Story ${id}`,
  branch: `me/${id}`,
  prompt: `Start ${id}`,
  after
})

describe('layoutDag', () => {
  it('returns an empty layout for no items', () => {
    expect(layoutDag([])).toEqual({ nodes: [], edges: [], tiers: 0, width: 0, height: 0 })
  })

  it('assigns topological tiers left-to-right for a chain', () => {
    const layout = layoutDag([item('c', ['b']), item('a'), item('b', ['a'])])
    expect(layout.tiers).toBe(3)
    const byId = Object.fromEntries(layout.nodes.map((n) => [n.id, n]))
    expect(byId.a?.tier).toBe(0)
    expect(byId.b?.tier).toBe(1)
    expect(byId.c?.tier).toBe(2)
    expect((byId.b?.x ?? 0) - (byId.a?.x ?? 0)).toBe(DAG_NODE_WIDTH + DAG_COL_GAP)
    expect((byId.c?.x ?? 0) - (byId.b?.x ?? 0)).toBe(DAG_NODE_WIDTH + DAG_COL_GAP)
    expect(layout.edges.map((e) => `${e.from}->${e.to}`)).toEqual(['a->b', 'b->c'])
  })

  it('lays out a diamond graph with centered root/sink and longest-path tiers', () => {
    const layout = layoutDag([item('a'), item('b', ['a']), item('c', ['a']), item('d', ['b', 'c'])])
    expect(layout.tiers).toBe(3)
    const byId = Object.fromEntries(layout.nodes.map((n) => [n.id, n]))
    expect(byId.a?.tier).toBe(0)
    expect(byId.b?.tier).toBe(1)
    expect(byId.c?.tier).toBe(1)
    expect(byId.d?.tier).toBe(2)
    // Root and sink are vertically centered relative to the 2-node middle tier.
    expect(byId.a?.y).toBe(byId.d?.y)
    expect(byId.b?.y).not.toBe(byId.c?.y)
    expect(layout.edges).toHaveLength(4)
    for (const edge of layout.edges) {
      expect(edge.path.startsWith('M ')).toBe(true)
      expect(edge.x2).toBeGreaterThan(edge.x1)
    }
  })

  it('places external items in tier 0 and connects them to dependents', () => {
    const layout = layoutDag([
      item('a'),
      { id: 'ext', title: 'Design tokens', external: true },
      item('b', ['a', 'ext'])
    ])
    expect(layout.tiers).toBe(2)
    const byId = Object.fromEntries(layout.nodes.map((n) => [n.id, n]))
    expect(byId.ext).toMatchObject({ tier: 0, external: true })
    expect(byId.a).toMatchObject({ tier: 0, external: false })
    expect(byId.b?.tier).toBe(1)
    expect(layout.edges.map((e) => `${e.from}->${e.to}`).sort()).toEqual(['a->b', 'ext->b'])
  })

  it('computes longest-path tiers when a node depends on multiple depths', () => {
    const layout = layoutDag([item('1'), item('2', ['1']), item('3', ['1', '2'])])
    const byId = Object.fromEntries(layout.nodes.map((n) => [n.id, n]))
    expect(byId['1']?.tier).toBe(0)
    expect(byId['2']?.tier).toBe(1)
    expect(byId['3']?.tier).toBe(2)
    expect(layout.width).toBeGreaterThan(0)
    expect(layout.height).toBeGreaterThan(0)
  })
})
