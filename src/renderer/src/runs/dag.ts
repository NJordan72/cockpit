// Compact left-to-right topological DAG layout for Runs. Pure, so it can be unit tested.
import { startOrder, type RunItem } from '@shared/runs'

export const DAG_NODE_WIDTH = 136
export const DAG_NODE_HEIGHT = 36
export const DAG_COL_GAP = 32
export const DAG_ROW_GAP = 10
export const DAG_PAD = 8

export interface DagNode {
  id: string
  title: string
  external: boolean
  tier: number
  row: number
  x: number
  y: number
  width: number
  height: number
}

export interface DagEdge {
  from: string
  to: string
  x1: number
  y1: number
  x2: number
  y2: number
  path: string
}

export interface DagLayout {
  nodes: DagNode[]
  edges: DagEdge[]
  tiers: number
  width: number
  height: number
}

/**
 * Assigns each item to a topological tier (longest dependency chain length)
 * and lays out columns left-to-right with cubic Bezier edges.
 */
export function layoutDag(items: readonly RunItem[]): DagLayout {
  if (items.length === 0) {
    return { nodes: [], edges: [], tiers: 0, width: 0, height: 0 }
  }

  const ordered = startOrder(items)
  const orderIndex = new Map(ordered.map((item, idx) => [item.id, idx]))
  const byId = new Map(ordered.map((item) => [item.id, item]))
  const tiers = new Map<string, number>()
  const visiting = new Set<string>()

  const tierOf = (id: string): number => {
    const cached = tiers.get(id)
    if (cached !== undefined) return cached
    if (visiting.has(id)) return 0
    const item = byId.get(id)
    if (!item || item.external || item.after.length === 0) {
      tiers.set(id, 0)
      return 0
    }
    visiting.add(id)
    let maxParent = -1
    for (const dep of item.after) {
      if (!byId.has(dep)) continue
      const t = tierOf(dep)
      if (t > maxParent) maxParent = t
    }
    visiting.delete(id)
    const tier = maxParent + 1
    tiers.set(id, tier)
    return tier
  }

  let maxTier = 0
  for (const item of ordered) {
    const t = tierOf(item.id)
    if (t > maxTier) maxTier = t
  }

  const columns: RunItem[][] = Array.from({ length: maxTier + 1 }, () => [])
  for (const item of ordered) {
    columns[tierOf(item.id)]?.push(item)
  }

  // Order each column after tier 0 by average parent row (barycenter) to reduce crossings.
  const rowOf = new Map<string, number>()
  for (const [tier, col] of columns.entries()) {
    if (tier > 0) {
      const barycenter = (item: RunItem): number => {
        if (item.external || item.after.length === 0) return orderIndex.get(item.id) ?? 0
        let sum = 0
        let count = 0
        for (const dep of item.after) {
          const r = rowOf.get(dep)
          if (r !== undefined) {
            sum += r
            count++
          }
        }
        return count > 0 ? sum / count : (orderIndex.get(item.id) ?? 0)
      }
      col.sort((a, b) => {
        const diff = barycenter(a) - barycenter(b)
        if (diff !== 0) return diff
        return (orderIndex.get(a.id) ?? 0) - (orderIndex.get(b.id) ?? 0)
      })
    }
    for (const [row, item] of col.entries()) {
      rowOf.set(item.id, row)
    }
  }

  const maxRows = Math.max(...columns.map((c) => c.length), 1)
  const contentHeight = maxRows * DAG_NODE_HEIGHT + (maxRows - 1) * DAG_ROW_GAP
  const contentWidth = columns.length * DAG_NODE_WIDTH + (columns.length - 1) * DAG_COL_GAP

  const nodes: DagNode[] = []
  const nodeById = new Map<string, DagNode>()

  for (const [tier, col] of columns.entries()) {
    const colHeight = col.length * DAG_NODE_HEIGHT + Math.max(0, col.length - 1) * DAG_ROW_GAP
    const offsetY = Math.round((contentHeight - colHeight) / 2)
    const x = DAG_PAD + tier * (DAG_NODE_WIDTH + DAG_COL_GAP)
    for (const [row, item] of col.entries()) {
      const y = DAG_PAD + offsetY + row * (DAG_NODE_HEIGHT + DAG_ROW_GAP)
      const node: DagNode = {
        id: item.id,
        title: item.title,
        external: item.external === true,
        tier,
        row,
        x,
        y,
        width: DAG_NODE_WIDTH,
        height: DAG_NODE_HEIGHT
      }
      nodes.push(node)
      nodeById.set(item.id, node)
    }
  }

  const edges: DagEdge[] = []
  for (const item of ordered) {
    if (item.external) continue
    const to = nodeById.get(item.id)
    if (!to) continue
    for (const dep of item.after) {
      const from = nodeById.get(dep)
      if (!from) continue
      const x1 = from.x + from.width
      const y1 = Math.round(from.y + from.height / 2)
      const x2 = to.x
      const y2 = Math.round(to.y + to.height / 2)
      const mx = Math.round((x1 + x2) / 2)
      edges.push({
        from: dep,
        to: item.id,
        x1,
        y1,
        x2,
        y2,
        path: `M ${String(x1)} ${String(y1)} C ${String(mx)} ${String(y1)}, ${String(mx)} ${String(y2)}, ${String(x2)} ${String(y2)}`
      })
    }
  }

  return {
    nodes,
    edges,
    tiers: columns.length,
    width: contentWidth + DAG_PAD * 2,
    height: contentHeight + DAG_PAD * 2
  }
}
