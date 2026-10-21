// How frame nodes become flexbox: the CSS each cell gets from its sizing and
// its siblings. Pure, so it can be tested without a DOM.
import {
  isShown,
  sizeOf,
  type FrameContainer,
  type FrameNode,
  type FramePanel,
  type FrameState
} from '@shared/frame'
import type { WidgetInfo } from '@shared/widgets'

/** Smallest a panel gets while dragging or squeezed. */
export const MIN_PANEL = 48
/** The terminals keep at least this much. */
export const MIN_WORKSPACE = { row: 320, column: 120 }

export interface SizingContext {
  /** Widgets that size to their content ("sizing": "content"). */
  contentWidgets: ReadonlySet<string>
  state: FrameState
}

export type CellSize = number | 'auto' | 'flex'

/**
 * A node's size along a split of direction `dir`, counting content-sized
 * widgets as 'auto'. A split stacked the same way whose shown children all
 * fit their content (or are folded) fits its content too, so a column of
 * folded widgets doesn't hold on to empty room.
 */
export function cellSize(n: FrameNode, ctx: SizingContext, dir?: 'row' | 'column'): CellSize {
  if (n.type === 'panel' && n.widget && ctx.contentWidgets.has(n.widget) && n.size === undefined)
    return 'auto'
  const own = sizeOf(n)
  if (own !== undefined) return own
  if (dir && n.type === 'split' && n.direction === dir && n.flex === undefined) {
    const shown = n.children.filter((c) => isShown(c, ctx.state))
    const fits = (c: FrameNode): boolean =>
      (dir === 'column' && c.collapsed === true) || cellSize(c, ctx, dir) === 'auto'
    if (shown.length > 0 && shown.every(fits)) return 'auto'
  }
  return 'flex'
}

const holdsWorkspace = (n: FrameNode): boolean =>
  n.type === 'panel' ? n.panel === 'workspace' : n.children.some((c) => holdsWorkspace(c))

export function minSize(n: FrameNode, direction: 'row' | 'column'): number {
  return holdsWorkspace(n) ? MIN_WORKSPACE[direction] : MIN_PANEL
}

/**
 * The flex style of a split's child. `shown` are the split's children that
 * take room. When none of them flexes, the fixed ones grow to fill the split,
 * so a column holding only fixed-size panels has no empty space at its end.
 */
export function cellStyle(
  n: FrameNode,
  parent: FrameContainer | null,
  shown: readonly FrameNode[],
  ctx: SizingContext
): React.CSSProperties {
  if (!parent || parent.type === 'tabs') return { flex: '1 1 0px' }
  const dir = parent.direction
  const main = dir === 'row' ? 'Width' : 'Height'
  if (n.collapsed && dir === 'column') return { flex: 'none' }
  const size = cellSize(n, ctx, dir)
  if (size === 'auto') {
    const style: React.CSSProperties = { flex: 'none' }
    if (n.max !== undefined) {
      style[`max${main}`] = n.max <= 1 ? `${String(n.max * 100)}%` : `${String(n.max)}px`
    }
    return style
  }
  const min = minSize(n, dir)
  if (typeof size === 'number') {
    const flexes = shown.some(
      (c) => cellSize(c, ctx, dir) === 'flex' && !(c.collapsed && dir === 'column')
    )
    return {
      flex: `${flexes ? '0' : '1'} 1 ${String(size)}px`,
      [`min${main}`]: Math.min(min, size)
    }
  }
  return { flex: `${String(n.flex ?? 1)} 1 0px`, [`min${main}`]: min }
}

/** What a tab or a title row calls a node. */
export function nodeLabel(n: FrameNode, widgets: ReadonlyMap<string, WidgetInfo>): string {
  if (n.type !== 'panel') return n.title ?? (n.type === 'tabs' ? 'Tabs' : 'Group')
  return panelLabel(n, widgets)
}

export function panelLabel(p: FramePanel, widgets: ReadonlyMap<string, WidgetInfo>): string {
  switch (p.panel) {
    case 'widget':
      return (p.widget && widgets.get(p.widget)?.manifest?.name) ?? p.widget ?? 'Widget'
    case 'workspace':
      return 'Terminals'
    case 'tabbar':
      return 'Tabs'
    case 'sessions':
      return 'Sessions'
    case 'activity':
      return 'Activity'
    case 'clock':
      return 'Clock'
    case 'image':
      return 'Image'
    case 'monitor':
      return 'System'
    case 'prs':
      return 'Pull requests'
    case 'commands':
      return 'Commands'
  }
}

/** The CSS anchor name of a widget's or the workspace's placeholder. */
export const slotName = (key: string): string => `--slot-${key.replace(/[^a-z0-9-]/gi, '-')}`
