import { useEffect, useRef, useState } from 'react'
import type { MenuItem, PaneSession } from '@shared/ipc'
import { taskAt, type TaskInfo } from '@shared/tasks'
import {
  contextLimit,
  contextPressure,
  formatDuration,
  formatTokens,
  sessionActiveMs,
  STATUS_LABEL,
  type ContextPressure
} from '../sessions'
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
  /** Send `/compact` to an agent pane to reduce context pressure. */
  onCompact?: (paneId: string) => void
  /** Open a fresh pane in the same directory with the same preset. */
  onFreshPane?: (session: PaneSession) => void
  /** Open (or focus) a split web pane beside a session at a detected local server URL. */
  onOpenPort: (paneId: string, url: string) => void
  /** Close a background run's pane. Missing in a window without terminals. */
  onDismiss?: (paneId: string) => void
  /** Approve a waiting pane's prompt without switching tabs (sends Enter). */
  onApprove?: (paneId: string) => void
  /** Deny or cancel a waiting pane's prompt without switching tabs (sends Esc). */
  onDeny?: (paneId: string) => void
  /** Send a quick text reply to a waiting pane without switching tabs. */
  onReply?: (paneId: string, text: string) => void
  /** Return keyboard focus to the active workspace after closing inline reply. */
  onDone?: () => void
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
  onOpenPort,
  onDismiss,
  onApprove,
  onDeny,
  onReply,
  onDone,
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
              onCompact={onCompact}
              onFreshPane={onFreshPane}
              onOpenPort={onOpenPort}
              onApprove={onApprove}
              onDeny={onDeny}
              onReply={onReply}
              onDone={onDone}
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
              onCompact={onCompact}
              onFreshPane={onFreshPane}
              onOpenPort={onOpenPort}
              onDismiss={onDismiss}
              onApprove={onApprove}
              onDeny={onDeny}
              onReply={onReply}
              onDone={onDone}
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
  onCompact?: (paneId: string) => void
  onFreshPane?: (session: PaneSession) => void
  onOpenPort: (paneId: string, url: string) => void
  /** Shown as a close button: a background run is dismissed, not opened. */
  onDismiss?: (paneId: string) => void
  onApprove?: (paneId: string) => void
  onDeny?: (paneId: string) => void
  onReply?: (paneId: string, text: string) => void
  onDone?: () => void
}

/** Buttons keep keyboard focus in the user's current terminal. */
const keepFocus = (e: React.MouseEvent): void => {
  e.preventDefault()
}

function contextTooltip(session: PaneSession, pressure: ContextPressure): string {
  const lines = [
    `Context: ${formatTokens(pressure.tokens)} / ${formatTokens(pressure.limit)} (${String(pressure.percent)}%)`
  ]
  if (session.model) lines.push(session.model)
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
  sessions,
  tasks,
  onSelect,
  onCompact,
  onFreshPane,
  onOpenPort,
  onDismiss,
  onApprove,
  onDeny,
  onReply,
  onDone
}: RowProps): React.JSX.Element {
  const [replying, setReplying] = useState(false)
  const [draft, setDraft] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const waiting = s.status === 'needs-input'
  const showReply = replying && waiting
  const canTriage =
    waiting && (onApprove !== undefined || onDeny !== undefined || onReply !== undefined)

  useEffect(() => {
    if (showReply) inputRef.current?.focus()
  }, [showReply])

  const closeReply = (): void => {
    setReplying(false)
    setDraft('')
    onDone?.()
  }

  const submitReply = (): void => {
    const text = draft.trim()
    if (!text || !onReply) return
    onReply(s.id, text)
    setReplying(false)
    setDraft('')
    onDone?.()
  }

  const task = taskAt(tasks, s.cwd)
  const pr = task?.pr ?? null
  const run = s.background
  const detail = waiting ? s.message : (run?.input ?? s.title)
  const where = task ? `${task.branch ?? 'detached'} · task in ${task.repo}\n${s.cwd}` : s.cwd
  const pressure = contextPressure(s.tokens, contextLimit(s.model, s.tokens))
  const canCompact = Boolean(onCompact && s.agent !== null && s.status !== 'exited')
  const elevated = pressure !== null && pressure.tone !== 'normal'
  const showCompactBtn = elevated && canCompact

  const openMenu = (e: React.MouseEvent): void => {
    e.preventDefault()
    const items: MenuItem[] = [{ id: 'focus', label: 'Focus pane' }]
    if (waiting && (onApprove || onDeny || onReply)) {
      items.push({ type: 'separator' })
      if (onApprove) items.push({ id: 'approve', label: 'Approve (Enter)' })
      if (onDeny) items.push({ id: 'deny', label: 'Deny (Esc)' })
      if (onReply) items.push({ id: 'reply', label: 'Quick reply…' })
    }
    if (canCompact || onFreshPane) {
      items.push({ type: 'separator' })
      if (canCompact) items.push({ id: 'compact', label: 'Compact (/compact)' })
      if (onFreshPane) items.push({ id: 'fresh', label: 'Open fresh pane' })
    }
    void window.cockpit.menu(items).then((choice) => {
      if (choice === 'focus') onSelect(s.id)
      else if (choice === 'approve') onApprove?.(s.id)
      else if (choice === 'deny') onDeny?.(s.id)
      else if (choice === 'reply') setReplying(true)
      else if (choice === 'compact') onCompact?.(s.id)
      else if (choice === 'fresh') onFreshPane?.(s)
    })
  }

  return (
    <li className={waiting ? 'session-item waiting' : 'session-item'} onContextMenu={openMenu}>
      <div className={run || showCompactBtn ? 'session-run' : undefined}>
        <button
          type="button"
          tabIndex={-1}
          className={`session${s.focused ? ' focused' : ''}`}
          title={
            s.message ??
            (run ? `${run.label}: ${s.name} in ${where}\nClick to open in a tab` : where)
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
            onMouseDown={keepFocus}
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
      </div>
      {canTriage && (
        <div className="session-triage">
          {showReply ? (
            <form
              className="session-reply"
              onSubmit={(e) => {
                e.preventDefault()
                submitReply()
              }}
            >
              <input
                ref={inputRef}
                type="text"
                value={draft}
                placeholder="Quick reply…"
                aria-label={`Reply to ${run?.label ?? s.name}`}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') {
                    e.preventDefault()
                    closeReply()
                  }
                }}
              />
              <button
                type="submit"
                tabIndex={-1}
                disabled={!draft.trim()}
                title="Send reply without switching tabs"
                onMouseDown={keepFocus}
              >
                Send
              </button>
              <button
                type="button"
                tabIndex={-1}
                title="Cancel"
                onMouseDown={keepFocus}
                onClick={closeReply}
              >
                ×
              </button>
            </form>
          ) : (
            <div className="session-triage-actions">
              {onApprove && (
                <button
                  type="button"
                  tabIndex={-1}
                  className="approve"
                  title="Approve (sends Enter without switching tabs)"
                  onMouseDown={keepFocus}
                  onClick={() => onApprove(s.id)}
                >
                  ✓ Approve
                </button>
              )}
              {onDeny && (
                <button
                  type="button"
                  tabIndex={-1}
                  className="deny"
                  title="Deny (sends Esc without switching tabs)"
                  onMouseDown={keepFocus}
                  onClick={() => onDeny(s.id)}
                >
                  ✕ Deny
                </button>
              )}
              {onReply && (
                <button
                  type="button"
                  tabIndex={-1}
                  title="Send a quick reply without switching tabs"
                  onClick={() => setReplying(true)}
                >
                  Reply
                </button>
              )}
              <button
                type="button"
                tabIndex={-1}
                title="Focus pane"
                onMouseDown={keepFocus}
                onClick={() => onSelect(s.id)}
              >
                Focus
              </button>
            </div>
          )}
        </div>
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
