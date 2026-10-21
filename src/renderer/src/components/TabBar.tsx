import { useRef, useState } from 'react'
import { paneIds, type Layout, type Preset } from '@shared/config'
import { pageLabel } from '@shared/web'
import type { SessionStatus } from '@shared/widgets'
import { dragPointer } from '../drag'
import type { KidsStatus } from '../kids/KidsMode'
import { findPane } from '../layout/model'
import type { LayoutAction } from '../layout/reducer'
import { mostUrgent, STATUS_LABEL } from '../sessions'

/** Kids mode's pretend terminal, shown as the active tab while kids mode is on. */
export interface KidsTab {
  label: string
  status: KidsStatus
  exitWord: string
}

interface Props {
  layout: Layout
  presets: Preset[]
  statuses: ReadonlyMap<string, SessionStatus>
  kids: KidsTab | null
  dispatch: (a: LayoutAction) => void
  onNewTab: () => void
  onCloseTab: (tabId: string) => void
}

const basename = (p: string): string =>
  p === '~' ? '~' : (p.split('/').filter(Boolean).pop() ?? p)

/** A tab being dragged along the bar, and the position it would drop into. */
interface TabDrag {
  from: number
  to: number
  /** How far the tab has moved, kept inside the row of tabs. */
  dx: number
  width: number
}

/** How far a press must move before it's a drag, so a slightly shaky click stays a click. */
const DRAG_THRESHOLD_PX = 4

export function TabBar({
  layout,
  presets,
  statuses,
  kids,
  dispatch,
  onNewTab,
  onCloseTab
}: Props): React.JSX.Element {
  const listRef = useRef<HTMLDivElement>(null)
  const [drag, setDrag] = useState<TabDrag | null>(null)

  // Pressing a tab selects it; dragging it along the bar moves it. The other
  // tabs slide aside to show where it will land, and the layout changes once,
  // on release.
  const press = (e: React.PointerEvent<HTMLDivElement>, tabId: string, from: number): void => {
    dispatch({ type: 'selectTab', tabId })
    const tabs = listRef.current?.querySelectorAll<HTMLElement>(':scope > .tab')
    if (e.button !== 0 || !tabs) return
    const rects = [...tabs].map((el) => el.getBoundingClientRect())
    const self = rects[from]
    const first = rects[0]
    const last = rects[rects.length - 1]
    if (!self || !first || !last) return
    const middles = rects.map((r) => r.left + r.width / 2)
    let current: TabDrag | null = null
    dragPointer(
      e,
      (dx) => {
        if (!current && Math.abs(dx) < DRAG_THRESHOLD_PX) return
        const left = Math.min(Math.max(self.left + dx, first.left), last.right - self.width)
        // The dragged tab lands after every other tab whose middle it has passed.
        const middle = left + self.width / 2
        const to = middles.filter((m, i) => i !== from && m < middle).length
        current = { from, to, dx: left - self.left, width: self.width }
        setDrag(current)
      },
      () => {
        setDrag(null)
        if (current && current.to !== from) dispatch({ type: 'moveTab', tabId, index: current.to })
      }
    )
  }

  const offset = (i: number): number => {
    if (!drag) return 0
    if (i === drag.from) return drag.dx
    if (drag.from < i && i <= drag.to) return -drag.width
    if (drag.to <= i && i < drag.from) return drag.width
    return 0
  }

  return (
    <div className="titlebar">
      <div className={`tabs${drag ? ' reordering' : ''}`} role="tablist" ref={listRef}>
        {layout.tabs.map((tab, i) => {
          const pane = findPane(tab.root, tab.activePaneId)
          const preset = presets.find((p) => p.id === pane?.presetId)
          const label = !pane
            ? 'Tab'
            : pane.url
              ? (pane.title ?? pageLabel(pane.url))
              : `${preset?.name ?? pane.presetId} · ${basename(pane.cwd)}`
          const active = !kids && tab.id === layout.activeTabId
          const dx = offset(i)
          // The most urgent status among the tab's panes. Idle is the normal
          // state and gets no badge.
          const status = mostUrgent(
            paneIds(tab.root).flatMap((id) => {
              const s = statuses.get(id)
              return s ? [s] : []
            })
          )
          return (
            <div
              key={tab.id}
              role="tab"
              aria-selected={active}
              className={`tab${active ? ' active' : ''}${drag?.from === i ? ' dragging' : ''}`}
              style={dx ? { transform: `translateX(${dx}px)` } : undefined}
              title={
                status ? `${pane?.cwd ?? ''} · ${STATUS_LABEL[status]}` : (pane?.url ?? pane?.cwd)
              }
              data-status={status ?? undefined}
              onPointerDown={(e) => press(e, tab.id, i)}
            >
              <span className="tab-index">{i < 9 ? i + 1 : ''}</span>
              {status && status !== 'idle' && (
                <span className={`status-dot ${status}`} aria-label={STATUS_LABEL[status]} />
              )}
              <span className="tab-label">{label}</span>
              <button
                type="button"
                tabIndex={-1}
                className="tab-close"
                aria-label="Close tab"
                onPointerDown={(e) => e.stopPropagation()}
                onClick={() => onCloseTab(tab.id)}
              >
                ×
              </button>
            </div>
          )
        })}
        {kids ? (
          <div role="tab" aria-selected className="tab active kids-tab">
            <span className="tab-index">
              {layout.tabs.length < 9 ? layout.tabs.length + 1 : ''}
            </span>
            {kids.status !== 'idle' && <span className={`status-dot ${kids.status}`} />}
            <span className="tab-label">{kids.label}</span>
          </div>
        ) : (
          <button
            type="button"
            tabIndex={-1}
            className="tab-new"
            aria-label="New tab"
            onClick={onNewTab}
          >
            +
          </button>
        )}
      </div>
      {kids && (
        <span className="kids-hint">
          type <b>{kids.exitWord}</b> to leave
        </span>
      )}
    </div>
  )
}
