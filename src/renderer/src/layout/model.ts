// Pure operations on the split tree. A tab's root is either one pane or a
// split whose children are laid out in a row or a column.
import { normalizeSizes, type LayoutNode, type PaneNode, type SplitNode } from '@shared/config'
import type { PrRef } from '@shared/prs'

export type Direction = 'left' | 'right' | 'up' | 'down'

export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

export interface Divider {
  splitId: string
  /** The divider sits between children[index] and children[index + 1]. */
  index: number
  direction: 'row' | 'column'
  /** The split's own rect, needed to turn a drag into new sizes. */
  splitRect: Rect
  /** Position of the divider along the split's main axis, as a fraction of the window. */
  at: number
}

export const newId = (prefix: string): string => `${prefix}-${crypto.randomUUID().slice(0, 8)}`

export function makePane(presetId: string, cwd: string): PaneNode {
  return { type: 'pane', id: newId('pane'), presetId, cwd }
}

/** A pane showing a web page. `cwd` is where a split or shell opened from it starts. */
export function makeWebPane(url: string, cwd: string): PaneNode {
  return { ...makePane('shell', cwd), url }
}

/** A pane showing a pull request. `cwd` is the checkout it was opened from. */
export function makePrPane(pr: PrRef, cwd: string, title?: string): PaneNode {
  return { ...makePane('shell', cwd), pr, ...(title ? { title } : {}) }
}

/** The tab already showing this pull request, and the pane that does. */
export function findPrPane(
  tabs: readonly { id: string; root: LayoutNode }[],
  pr: PrRef
): { tabId: string; paneId: string } | null {
  for (const tab of tabs) {
    const pane = allPanes(tab.root).find((p) => p.pr?.repo === pr.repo && p.pr.number === pr.number)
    if (pane) return { tabId: tab.id, paneId: pane.id }
  }
  return null
}

export function findPane(node: LayoutNode, id: string): PaneNode | null {
  if (node.type === 'pane') return node.id === id ? node : null
  for (const c of node.children) {
    const hit = findPane(c, id)
    if (hit) return hit
  }
  return null
}

export function allPanes(node: LayoutNode): PaneNode[] {
  return node.type === 'pane' ? [node] : node.children.flatMap(allPanes)
}

/**
 * Put `pane` next to `targetId`. Splitting right/down in a split that already
 * runs that way adds a sibling instead of nesting another split.
 */
export function splitPane(
  root: LayoutNode,
  targetId: string,
  direction: 'row' | 'column',
  pane: PaneNode
): LayoutNode {
  const visit = (node: LayoutNode): LayoutNode => {
    if (node.type === 'pane') {
      if (node.id !== targetId) return node
      return {
        type: 'split',
        id: newId('split'),
        direction,
        children: [node, pane],
        sizes: [0.5, 0.5]
      }
    }
    const idx = node.children.findIndex((c) => c.type === 'pane' && c.id === targetId)
    if (idx !== -1 && node.direction === direction) {
      const half = (node.sizes[idx] ?? 0) / 2
      const children = [...node.children]
      const sizes = [...node.sizes]
      children.splice(idx + 1, 0, pane)
      sizes.splice(idx, 1, half, half)
      return { ...node, children, sizes }
    }
    return { ...node, children: node.children.map(visit) }
  }
  return visit(root)
}

/** Remove a pane. Returns null when it was the last one. */
export function removePane(root: LayoutNode, id: string): LayoutNode | null {
  if (root.type === 'pane') return root.id === id ? null : root
  const children: LayoutNode[] = []
  const sizes: number[] = []
  root.children.forEach((c, i) => {
    const next = removePane(c, id)
    if (next) {
      children.push(next)
      sizes.push(root.sizes[i] ?? 0)
    }
  })
  if (children.length === 0) return null
  if (children.length === 1) return children[0] ?? null
  return { ...root, children, sizes: normalizeSizes(sizes, children.length) }
}

export function setSizes(root: LayoutNode, splitId: string, sizes: number[]): LayoutNode {
  if (root.type === 'pane') return root
  if (root.id === splitId) return { ...root, sizes: normalizeSizes(sizes, root.children.length) }
  return { ...root, children: root.children.map((c) => setSizes(c, splitId, sizes)) }
}

export function updatePane(
  root: LayoutNode,
  id: string,
  patch: Partial<Omit<PaneNode, 'type' | 'id'>>
): LayoutNode {
  if (root.type === 'pane') return root.id === id ? { ...root, ...patch } : root
  return { ...root, children: root.children.map((c) => updatePane(c, id, patch)) }
}

/** The same pane under a new id, so its terminal and session start over. */
export function renamePane(root: LayoutNode, id: string, to: string): LayoutNode {
  if (root.type === 'pane') return root.id === id ? { ...root, id: to } : root
  return { ...root, children: root.children.map((c) => renamePane(c, id, to)) }
}

export interface Arrangement {
  panes: Map<string, Rect>
  dividers: Divider[]
}

/** Lay the tree out in the unit square. */
export function arrange(root: LayoutNode): Arrangement {
  const panes = new Map<string, Rect>()
  const dividers: Divider[] = []
  const visit = (node: LayoutNode, r: Rect): void => {
    if (node.type === 'pane') {
      panes.set(node.id, r)
      return
    }
    let offset = 0
    node.children.forEach((child, i) => {
      const frac = node.sizes[i] ?? 0
      const childRect: Rect =
        node.direction === 'row'
          ? { x: r.x + offset * r.w, y: r.y, w: frac * r.w, h: r.h }
          : { x: r.x, y: r.y + offset * r.h, w: r.w, h: frac * r.h }
      visit(child, childRect)
      offset += frac
      if (i < node.children.length - 1) {
        dividers.push({
          splitId: node.id,
          index: i,
          direction: node.direction,
          splitRect: r,
          at: node.direction === 'row' ? r.x + offset * r.w : r.y + offset * r.h
        })
      }
    })
  }
  visit(root, { x: 0, y: 0, w: 1, h: 1 })
  return { panes, dividers }
}

const EPS = 1e-6

/** The pane you land on moving from `fromId` in `dir`, or null at the edge. */
export function neighbor(panes: Map<string, Rect>, fromId: string, dir: Direction): string | null {
  const from = panes.get(fromId)
  if (!from) return null
  const overlap = (a0: number, a1: number, b0: number, b1: number): number =>
    Math.max(0, Math.min(a1, b1) - Math.max(a0, b0))

  let best: { id: string; dist: number; overlap: number } | null = null
  for (const [id, r] of panes) {
    if (id === fromId) continue
    let dist: number
    let ov: number
    switch (dir) {
      case 'left':
        dist = from.x - (r.x + r.w)
        ov = overlap(from.y, from.y + from.h, r.y, r.y + r.h)
        break
      case 'right':
        dist = r.x - (from.x + from.w)
        ov = overlap(from.y, from.y + from.h, r.y, r.y + r.h)
        break
      case 'up':
        dist = from.y - (r.y + r.h)
        ov = overlap(from.x, from.x + from.w, r.x, r.x + r.w)
        break
      case 'down':
        dist = r.y - (from.y + from.h)
        ov = overlap(from.x, from.x + from.w, r.x, r.x + r.w)
        break
    }
    if (dist < -EPS || ov <= EPS) continue
    if (
      !best ||
      dist < best.dist - EPS ||
      (Math.abs(dist - best.dist) <= EPS && ov > best.overlap)
    ) {
      best = { id, dist, overlap: ov }
    }
  }
  return best?.id ?? null
}

/** New sizes for a split after dragging divider `index` to `pos` (window fraction). */
export function dragSizes(
  split: SplitNode,
  splitRect: Rect,
  index: number,
  pos: number,
  minFrac = 0.05
): number[] {
  const start = split.direction === 'row' ? splitRect.x : splitRect.y
  const len = split.direction === 'row' ? splitRect.w : splitRect.h
  const sizes = [...split.sizes]
  const a = sizes[index] ?? 0
  const b = sizes[index + 1] ?? 0
  const before = sizes.slice(0, index).reduce((s, n) => s + n, 0)
  const local = (pos - start) / len
  const newA = Math.min(Math.max(local - before, minFrac), a + b - minFrac)
  sizes[index] = newA
  sizes[index + 1] = a + b - newA
  return sizes
}

export function findSplit(node: LayoutNode, id: string): SplitNode | null {
  if (node.type === 'pane') return null
  if (node.id === id) return node
  for (const c of node.children) {
    const hit = findSplit(c, id)
    if (hit) return hit
  }
  return null
}
