import type { MenuItem, PaneSession } from '@shared/ipc'
import { taskAt, type TaskInfo } from '@shared/tasks'
import {
  contextPressure,
  formatDuration,
  formatTokens,
  sessionActiveMs,
  STATUS_LABEL,
  type ContextPressure
} from '../sessions'
import { prChip, prTone } from '../tasks/model'

interface Props {
  sessions: PaneSession[]
  /** A session in a task's worktree shows its branch and pull request. */
  tasks: readonly TaskInfo[]
  collapsed: boolean
  /** Missing where the panel can't fold (outside a column). */
  onToggle?: () => void
  onSelect: (paneId: string) => void
  /** Send `/compact` to an agent pane to reduce context pressure. */
  onCompact?: (paneId: string) => void
  /** Open a fresh pane in the same directory with the same preset. */
  onFreshPane?: (session: PaneSession) => void
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
  onCompact,
  onFreshPane,
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
              tasks={tasks}
              onSelect={onSelect}
              onCompact={onCompact}
              onFreshPane={onFreshPane}
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
              tasks={tasks}
              onSelect={onSelect}
              onCompact={onCompact}
              onFreshPane={onFreshPane}
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
  tasks: readonly TaskInfo[]
  onSelect: (paneId: string) => void
  onCompact?: (paneId: string) => void
  onFreshPane?: (session: PaneSession) => void
  /** Shown as a close button: a background run is dismissed, not opened. */
  onDismiss?: (paneId: string) => void
}

function contextTooltip(session: PaneSession, pressure: ContextPressure): string {
  const lines = [
    `Context: ${formatTokens(pressure.tokens)} / ${formatTokens(pressure.limit)} (${String(pressure.percent)}%)`
  ]
  const activeMs = sessionActiveMs(session)
  const stats: string[] = []
  if (activeMs >= 1000) stats.push(`Active ${formatDuration(activeMs)}`)
  if (session.toolCalls > 0) {
    stats.push(`${String(session.toolCalls)} ${session.toolCalls === 1 ? 'tool' : 'tools'}`)
  }
  if (stats.length > 0) lines.push(stats.join(' · '))
  if (pressure.tone !== 'normal') lines.push('Right-click to compact or open a fresh pane')
  return lines.join('\n')
}

/** One session. A background run is named for its quick command and shows what it was given. */
function SessionRow({
  session: s,
  tasks,
  onSelect,
  onCompact,
  onFreshPane,
  onDismiss
}: RowProps): React.JSX.Element {
  const task = taskAt(tasks, s.cwd)
  const pr = task?.pr ?? null
  const run = s.background
  const detail = s.status === 'needs-input' ? s.message : (run?.input ?? s.title)
  const where = task ? `${task.branch ?? 'detached'} · task in ${task.repo}\n${s.cwd}` : s.cwd
  const pressure = contextPressure(s.tokens)
  const canCompact = Boolean(onCompact && s.agent !== null && s.status !== 'exited')
  const elevated = pressure !== null && pressure.tone !== 'normal'
  const showCompactBtn = elevated && canCompact

  const openMenu = async (): Promise<void> => {
    const items: MenuItem[] = [
      ...(canCompact ? [{ id: 'compact', label: 'Compact (/compact)' }] : []),
      ...(onFreshPane ? [{ id: 'fresh', label: 'Open fresh pane' }] : []),
      ...(canCompact || onFreshPane ? [{ type: 'separator' as const }] : []),
      { id: 'focus', label: 'Focus pane' }
    ]
    const chosen = await window.cockpit.menu(items)
    if (chosen === 'compact') onCompact?.(s.id)
    else if (chosen === 'fresh') onFreshPane?.(s)
    else if (chosen === 'focus') onSelect(s.id)
  }

  return (
    <li className={run || showCompactBtn ? 'session-run' : undefined}>
      <button
        type="button"
        tabIndex={-1}
        className={`session${s.focused ? ' focused' : ''}`}
        title={
          s.message ?? (run ? `${run.label}: ${s.name} in ${where}\nClick to open in a tab` : where)
        }
        onClick={() => onSelect(s.id)}
        onContextMenu={(e) => {
          e.preventDefault()
          void openMenu()
        }}
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
          {(pr !== null || pressure !== null) && (
            <span className="session-meta-row">
              {pr && (
                <span className={`task-pr ${prTone(pr)}`} title={pr.title}>
                  {prChip(pr)}
                </span>
              )}
              {pressure && (
                <span className="session-ctx" title={contextTooltip(s, pressure)}>
                  <span className={`ctx-bar ${pressure.tone}`} aria-hidden="true">
                    <span
                      className="ctx-bar-fill"
                      style={{ width: `${String(pressure.barPercent)}%` }}
                    />
                  </span>
                  <span className={`session-tokens ${pressure.tone}`}>
                    {formatTokens(pressure.tokens)}
                  </span>
                </span>
              )}
            </span>
          )}
        </span>
      </button>
      {showCompactBtn && (
        <button
          type="button"
          tabIndex={-1}
          className={`session-compact ${pressure.tone}`}
          title={`Context at ${String(pressure.percent)}% — click to send /compact (right-click row for fresh pane)`}
          onClick={() => onCompact?.(s.id)}
        >
          Compact
        </button>
      )}
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
    </li>
  )
}
