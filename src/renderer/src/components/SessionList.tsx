import { useEffect, useRef, useState } from 'react'
import type { MenuItem, PaneSession } from '@shared/ipc'
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
              tasks={tasks}
              onSelect={onSelect}
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
              tasks={tasks}
              onSelect={onSelect}
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
  tasks: readonly TaskInfo[]
  onSelect: (paneId: string) => void
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

/** One session. A background run is named for its quick command and shows what it was given. */
function SessionRow({
  session: s,
  tasks,
  onSelect,
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

  const openMenu = (e: React.MouseEvent): void => {
    if (!waiting) return
    e.preventDefault()
    const items: MenuItem[] = [{ id: 'focus', label: 'Focus pane' }]
    if (onApprove || onDeny || onReply) items.push({ type: 'separator' })
    if (onApprove) items.push({ id: 'approve', label: 'Approve (Enter)' })
    if (onDeny) items.push({ id: 'deny', label: 'Deny (Esc)' })
    if (onReply) items.push({ id: 'reply', label: 'Quick reply…' })
    void window.cockpit.menu(items).then((choice) => {
      if (choice === 'focus') onSelect(s.id)
      else if (choice === 'approve') onApprove?.(s.id)
      else if (choice === 'deny') onDeny?.(s.id)
      else if (choice === 'reply') setReplying(true)
    })
  }

  const task = taskAt(tasks, s.cwd)
  const pr = task?.pr ?? null
  const run = s.background
  const detail = waiting ? s.message : (run?.input ?? s.title)
  const where = task ? `${task.branch ?? 'detached'} · task in ${task.repo}\n${s.cwd}` : s.cwd
  return (
    <li className={waiting ? 'session-item waiting' : 'session-item'} onContextMenu={openMenu}>
      <div className={run ? 'session-run' : undefined}>
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
    </li>
  )
}
