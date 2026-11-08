import type { Preset } from '@shared/config'
import type { MenuItem, PaneSession } from '@shared/ipc'
import type { RunAction, RunItemView, RunView } from '@shared/runs'
import { sessionToShow } from '../tasks/model'
import { itemDot, itemMeta, phaseLabel, runMeta, sessionsIn } from './model'

interface Props {
  runs: readonly RunView[]
  sessions: readonly PaneSession[]
  presets: readonly Preset[]
  /** Show a pane that's open in an item's worktree. */
  onReveal: (paneId: string) => void
  /** Open a tab in an item's worktree running the preset. */
  onOpen: (path: string, presetId: string) => void
  /** Open an item's pull request in a pane, from its worktree. */
  onOpenPr: (url: string, cwd: string, title: string) => void
}

/** Every run Cockpit is working through, newest first, with each item in the order it can start. */
export function RunsPanel({
  runs,
  sessions,
  presets,
  onReveal,
  onOpen,
  onOpenPr
}: Props): React.JSX.Element {
  const api = window.cockpit

  const act = (run: RunView, action: RunAction, itemId?: string): void => {
    void api.runs.act(run.id, action, itemId).then((r) => {
      if (!r.ok) console.warn(`runs: ${r.error}`)
    })
  }

  const show = (run: RunView, item: RunItemView): void => {
    const s = item.state
    const open = sessionToShow(sessionsIn(item, sessions))
    if (open) onReveal(open.id)
    else if (s.pr && s.path && (s.phase === 'review' || s.phase === 'done')) {
      onOpenPr(s.pr.url, s.path, s.pr.title)
    } else if (s.path && !item.external) onOpen(s.path, item.presetId ?? run.presetId)
  }

  const itemMenu = async (run: RunView, item: RunItemView): Promise<void> => {
    const s = item.state
    const startable = !item.external && !run.cancelled
    const items: MenuItem[] = [
      {
        id: 'startNow',
        label: 'Start now',
        enabled: startable && (s.phase === 'waiting' || s.phase === 'ready')
      },
      { id: 'markDone', label: 'Mark done', enabled: s.phase !== 'done' },
      { id: 'retry', label: 'Retry', enabled: startable && s.phase === 'stuck' },
      { type: 'separator' },
      ...(item.url ? [{ id: 'open', label: 'Open' }] : []),
      ...(s.pr ? [{ id: 'pr', label: `Open pull request #${String(s.pr.number)}` }] : []),
      ...(!item.external ? [{ id: 'copy-branch', label: 'Copy branch name' }] : [])
    ]
    const chosen = await api.menu(items)
    if (chosen === 'startNow' || chosen === 'markDone' || chosen === 'retry') {
      act(run, chosen, item.id)
    } else if (chosen === 'open' && item.url) api.web.openExternal(item.url)
    else if (chosen === 'pr' && s.pr) api.prs.open(s.pr.url)
    else if (chosen === 'copy-branch' && !item.external) api.clipboard.writeText(item.branch)
  }

  const runMenu = async (run: RunView): Promise<void> => {
    const items: MenuItem[] = [
      run.paused
        ? { id: 'resume', label: 'Resume', enabled: !run.cancelled }
        : { id: 'pause', label: 'Pause', enabled: !run.cancelled && !run.finished },
      { id: 'cancel', label: 'Cancel run', enabled: !run.cancelled && !run.finished },
      { type: 'separator' },
      { id: 'remove', label: 'Remove', enabled: run.cancelled || run.finished }
    ]
    const chosen = await api.menu(items)
    if (chosen === 'pause' || chosen === 'resume' || chosen === 'cancel' || chosen === 'remove') {
      act(run, chosen)
    }
  }

  if (runs.length === 0) {
    return (
      <div className="tasks runs">
        <p className="activity-empty">
          No runs. A run starts each of a set of tasks once the tasks it waits on are done. The
          Shortcut widget&apos;s Burn down epic, or <code>cockpit-run submit</code> in a terminal,
          submits one.
        </p>
      </div>
    )
  }

  return (
    <div className="tasks runs">
      <ol className="prs-list">
        {runs.map((run) => (
          <li key={run.id} className="run">
            <div
              className="run-head"
              onContextMenu={(e) => {
                e.preventDefault()
                void runMenu(run)
              }}
            >
              <span className="prs-title run-title" title={`${run.title}\nRight-click for more`}>
                {run.title}
              </span>
              {!run.cancelled && !run.finished && (
                <button
                  type="button"
                  tabIndex={-1}
                  className="activity-chip"
                  onClick={() => act(run, run.paused ? 'resume' : 'pause')}
                >
                  {run.paused ? 'Resume' : 'Pause'}
                </button>
              )}
              <button
                type="button"
                tabIndex={-1}
                className="prs-refresh"
                title="More"
                onClick={() => void runMenu(run)}
              >
                ⋯
              </button>
              <span className="prs-meta run-meta">{runMeta(run)}</span>
            </div>
            <ol className="run-items">
              {run.items.map((item) => (
                <li key={item.id}>
                  <button
                    type="button"
                    tabIndex={-1}
                    className={`prs-row task-row run-row phase-${item.state.phase}`}
                    title={`${item.id}: ${item.title}\nClick to show it; right-click for more`}
                    onClick={() => show(run, item)}
                    onContextMenu={(e) => {
                      e.preventDefault()
                      void itemMenu(run, item)
                    }}
                  >
                    <span className={`status-dot ${itemDot(item.state)}`} />
                    <span className="prs-title">{item.title}</span>
                    <span className={`task-pr run-phase ${item.state.phase}`}>
                      {phaseLabel(item.state)}
                    </span>
                    <span className="prs-meta">
                      {item.id} · {itemMeta(item, run)}
                      {!item.external && item.presetId && item.presetId !== run.presetId
                        ? ` · ${presets.find((p) => p.id === item.presetId)?.name ?? item.presetId}`
                        : ''}
                    </span>
                  </button>
                </li>
              ))}
            </ol>
          </li>
        ))}
      </ol>
    </div>
  )
}
