// The window's layout: a tree of panels, separate from the terminal tabs and
// splits in config.ts's Layout. Splits lay their children side by side or
// stacked, tabs show one child at a time, and panels are the leaves:
// the terminals, the tab bar, the session list, and so on. Pure, so the
// rules can be unit tested; the renderer turns the tree into flexbox.
import { ACTIVITY_TABS, type ActivityTab } from './activity'

export const PANEL_KINDS = [
  'workspace',
  'tabbar',
  'sessions',
  'activity',
  'widget',
  'clock',
  'image',
  'monitor'
] as const

export type PanelKind = (typeof PANEL_KINDS)[number]

/** How a node takes room along its parent split's direction. */
export interface Sizing {
  /**
   * Pixels, or 'auto' to fit the content. Without it the node shares the
   * room its fixed and auto siblings leave, by `flex`.
   */
  size?: number | 'auto'
  /** Share of the free room, for nodes without a size. Defaults to 1. */
  flex?: number
  /** Limit for 'auto': pixels, or a fraction of the parent when 1 or less. */
  max?: number
  /** Only the node's title row shows. Works in column splits. */
  collapsed?: boolean
}

export interface FramePanel extends Sizing {
  type: 'panel'
  id: string
  panel: PanelKind
  /** widget: the widget's id. */
  widget?: string
  /** activity: the tab it shows. */
  tab?: ActivityTab
  /** clock */
  seconds?: boolean
  hour12?: boolean
  date?: boolean
  /** image: a file in ~/.cockpit/images/, or theme:<file> in the theme's folder. */
  src?: string
  fit?: 'cover' | 'contain'
  /** CSS object-position. */
  position?: string
  /** Sharp pixels when scaled, for pixel art. */
  pixelated?: boolean
}

interface Container extends Sizing {
  id: string
  children: FrameNode[]
  /** Gives the group a title row, with a button that switches it between split and tabs. */
  title?: string
  /** Installed widgets that aren't placed anywhere else go here. */
  widgets?: 'rest'
}

export interface FrameSplit extends Container {
  type: 'split'
  /** row: children side by side. column: stacked. */
  direction: 'row' | 'column'
}

export interface FrameTabs extends Container {
  type: 'tabs'
  /** The child shown. */
  active: string | null
}

export type FrameNode = FramePanel | FrameSplit | FrameTabs
export type FrameContainer = FrameSplit | FrameTabs

const MAX_DEPTH = 8
const MAX_CHILDREN = 32
export const MIN_SIZE = 24
export const MAX_SIZE = 4000

type Obj = Record<string, unknown>
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v)
const isStr = (v: unknown): v is string => typeof v === 'string'
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
const isKind = (v: unknown): v is PanelKind => PANEL_KINDS.includes(v as PanelKind)

/** Ids go into CSS anchor names and config.json keys. */
const SAFE_ID = /^[A-Za-z0-9:_-]{1,80}$/

function readSizing(v: Obj): Sizing {
  const s: Sizing = {}
  if (v.size === 'auto') s.size = 'auto'
  else if (isNum(v.size)) s.size = Math.round(Math.min(MAX_SIZE, Math.max(MIN_SIZE, v.size)))
  if (isNum(v.flex) && v.flex > 0) s.flex = Math.min(1000, Math.max(0.001, v.flex))
  if (isNum(v.max) && v.max > 0) s.max = v.max <= 1 ? v.max : Math.min(MAX_SIZE, v.max)
  if (v.collapsed === true) s.collapsed = true
  return s
}

function readPanel(v: Obj, id: string): FramePanel | null {
  if (!isKind(v.panel)) return null
  const p: FramePanel = { type: 'panel', id, panel: v.panel, ...readSizing(v) }
  switch (v.panel) {
    case 'widget':
      if (!isStr(v.widget) || !/^[a-z][a-z0-9-]{0,63}$/.test(v.widget)) return null
      p.widget = v.widget
      break
    case 'activity':
      if (ACTIVITY_TABS.includes(v.tab as ActivityTab)) p.tab = v.tab as ActivityTab
      break
    case 'clock':
      if (typeof v.seconds === 'boolean') p.seconds = v.seconds
      if (typeof v.hour12 === 'boolean') p.hour12 = v.hour12
      if (typeof v.date === 'boolean') p.date = v.date
      break
    case 'image':
      if (isStr(v.src) && v.src.length <= 200) p.src = v.src
      if (v.fit === 'cover' || v.fit === 'contain') p.fit = v.fit
      if (isStr(v.position) && /^[a-z0-9% .-]{1,40}$/i.test(v.position)) p.position = v.position
      if (v.pixelated === true) p.pixelated = true
      break
  }
  return p
}

/** The id a node gets when the file doesn't give one, from what it is or where it sits. */
function defaultId(v: Obj, path: string): string {
  if (v.type === 'panel' && (v.panel === 'workspace' || v.panel === 'tabbar')) return v.panel
  if (v.type === 'panel' && v.panel === 'widget' && isStr(v.widget)) return `widget:${v.widget}`
  return `n${path}`
}

interface ReadState {
  ids: Set<string>
  widgets: Set<string>
  workspace: boolean
  tabbar: boolean
  rest: boolean
}

function readNode(v: unknown, path: string, depth: number, st: ReadState): FrameNode | null {
  if (!isObj(v) || depth > MAX_DEPTH) return null
  let id = isStr(v.id) && SAFE_ID.test(v.id) ? v.id : defaultId(v, path)
  if (st.ids.has(id)) id = `n${path}`
  if (st.ids.has(id)) return null

  if (v.type === 'panel') {
    const p = readPanel(v, id)
    if (!p) return null
    // One terminal area, one tab bar, and each widget once: they hold state
    // that can't be in two places.
    if (p.panel === 'workspace') {
      if (st.workspace) return null
      st.workspace = true
    }
    if (p.panel === 'tabbar') {
      if (st.tabbar) return null
      st.tabbar = true
    }
    if (p.widget) {
      if (st.widgets.has(p.widget)) return null
      st.widgets.add(p.widget)
    }
    st.ids.add(id)
    return p
  }

  if (v.type !== 'split' && v.type !== 'tabs') return null
  st.ids.add(id)
  const rawChildren = Array.isArray(v.children) ? v.children.slice(0, MAX_CHILDREN) : []
  const children = rawChildren
    .map((c, i) => readNode(c, `${path}-${String(i)}`, depth + 1, st))
    .filter((c): c is FrameNode => c !== null)
  const base: Container = { id, children, ...readSizing(v) }
  if (isStr(v.title) && v.title.trim()) base.title = v.title.trim().slice(0, 40)
  if (v.widgets === 'rest' && !st.rest) {
    base.widgets = 'rest'
    st.rest = true
  }
  if (v.type === 'tabs') {
    base.children = children.map(unfold)
    const active =
      isStr(v.active) && children.some((c) => c.id === v.active)
        ? v.active
        : (children[0]?.id ?? null)
    return { ...base, type: 'tabs', active }
  }
  // A plain split of one child is just that child, in the split's place.
  const only = children[0]
  if (children.length === 1 && only && !base.title && !base.widgets) {
    return { ...withoutSizing(only), ...sizingOf(base) }
  }
  if (children.length === 0 && !base.widgets) return null
  const direction = v.direction === 'column' ? 'column' : 'row'
  return {
    ...base,
    type: 'split',
    direction,
    children: direction === 'column' ? children : children.map(unfold)
  }
}

/** Folding only means something in a column split; anywhere else it's dropped. */
function unfold<T extends FrameNode>(n: T): T {
  if (!n.collapsed) return n
  const copy = { ...n }
  delete copy.collapsed
  return copy
}

function sizingOf(n: Sizing): Sizing {
  const s: Sizing = {}
  if (n.size !== undefined) s.size = n.size
  if (n.flex !== undefined) s.flex = n.flex
  if (n.max !== undefined) s.max = n.max
  if (n.collapsed) s.collapsed = true
  return s
}

/** Drop the sizing keys so the node flexes (used when it moves into a new parent). */
function withoutSizing<T extends FrameNode>(n: T): T {
  const copy = { ...n }
  delete copy.size
  delete copy.flex
  delete copy.max
  delete copy.collapsed
  return copy
}

export function panel(kind: PanelKind, extra: Partial<FramePanel> = {}): FramePanel {
  const id = kind === 'widget' && extra.widget ? `widget:${extra.widget}` : kind
  return { type: 'panel', id, panel: kind, ...extra }
}

/**
 * Turn whatever is in config.json into a usable tree. Bad nodes are dropped,
 * and the tree always ends up with one workspace, one tab bar, and one group
 * for widgets that aren't placed elsewhere. Never throws. Ids it makes up
 * depend only on the tree's shape, so reading a saved tree again keeps them.
 */
export function readFrame(raw: unknown): FrameNode {
  const st: ReadState = {
    ids: new Set(),
    widgets: new Set(),
    workspace: false,
    tabbar: false,
    rest: false
  }
  let root = unfold(readNode(raw, '0', 0, st) ?? panel('workspace'))
  if (root.type === 'panel' && root.panel === 'workspace') st.workspace = true

  if (!st.workspace) {
    root = { type: 'split', id: 'n-root', direction: 'row', children: [root, panel('workspace')] }
  }
  if (!st.tabbar) {
    // Put a tab bar on top of the terminals.
    root = mapNode(root, (n) =>
      n.type === 'panel' && n.panel === 'workspace'
        ? {
            type: 'split',
            id: 'n-terminals',
            direction: 'column',
            children: [panel('tabbar', { size: 'auto' }), withoutSizing(n)],
            ...sizingOf(n)
          }
        : n
    )
  }
  if (!st.rest) root = addRestGroup(root)
  return root
}

/**
 * Mark the container holding the most widgets (or the one with the session
 * list or Activity) as the place for new widgets. With none of those, add a
 * column on the right.
 */
function addRestGroup(root: FrameNode): FrameNode {
  const score = (n: FrameContainer): number =>
    n.children.filter((c) => c.type === 'panel' && c.panel === 'widget').length * 2 +
    (n.children.some(
      (c) => c.type === 'panel' && (c.panel === 'sessions' || c.panel === 'activity')
    )
      ? 1
      : 0)
  const containers: FrameContainer[] = []
  walk(root, (n) => {
    if (n.type !== 'panel') containers.push(n)
  })
  const best = containers.reduce<FrameContainer | null>(
    (b, n) => (score(n) > (b ? score(b) : 0) ? n : b),
    null
  )
  if (best) {
    return updateNode(root, best.id, (n) => (n.type === 'panel' ? n : { ...n, widgets: 'rest' }))
  }
  const group: FrameSplit = {
    type: 'split',
    id: 'n-widgets',
    direction: 'column',
    title: 'Widgets',
    widgets: 'rest',
    size: 320,
    children: []
  }
  return { type: 'split', id: 'n-root-widgets', direction: 'row', children: [root, group] }
}

export function walk(
  node: FrameNode,
  fn: (n: FrameNode, parent: FrameContainer | null) => void,
  parent: FrameContainer | null = null
): void {
  fn(node, parent)
  if (node.type !== 'panel') for (const c of node.children) walk(c, fn, node)
}

/** A copy of the tree with `fn` applied to every node, children first. */
export function mapNode(node: FrameNode, fn: (n: FrameNode) => FrameNode): FrameNode {
  if (node.type === 'panel') return fn(node)
  return fn({ ...node, children: node.children.map((c) => mapNode(c, fn)) })
}

export function findNode(root: FrameNode, id: string): FrameNode | null {
  let found: FrameNode | null = null
  walk(root, (n) => {
    if (!found && n.id === id) found = n
  })
  return found
}

export function panels(root: FrameNode): FramePanel[] {
  const out: FramePanel[] = []
  walk(root, (n) => {
    if (n.type === 'panel') out.push(n)
  })
  return out
}

/** Replace the node `id` with `fn` of it. */
export function updateNode(
  root: FrameNode,
  id: string,
  fn: (n: FrameNode) => FrameNode
): FrameNode {
  return mapNode(root, (n) => (n.id === id ? fn(n) : n))
}

/**
 * Installed widgets that no panel shows yet, appended to the group marked
 * `widgets: 'rest'`. Returns the same tree when every widget is placed, so it
 * can run on every render.
 */
export function placeWidgets(root: FrameNode, installed: readonly string[]): FrameNode {
  const placed = new Set(panels(root).flatMap((p) => (p.widget ? [p.widget] : [])))
  const missing = installed.filter((id) => !placed.has(id))
  if (missing.length === 0) return root
  return mapNode(root, (n) => {
    if (n.type === 'panel' || n.widgets !== 'rest') return n
    const added = missing.map((w) => panel('widget', { widget: w }))
    const next = { ...n, children: [...n.children, ...added] }
    return next.type === 'tabs' && !next.active ? { ...next, active: added[0]?.id ?? null } : next
  })
}

const holdsTerminals = (n: FrameNode): boolean => {
  let found = false
  walk(n, (c) => {
    if (c.type === 'panel' && (c.panel === 'workspace' || c.panel === 'tabbar')) found = true
  })
  return found
}

export interface FrameState {
  /** Panels with nothing to show (an uninstalled widget, Activity with no pane focused). */
  absent: ReadonlySet<string>
  /** Cmd+B: everything but the terminals and the tab bar is hidden. */
  panelsHidden: boolean
}

/**
 * Whether a node takes room at all. Absent panels don't, and neither does a
 * container with nothing present in it, nor anything hidden with Cmd+B.
 */
export function isShown(n: FrameNode, st: FrameState): boolean {
  if (st.panelsHidden && !holdsTerminals(n)) return false
  if (n.type === 'panel') return !st.absent.has(n.id)
  return n.children.some((c) => isShown(c, st))
}

/**
 * The panels a person can see: shown, not collapsed, in the selected tab,
 * all the way up.
 */
export function visiblePanels(root: FrameNode, st: FrameState): Set<string> {
  const out = new Set<string>()
  const visit = (n: FrameNode, parent: FrameContainer | null): void => {
    if (!isShown(n, st) || isFolded(n, parent)) return
    if (n.type === 'panel') {
      out.add(n.id)
      return
    }
    if (n.type === 'tabs') {
      const active = activeChild(n, st)
      if (active) visit(active, n)
      return
    }
    for (const c of n.children) visit(c, n)
  }
  visit(root, null)
  return out
}

/** Whether a node shows only its title row: folded, in a column split. */
export function isFolded(n: FrameNode, parent: FrameContainer | null): boolean {
  return n.collapsed === true && parent?.type === 'split' && parent.direction === 'column'
}

/** The tab shown: the selected one, or the first present one if it's absent. */
export function activeChild(n: FrameTabs, st: FrameState): FrameNode | null {
  const shown = n.children.filter((c) => isShown(c, st))
  return shown.find((c) => c.id === n.active) ?? shown[0] ?? null
}

export interface Edges {
  top: boolean
  left: boolean
}

/**
 * Which nodes touch the window's top and left edges, for the window drag
 * region and the room the traffic lights need. A tabs node's children sit
 * below its tab row, so they never touch the top.
 */
export function edges(root: FrameNode, st: FrameState): Map<string, Edges> {
  const out = new Map<string, Edges>()
  const visit = (n: FrameNode, e: Edges): void => {
    out.set(n.id, e)
    if (n.type === 'panel') return
    const shown = n.children.filter((c) => isShown(c, st))
    const titled = n.type === 'tabs' || !!n.title
    shown.forEach((c, i) => {
      const first = i === 0
      if (n.type === 'tabs') visit(c, { top: false, left: e.left })
      else if (n.direction === 'row') visit(c, { top: e.top && !titled, left: e.left && first })
      else visit(c, { top: e.top && !titled && first, left: e.left })
    })
  }
  visit(root, { top: true, left: true })
  return out
}

export function toggleCollapsed(root: FrameNode, id: string): FrameNode {
  return updateNode(root, id, (n) => {
    const next = { ...n }
    if (n.collapsed) delete next.collapsed
    else next.collapsed = true
    return next
  })
}

export function setActiveTab(root: FrameNode, tabsId: string, childId: string): FrameNode {
  return updateNode(root, tabsId, (n) =>
    n.type === 'tabs' && n.children.some((c) => c.id === childId) ? { ...n, active: childId } : n
  )
}

/** A titled group switches between a column and tabs, keeping its children. */
export function toggleMode(root: FrameNode, id: string): FrameNode {
  return updateNode(root, id, (n) => {
    if (n.type === 'panel') return n
    const { children, title, widgets } = n
    const base: Container = { id: n.id, children, ...sizingOf(n) }
    if (title) base.title = title
    if (widgets) base.widgets = widgets
    if (n.type === 'tabs') return { ...base, type: 'split', direction: 'column' }
    // A tab has no title row to unfold it from.
    return {
      ...base,
      children: children.map(unfold),
      type: 'tabs',
      active: children[0]?.id ?? null
    }
  })
}

/** Set one panel's options (the Activity tab it shows, for one). */
export function setPanel(root: FrameNode, id: string, patch: Partial<FramePanel>): FrameNode {
  return updateNode(root, id, (n) =>
    n.type === 'panel' ? { ...n, ...patch, type: 'panel', id: n.id, panel: n.panel } : n
  )
}

export interface DragStart {
  /** The two neighbours' sizes in pixels when the drag began. */
  px: [number, number]
  /** The smallest each may get. */
  min: [number, number]
  /**
   * Set when one neighbour fits its content: only the other one, which has a
   * pixel size, changes, growing to at most `room` pixels.
   */
  auto?: { side: 0 | 1; room: number }
}

/**
 * Move the divider between two neighbouring children of a split, `ids`, by
 * `delta` pixels. A child with a pixel size changes its size; when both flex,
 * their shares change so that the first one gets the new width.
 */
export function dragDivider(
  root: FrameNode,
  splitId: string,
  ids: [string, string],
  start: DragStart,
  delta: number
): FrameNode {
  return updateNode(root, splitId, (n) => {
    if (n.type !== 'split') return n
    const a = n.children.find((c) => c.id === ids[0])
    const b = n.children.find((c) => c.id === ids[1])
    if (!a || !b) return n
    if (start.auto) {
      // One side fits its content, so the other takes the whole move.
      const i = start.auto.side === 0 ? 1 : 0
      const target = i === 0 ? a : b
      if (typeof target.size !== 'number') return n
      const moved = start.px[i] + (i === 0 ? delta : -delta)
      const size = clampSize(Math.min(start.auto.room, Math.max(start.min[i], moved)))
      return {
        ...n,
        children: n.children.map((c) => (c === target ? { ...c, size } : c))
      }
    }
    const total = start.px[0] + start.px[1]
    const lo = Math.min(start.min[0], total / 2)
    const hi = Math.max(lo, total - Math.min(start.min[1], total / 2))
    const first = Math.round(Math.min(hi, Math.max(lo, start.px[0] + delta)))
    const second = total - first
    const fixed = (c: FrameNode): boolean => typeof c.size === 'number'
    let na: FrameNode = a
    let nb: FrameNode = b
    if (fixed(a)) na = { ...a, size: clampSize(first) }
    if (fixed(b)) nb = { ...b, size: clampSize(second) }
    if (!fixed(a) && !fixed(b)) {
      const sum = (a.flex ?? 1) + (b.flex ?? 1)
      const fa = total > 0 ? (sum * first) / total : sum / 2
      na = { ...a, flex: fa }
      nb = { ...b, flex: sum - fa }
    }
    const children = n.children.map((c) => (c === a ? na : c === b ? nb : c))
    return { ...n, children }
  })
}

const clampSize = (px: number): number => Math.min(MAX_SIZE, Math.max(MIN_SIZE, Math.round(px)))

/** Panels that fit their content unless the layout gives them a size. */
const AUTO_PANELS: readonly PanelKind[] = ['tabbar', 'sessions', 'monitor']

/** The node's size, with the default for its kind filled in. */
export function sizeOf(n: FrameNode): Sizing['size'] {
  if (n.size !== undefined) return n.size
  return n.type === 'panel' && AUTO_PANELS.includes(n.panel) ? 'auto' : undefined
}
