import type { PaneSession } from '@shared/ipc'
import { formatTokens, STATUS_LABEL } from '../sessions'

interface Props {
  sessions: PaneSession[]
  collapsed: boolean
  onToggle: () => void
  onSelect: (paneId: string) => void
  onHideSidebar: () => void
}

const basename = (p: string): string =>
  p === '~' ? '~' : (p.split('/').filter(Boolean).pop() ?? p)

/** Every pane with its status, at the top of the sidebar. Clicking one focuses it. */
export function SessionList({
  sessions,
  collapsed,
  onToggle,
  onSelect,
  onHideSidebar
}: Props): React.JSX.Element {
  const waiting = sessions.filter((s) => s.status === 'needs-input').length
  return (
    <section className={`sessions${collapsed ? ' collapsed' : ''}`} aria-label="Sessions">
      <header className="sidebar-head">
        <button
          type="button"
          tabIndex={-1}
          className="widget-toggle"
          aria-expanded={!collapsed}
          title={collapsed ? 'Show sessions' : 'Hide sessions'}
          onClick={onToggle}
        >
          {collapsed ? '▸' : '▾'}
        </button>
        <span className="sidebar-title">
          Sessions
          {waiting > 0 && <span className="sessions-waiting"> · {waiting} waiting</span>}
        </span>
        <button
          type="button"
          tabIndex={-1}
          className="icon"
          title="Hide sidebar"
          onClick={onHideSidebar}
        >
          ⟩
        </button>
      </header>
      {!collapsed && (
        <ul className="session-list">
          {sessions.map((s) => (
            <li key={s.id}>
              <button
                type="button"
                tabIndex={-1}
                className={`session${s.focused ? ' focused' : ''}`}
                title={s.message ?? s.cwd}
                onClick={() => onSelect(s.id)}
              >
                <span className={`status-dot ${s.status}`} />
                <span className="session-main">
                  <span className="session-name">
                    {s.name} <span className="session-dir">· {basename(s.cwd)}</span>
                  </span>
                  {(s.status === 'needs-input' ? s.message : s.title) && (
                    <span className="session-detail">
                      {s.status === 'needs-input' ? s.message : s.title}
                    </span>
                  )}
                </span>
                <span className="session-meta">
                  <span className={`session-status ${s.status}`}>{STATUS_LABEL[s.status]}</span>
                  {s.tokens !== null && (
                    <span className="session-tokens" title="Tokens in context">
                      {formatTokens(s.tokens)}
                    </span>
                  )}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
