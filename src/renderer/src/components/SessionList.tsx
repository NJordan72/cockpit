import type { PaneSession } from '@shared/ipc'
import { taskAt, type TaskInfo } from '@shared/tasks'
import { formatTokens, STATUS_LABEL } from '../sessions'
import { prChip, prTone } from '../tasks/model'
import { PortPills } from './PortPills'

interface Props {
  sessions: PaneSession[]
  /** A session in a task's worktree shows its branch and pull request. */
  tasks: readonly TaskInfo[]
  collapsed: boolean
  /** Missing where the panel can't fold (outside a column). */
  onToggle?: () => void
  onSelect: (paneId: string) => void
  /** Open (or focus) a split web pane beside a session at a detected local server URL. */
  onOpenPort: (paneId: string, url: string) => void
  /** Close a background run's pane. Missing in a window without terminals. */
  onDismiss?: (paneId: string) => void
  onHidePanels: () => void
}

const basename = (p: string): string =>
  p === '~' ? '~' : (p.split('/').filter(Boolean).pop() ?? p)

/**
 * Every pane with its status, and background runs in a group of their own
 * at the end. Clicking one focuses it, which opens a background run in the
 * tab bar.
 */
export function SessionList({
  sessions,
  tasks,
  collapsed,
  onToggle,
  onSelect,
  onOpenPort,
  onDismiss,
  onHidePanels
}: Props): React.JSX.Element {
  const waiting = sessions.filter((s) => s.status === 'needs-input').length
  const tabbed = sessions.filter((s) => !s.background)
  const background = sessions.filter((s) => s.background)
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
          {tabbed.map((s) => (
            <SessionRow
              key={s.id}
              session={s}
              sessions={sessions}
              tasks={tasks}
              onSelect={onSelect}
              onOpenPort={onOpenPort}
            />
          ))}
          {background.length > 0 && (
            <li className="session-group" aria-hidden="true">
              Background
            </li>
          )}
          {background.map((s) => (
            <SessionRow
              key={s.id}
              session={s}
              sessions={sessions}
              tasks={tasks}
              onSelect={onSelect}
              onOpenPort={onOpenPort}
              onDismiss={onDismiss}
            />
          ))}
        </ul>
      )}
    </section>
  )
}

interface RowProps {
  session: PaneSession
  sessions: readonly PaneSession[]
  tasks: readonly TaskInfo[]
  onSelect: (paneId: string) => void
  onOpenPort: (paneId: string, url: string) => void
  /** Shown as a close button: a background run is dismissed, not opened. */
  onDismiss?: (paneId: string) => void
}

/** One session. A background run is named for its quick command and shows what it was given. */
function SessionRow({
  session: s,
  sessions,
  tasks,
  onSelect,
  onOpenPort,
  onDismiss
}: RowProps): React.JSX.Element {
  const task = taskAt(tasks, s.cwd)
  const pr = task?.pr ?? null
  const run = s.background
  const detail = s.status === 'needs-input' ? s.message : (run?.input ?? s.title)
  const where = task ? `${task.branch ?? 'detached'} · task in ${task.repo}\n${s.cwd}` : s.cwd
  return (
    <li className={run ? 'session-run' : undefined}>
      <button
        type="button"
        tabIndex={-1}
        className={`session${s.focused ? ' focused' : ''}`}
        title={
          s.message ?? (run ? `${run.label}: ${s.name} in ${where}\nClick to open in a tab` : where)
        }
        onClick={() => onSelect(s.id)}
      >
        <span className={`status-dot ${s.status}`} />
        <span className="session-main">
          <span className="session-name">
            {run?.label ?? s.name}{' '}
            <span className="session-dir">
              · {task?.branch ? `⎇ ${task.branch}` : basename(s.cwd)}
            </span>
          </span>
          {detail && <span className="session-detail">{detail}</span>}
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
      {run && onDismiss && (
        <button
          type="button"
          tabIndex={-1}
          className="icon session-dismiss"
          title={s.status === 'working' ? 'Stop and dismiss' : 'Dismiss'}
          onClick={() => onDismiss(s.id)}
        >
          ×
        </button>
      )}
      <PortPills
        items={s.ports.map((server) => ({ paneId: s.id, server }))}
        sessions={sessions}
        className="session-ports"
        onOpenPort={onOpenPort}
      />
    </li>
  )
}
