import type { Layout, Preset } from '@shared/config'
import { findPane } from '../layout/model'
import type { LayoutAction } from '../layout/reducer'

interface Props {
  layout: Layout
  presets: Preset[]
  dispatch: (a: LayoutAction) => void
  onNewTab: () => void
  onCloseTab: (tabId: string) => void
}

const basename = (p: string): string =>
  p === '~' ? '~' : (p.split('/').filter(Boolean).pop() ?? p)

export function TabBar({
  layout,
  presets,
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
          return (
            <div
              key={tab.id}
              role="tab"
              aria-selected={active}
              className={`tab${active ? ' active' : ''}`}
              title={pane?.cwd}
              onMouseDown={() => dispatch({ type: 'selectTab', tabId: tab.id })}
            >
              <span className="tab-index">{i < 9 ? i + 1 : ''}</span>
              <span className="tab-label">{label}</span>
              <button
                type="button"
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
        <button type="button" className="tab-new" aria-label="New tab" onClick={onNewTab}>
          +
        </button>
      </div>
    </div>
  )
}
