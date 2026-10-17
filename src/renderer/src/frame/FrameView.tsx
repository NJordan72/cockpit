import {
  activeChild,
  dragDivider,
  isFolded,
  isShown,
  type DragStart,
  setActiveTab,
  toggleCollapsed,
  toggleMode,
  type Edges,
  type FrameContainer,
  type FrameNode,
  type FramePanel,
  type FrameState,
  type FrameTabs
} from '@shared/frame'
import type { WidgetInfo } from '@shared/widgets'
import { dragPointer } from '../drag'
import {
  cellSize,
  cellStyle,
  minSize,
  nodeLabel,
  panelLabel,
  slotName,
  type SizingContext
} from './layout'

/** What a panel drawn by the app (not by the frame) needs to know about its place. */
export interface PanelPlace {
  edges: Edges
  /** On screen: shown, not folded, in the selected tab. */
  visible: boolean
  collapsed: boolean
  /** Folding works in column splits. */
  canCollapse: boolean
  toggleCollapsed: () => void
}

export interface FrameViewProps {
  tree: FrameNode
  state: FrameState
  visible: ReadonlySet<string>
  edges: ReadonlyMap<string, Edges>
  widgets: ReadonlyMap<string, WidgetInfo>
  sizing: SizingContext
  /** Heights reported by content-sized widgets, by widget id. */
  contentHeights: Readonly<Record<string, number>>
  onChange: (tree: FrameNode) => void
  onReloadWidget: (id: string) => void
  /** Draws the panels the frame doesn't: the tab bar, sessions, activity, clock, image, monitor. */
  renderPanel: (p: FramePanel, place: PanelPlace) => React.ReactNode
}

const NO_EDGES: Edges = { top: false, left: false }

const edgeClass = (e: Edges | undefined): string =>
  `${e?.top ? ' at-top' : ''}${e?.left ? ' at-left' : ''}`

/**
 * The window's panels as nested flexboxes. Terminals and widgets aren't drawn
 * here: each gets an empty placeholder that the floating layer (Floating.tsx)
 * puts the real thing over, so moving a panel never reloads it.
 */
export function FrameView(props: FrameViewProps): React.JSX.Element {
  return (
    <div className="frame-cell frame-top">
      <Node {...props} node={props.tree} parent={null} />
    </div>
  )
}

interface NodeProps extends FrameViewProps {
  node: FrameNode
  parent: FrameContainer | null
}

function Node(props: NodeProps): React.JSX.Element {
  const { node } = props
  if (node.type === 'panel') return <Panel {...props} node={node} />
  if (node.type === 'tabs') return <Tabs {...props} node={node} />
  return <Split {...props} node={node} />
}

/** A title row: a group's name and the button that switches it between a column and tabs. */
function GroupHead({
  node,
  onChange,
  tree,
  children
}: {
  node: FrameContainer
  tree: FrameNode
  onChange: (t: FrameNode) => void
  children?: React.ReactNode
}): React.JSX.Element {
  const tabs = node.type === 'tabs'
  return (
    <header className="frame-head group-head">
      {children ?? <span className="frame-title">{node.title}</span>}
      {node.title && (
        <button
          type="button"
          tabIndex={-1}
          className="icon"
          title={tabs ? 'Show stacked' : 'Show as tabs'}
          onClick={() => onChange(toggleMode(tree, node.id))}
        >
          {tabs ? '☰' : '⧉'}
        </button>
      )}
    </header>
  )
}

function Split(
  props: NodeProps & { node: Extract<FrameNode, { type: 'split' }> }
): React.JSX.Element {
  const { node, state, tree, onChange, sizing } = props
  const shown = node.children.filter((c) => isShown(c, state))
  const dir = node.direction

  const startDrag = (e: React.PointerEvent<HTMLDivElement>, a: FrameNode, b: FrameNode): void => {
    const cellA = e.currentTarget.parentElement
    const cellB = cellA?.nextElementSibling
    if (!(cellB instanceof HTMLElement) || !cellA) return
    const px = (el: Element): number =>
      el instanceof HTMLElement ? (dir === 'row' ? el.offsetWidth : el.offsetHeight) : 0
    const start: DragStart = {
      px: [px(cellA), px(cellB)],
      min: [minSize(a, dir), minSize(b, dir)]
    }
    const autoSide =
      cellSize(a, sizing, dir) === 'auto' ? 0 : cellSize(b, sizing, dir) === 'auto' ? 1 : null
    if (autoSide !== null) {
      // The fixed side can grow by what the flexible siblings can give up.
      const cells = [...(cellA.parentElement?.children ?? [])]
      const slack = shown.reduce((sum, c, i) => {
        const cell = cells[i]
        if (!cell || cellSize(c, sizing, dir) !== 'flex' || c.collapsed) return sum
        return sum + Math.max(0, px(cell) - minSize(c, dir))
      }, 0)
      const fixed = autoSide === 0 ? 1 : 0
      start.auto = { side: autoSide, room: start.px[fixed] + slack }
    }
    const from = tree
    dragPointer(e, (dx, dy) => {
      onChange(dragDivider(from, node.id, [a.id, b.id], start, dir === 'row' ? dx : dy))
    })
  }

  return (
    <div
      className={`frame-node frame-split ${dir}${node.title ? ' titled' : ''}${edgeClass(props.edges.get(node.id))}`}
    >
      {node.title && <GroupHead node={node} tree={tree} onChange={onChange} />}
      <div className={`frame-children ${dir}`}>
        {shown.map((c, i) => {
          const next = shown[i + 1]
          const canDrag = next !== undefined && draggable(c, next, dir, sizing)
          return (
            <div key={c.id} className="frame-cell" style={cellStyle(c, node, shown, sizing)}>
              <Node {...props} node={c} parent={node} />
              {canDrag && (
                <div
                  className={`frame-divider ${dir}`}
                  onPointerDown={(e) => startDrag(e, c, next)}
                />
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

/**
 * A divider moves between two neighbours when both can change size, or when
 * one fits its content and the other has a pixel size.
 */
function draggable(
  a: FrameNode,
  b: FrameNode,
  dir: 'row' | 'column',
  sizing: SizingContext
): boolean {
  if (dir === 'column' && (a.collapsed === true || b.collapsed === true)) return false
  const sa = cellSize(a, sizing, dir)
  const sb = cellSize(b, sizing, dir)
  if (sa === 'auto' && sb === 'auto') return false
  if (sa === 'auto') return typeof sb === 'number'
  if (sb === 'auto') return typeof sa === 'number'
  return true
}

function Tabs(props: NodeProps & { node: FrameTabs }): React.JSX.Element {
  const { node, state, tree, onChange, widgets, onReloadWidget } = props
  const shown = node.children.filter((c) => isShown(c, state))
  const active = activeChild(node, state)
  const activeWidget = active?.type === 'panel' ? active.widget : undefined
  return (
    <div className={`frame-node frame-tabs${edgeClass(props.edges.get(node.id))}`}>
      <GroupHead node={node} tree={tree} onChange={onChange}>
        <div className="frame-tab-strip" role="tablist">
          {shown.map((c) => (
            <button
              type="button"
              tabIndex={-1}
              role="tab"
              key={c.id}
              aria-selected={c === active}
              className={c === active ? 'on' : ''}
              onClick={() => onChange(setActiveTab(tree, node.id, c.id))}
            >
              {nodeLabel(c, widgets)}
            </button>
          ))}
        </div>
        {activeWidget && (
          <button
            type="button"
            tabIndex={-1}
            className="icon"
            title="Reload widget"
            onClick={() => onReloadWidget(activeWidget)}
          >
            ↻
          </button>
        )}
      </GroupHead>
      {shown.map((c) => (
        <div key={c.id} className={`frame-cell tab-page${c === active ? '' : ' hidden'}`}>
          <Node {...props} node={c} parent={node} />
        </div>
      ))}
    </div>
  )
}

function Panel(props: NodeProps & { node: FramePanel }): React.JSX.Element {
  const { node, parent, tree, onChange, visible, widgets, contentHeights, onReloadWidget } = props
  const edges = props.edges.get(node.id) ?? NO_EDGES
  const inTabs = parent?.type === 'tabs'
  const canCollapse = parent?.type === 'split' && parent.direction === 'column'
  const collapsed = isFolded(node, parent)
  const toggle = (): void => {
    onChange(toggleCollapsed(tree, node.id))
  }
  const cls = `frame-node frame-panel panel-${node.panel}${collapsed ? ' collapsed' : ''}${edgeClass(edges)}`

  if (node.panel === 'workspace') {
    return (
      <section className={cls}>
        <div className="frame-slot" style={{ ['--slot' as string]: slotName('workspace') }} />
      </section>
    )
  }

  if (node.panel === 'widget' && node.widget) {
    const id = node.widget
    const info = widgets.get(id)
    const height = contentHeights[id]
    const content = info?.manifest?.sizing === 'content'
    return (
      <section className={cls} data-widget={id}>
        {!inTabs && (
          <PanelHead
            label={panelLabel(node, widgets)}
            title={info?.dir}
            collapsed={collapsed}
            onToggle={canCollapse ? toggle : undefined}
          >
            <button
              type="button"
              tabIndex={-1}
              className="icon"
              title="Reload widget"
              onClick={() => onReloadWidget(id)}
            >
              ↻
            </button>
          </PanelHead>
        )}
        {!collapsed &&
          (info?.manifest ? (
            <div
              className={`frame-slot${content ? ' content' : ''}`}
              style={{
                ['--slot' as string]: slotName(`w-${id}`),
                ...(content ? { height: height ?? 80 } : {})
              }}
            />
          ) : (
            <div className="widget-error">
              <strong>{id} could not be loaded</strong>
              <p>{info?.error ?? 'It is not installed.'}</p>
              {info && <p className="widget-dir">{info.dir}</p>}
            </div>
          ))}
      </section>
    )
  }

  const place: PanelPlace = {
    edges,
    visible: visible.has(node.id),
    collapsed,
    canCollapse,
    toggleCollapsed: toggle
  }
  const titled = node.panel === 'monitor' && !inTabs
  return (
    <section className={cls}>
      {titled && (
        <PanelHead
          label={panelLabel(node, widgets)}
          collapsed={collapsed}
          onToggle={canCollapse ? toggle : undefined}
        />
      )}
      {!(titled && collapsed) && props.renderPanel(node, place)}
    </section>
  )
}

function PanelHead({
  label,
  title,
  collapsed,
  onToggle,
  children
}: {
  label: string
  title?: string
  collapsed: boolean
  onToggle?: () => void
  children?: React.ReactNode
}): React.JSX.Element {
  return (
    <header className="frame-head panel-head">
      {onToggle ? (
        <button
          type="button"
          tabIndex={-1}
          className="widget-toggle"
          aria-expanded={!collapsed}
          title={collapsed ? 'Expand' : 'Collapse'}
          onClick={onToggle}
        >
          {collapsed ? '▸' : '▾'}
        </button>
      ) : (
        <span className="panel-head-pad" />
      )}
      <span className="frame-title" title={title}>
        {label}
      </span>
      {children}
    </header>
  )
}
