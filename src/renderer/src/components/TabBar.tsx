import { paneIds, type Layout, type Preset } from '@shared/config'
import type { SessionStatus } from '@shared/widgets'
import { findPane } from '../layout/model'
import type { LayoutAction } from '../layout/reducer'
import { mostUrgent, STATUS_LABEL } from '../sessions'

interface Props {
  layout: Layout
  presets: Preset[]
  statuses: ReadonlyMap<string, SessionStatus>
  dispatch: (a: LayoutAction) => void
  onNewTab: () => void
  onCloseTab: (tabId: string) => void
}

const basename = (p: string): string =>
  p === '~' ? '~' : (p.split('/').filter(Boolean).pop() ?? p)

export function TabBar({
  layout,
  presets,
  statuses,
  dispatch,
  onNewTab,
  onCloseTab
}: Props): React.JSX.Element {
  return (
    <div className="titlebar">
      <div className="tabs" role="tablist">
        {layout.tabs.map((tab, i) => {
          const pane = findPane(tab.root, tab.activePaneId)
          const preset = presets.find((p) => p.id === pane?.presetId)
          const label = pane ? `${preset?.name ?? pane.presetId} · ${basename(pane.cwd)}` : 'Tab'
          const active = tab.id === layout.activeTabId
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
              className={`tab${active ? ' active' : ''}`}
              title={status ? `${pane?.cwd ?? ''} · ${STATUS_LABEL[status]}` : pane?.cwd}
              data-status={status ?? undefined}
              onMouseDown={() => dispatch({ type: 'selectTab', tabId: tab.id })}
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
                onMouseDown={(e) => e.stopPropagation()}
                onClick={() => onCloseTab(tab.id)}
              >
                ×
              </button>
            </div>
          )
        })}
        <button
          type="button"
          tabIndex={-1}
          className="tab-new"
          aria-label="New tab"
          onClick={onNewTab}
        >
          +
        </button>
      </div>
    </div>
  )
}
