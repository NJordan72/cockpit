import { useEffect } from 'react'
import type { Preset } from '@shared/config'
import type { MenuItem, PaneSession } from '@shared/ipc'
import { mergedAndClean, type TaskInfo } from '@shared/tasks'
import { prChip, prTone, sessionsByTask, sessionToShow, taskMeta } from './model'

interface Props {
  tasks: readonly TaskInfo[]
  sessions: readonly PaneSession[]
  presets: readonly Preset[]
  visible: boolean
  onNew: () => void
  /** Open a tab in the task's worktree running the preset (the start screen's agent if none). */
  onOpen: (task: TaskInfo, presetId?: string) => void
  /** Show a pane that's open in a task. */
  onReveal: (paneId: string) => void
}

/** Every task's worktree, newest first, with its pull request and what's open in it. */
export function TasksPanel({
  tasks,
  sessions,
  presets,
  visible,
  onNew,
  onOpen,
  onReveal
}: Props): React.JSX.Element {
  const api = window.cockpit
  const open = sessionsByTask(tasks, sessions)
  const merged = tasks.filter(mergedAndClean).length
  // gh's complaint, when it has the same one about every task (not installed, logged out).
  const errors = new Set(tasks.map((t) => t.prError))
  const ghError = tasks.length > 0 && errors.size === 1 ? [...errors][0] : null

  // Fresh pull request states when the panel comes into view.
  useEffect(() => {
    if (visible) api.tasks.refresh()
  }, [api, visible])

  const show = (task: TaskInfo): void => {
    const s = sessionToShow(open.get(task.path) ?? [])
    if (s) onReveal(s.id)
    else onOpen(task)
  }

  const menu = async (task: TaskInfo): Promise<void> => {
    const items: MenuItem[] = [
      {
        label: 'Open in a new tab',
        submenu: presets.map((p) => ({ id: `open:${p.id}`, label: p.name }))
      },
      ...(task.pr ? [{ id: 'pr', label: `Open pull request #${String(task.pr.number)}` }] : []),
      { id: 'editor', label: 'Open in editor' },
      { type: 'separator' },
      { id: 'copy-path', label: 'Copy path' },
      ...(task.branch ? [{ id: 'copy-branch', label: 'Copy branch name' }] : []),
      { type: 'separator' },
      { id: 'remove', label: 'Remove…' }
    ]
    const chosen = await api.menu(items)
    if (chosen?.startsWith('open:')) onOpen(task, chosen.slice('open:'.length))
    else if (chosen === 'pr' && task.pr) api.prs.open(task.pr.url)
    else if (chosen === 'editor') api.editor.openFile(task.path)
    else if (chosen === 'copy-path') api.clipboard.writeText(task.path)
    else if (chosen === 'copy-branch' && task.branch) api.clipboard.writeText(task.branch)
    else if (chosen === 'remove') void api.tasks.remove(task.path)
  }

  return (
    <div className="tasks">
      <div className="activity-toolbar">
        <button type="button" tabIndex={-1} className="activity-chip" onClick={onNew}>
          + New task
        </button>
        <button
          type="button"
          tabIndex={-1}
          className="activity-chip"
          disabled={merged === 0}
          title="Remove the tasks whose pull request merged, with nothing newer in them"
          onClick={() => void api.tasks.cleanUp()}
        >
          Clean up merged{merged > 0 ? ` (${String(merged)})` : ''}
        </button>
        <button
          type="button"
          tabIndex={-1}
          className="prs-refresh"
          title="Refresh"
          onClick={() => api.tasks.refresh(true)}
        >
          ⟳
        </button>
      </div>
      {tasks.length === 0 ? (
        <p className="activity-empty">
          No tasks. A task is a branch in a worktree of its own, so agents don&apos;t share files.
        </p>
      ) : (
        <ol className="prs-list">
          {tasks.map((t) => {
            const here = open.get(t.path) ?? []
            const status = sessionToShow(here)?.status
            return (
              <li key={t.path}>
                <button
                  type="button"
                  tabIndex={-1}
                  className={`prs-row task-row${here.some((s) => s.focused) ? ' focused' : ''}`}
                  title={`${t.path}\n${here.length > 0 ? 'Click to show it' : 'Click to open it'}; right-click for more`}
                  onClick={() => show(t)}
                  onContextMenu={(e) => {
                    e.preventDefault()
                    void menu(t)
                  }}
                >
                  <span className={`status-dot ${status ?? 'exited'}`} />
                  <span className="prs-title">{t.branch ?? `(detached) ${t.path}`}</span>
                  {t.pr ? (
                    <span className={`task-pr ${prTone(t.pr)}`} title={t.pr.title}>
                      {prChip(t.pr)}
                    </span>
                  ) : (
                    <span className="task-pr muted">no PR</span>
                  )}
                  <span className="prs-meta">{taskMeta(t, here.length)}</span>
                </button>
              </li>
            )
          })}
        </ol>
      )}
      {ghError && <p className="activity-empty task-gh">gh: {ghError}</p>}
    </div>
  )
}
