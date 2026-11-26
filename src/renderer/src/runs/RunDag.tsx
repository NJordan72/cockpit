import { useId, useMemo } from 'react'
import type { ItemState, RunItem } from '@shared/runs'
import { layoutDag } from './dag'
import { itemDot, phaseLabel } from './model'

interface Props {
  items: readonly RunItem[]
  /** Live states by item id when viewing an active run; omitted in RunDialog. */
  states?: Readonly<Record<string, ItemState>>
  onSelect?: (itemId: string) => void
  onContextMenu?: (itemId: string, e: React.MouseEvent) => void
}

function clip(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text
}

/** Compact SVG dependency graph showing topological tiers, edges, and live phase colors. */
export function RunDag({ items, states, onSelect, onContextMenu }: Props): React.JSX.Element {
  const layout = useMemo(() => layoutDag(items), [items])
  const arrowId = useId()

  return (
    <div className="run-dag">
      <svg
        width={layout.width}
        height={layout.height}
        viewBox={`0 0 ${String(layout.width)} ${String(layout.height)}`}
        role="img"
        aria-label={`Dependency graph with ${String(layout.nodes.length)} items across ${String(layout.tiers)} ${layout.tiers === 1 ? 'tier' : 'tiers'}`}
      >
        <defs>
          <marker
            id={arrowId}
            viewBox="0 0 8 8"
            refX="7"
            refY="4"
            markerWidth="5"
            markerHeight="5"
            orient="auto"
          >
            <path d="M 0 1 L 7 4 L 0 7 z" className="run-dag-arrow" />
          </marker>
        </defs>
        {layout.edges.map((edge) => {
          const fromPhase = states?.[edge.from]?.phase
          return (
            <path
              key={`${edge.from}->${edge.to}`}
              d={edge.path}
              className={`run-dag-edge${fromPhase === 'done' ? ' done' : ''}`}
              markerEnd={`url(#${arrowId})`}
            />
          )
        })}
        {layout.nodes.map((node) => {
          const s = states?.[node.id]
          const phase = s ? s.phase : 'draft'
          const dot = s ? itemDot(s) : 'idle'
          const interactive = Boolean(onSelect ?? onContextMenu)
          const tip = s
            ? `${node.id}: ${node.title} (${phaseLabel(s)}${s.pr ? ` · #${String(s.pr.number)}` : ''})`
            : `${node.id}: ${node.title}${node.external ? ' (outside the run)' : ''}`
          return (
            <g
              key={node.id}
              transform={`translate(${String(node.x)}, ${String(node.y)})`}
              className={`run-dag-node phase-${phase}${node.external ? ' external' : ''}${interactive ? ' interactive' : ''}`}
              onClick={onSelect ? () => onSelect(node.id) : undefined}
              onContextMenu={
                onContextMenu
                  ? (e) => {
                      e.preventDefault()
                      onContextMenu(node.id, e)
                    }
                  : undefined
              }
            >
              <title>{tip}</title>
              <rect width={node.width} height={node.height} rx={5} ry={5} />
              <circle cx={10} cy={12} r={3.5} className={`run-dag-dot ${dot}`} />
              <text x={19} y={15} className="run-dag-id">
                {clip(node.id, 15)}
              </text>
              <text x={8} y={29} className="run-dag-title">
                {clip(node.title, 19)}
              </text>
            </g>
          )
        })}
      </svg>
    </div>
  )
}
