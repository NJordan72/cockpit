import type { PaneSession } from '@shared/ipc'
import { taskAt, type TaskInfo } from '@shared/tasks'
import { formatTokens, STATUS_LABEL } from '../sessions'
import { prChip, prTone } from '../tasks/model'

interface Props {
  sessions: PaneSession[]
  /** A session in a task's worktree shows its branch and pull request. */
  tasks: readonly TaskInfo[]
  collapsed: boolean
  /** Missing where the panel can't fold (outside a column). */
  onToggle?: () => void
  onSelect: (paneId: string) => void
  onHidePanels: () => void
}

const basename = (p: string): string =>
  p === '~' ? '~' : (p.split('/').filter(Boolean).pop() ?? p)

/** Every pane with its status. Clicking one focuses it. */
export function SessionList({
  sessions,
  tasks,
  collapsed,
  onToggle,
  onSelect,
  onHidePanels
}: Props): React.JSX.Element {
  const waiting = sessions.filter((s) => s.status === 'needs-input').length
  return (
    <section className={`sessions${collapsed ? ' collapsed' : ''}`} aria-label="Sessions">
      <header className="sidebar-head frame-head">
        {onToggle && (
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
        )}
        <span className="sidebar-title">
          Sessions
          {waiting > 0 && <span className="sessions-waiting"> · {waiting} waiting</span>}
        </span>
        <button
          type="button"
          tabIndex={-1}
          className="icon"
          title="Hide panels"
          onClick={onHidePanels}
        >
          ⟩
        </button>
      </header>
      {!collapsed && (
        <ul className="session-list">
          {sessions.map((s) => {
            const task = taskAt(tasks, s.cwd)
            const pr = task?.pr ?? null
            return (
              <li key={s.id}>
                <button
                  type="button"
                  tabIndex={-1}
                  className={`session${s.focused ? ' focused' : ''}`}
                  title={
                    s.message ??
                    (task ? `${task.branch ?? 'detached'} · task in ${task.repo}\n${s.cwd}` : s.cwd)
                  }
                  onClick={() => onSelect(s.id)}
                >
                  <span className={`status-dot ${s.status}`} />
                  <span className="session-main">
                    <span className="session-name">
                      {s.name}{' '}
                      <span className="session-dir">
                        · {task?.branch ? `⎇ ${task.branch}` : basename(s.cwd)}
                      </span>
                    </span>
                    {(s.status === 'needs-input' ? s.message : s.title) && (
                      <span className="session-detail">
                        {s.status === 'needs-input' ? s.message : s.title}
                      </span>
                    )}
                  </span>
                  <span className="session-meta">
                    <span className={`session-status ${s.status}`}>{STATUS_LABEL[s.status]}</span>
                    {(pr !== null || s.tokens !== null) && (
                      <span className="session-meta-row">
                        {pr && (
                          <span className={`task-pr ${prTone(pr)}`} title={pr.title}>
                            {prChip(pr)}
                          </span>
                        )}
                        {s.tokens !== null && (
                          <span className="session-tokens" title="Tokens in context">
                            {formatTokens(s.tokens)}
                          </span>
                        )}
                      </span>
                    )}
                  </span>
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
