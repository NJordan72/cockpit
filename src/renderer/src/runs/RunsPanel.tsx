import { useState } from 'react'
import type { Preset } from '@shared/config'
import type { MenuItem, PaneSession } from '@shared/ipc'
import { runItemFields, type ItemAction } from '@shared/itemActions'
import type { RunAction, RunItemView, RunView } from '@shared/runs'
import { actionMenu, type PromptRequest } from '../itemActions'
import { sessionToShow } from '../tasks/model'
import { itemDot, itemMeta, phaseLabel, runMeta, sessionsIn } from './model'
import { RunDag } from './RunDag'

interface Props {
  runs: readonly RunView[]
  sessions: readonly PaneSession[]
  presets: readonly Preset[]
  /** config.json's itemActions.runItem: what an item's right-click menu can send about it. */
  actions: readonly ItemAction[]
  /** Show a pane that's open in an item's worktree. */
  onReveal: (paneId: string) => void
  /** Open a tab in an item's worktree running the preset, optionally resuming its last session. */
  onOpen: (path: string, presetId: string, resume?: boolean | 'last') => void
  /** Open an item's pull request in a pane, from its worktree. */
  onOpenPr: (url: string, cwd: string, title: string) => void
  onPrompt: (req: PromptRequest) => void
}

/** Every run Cockpit is working through, newest first, with each item in the order it can start. */
export function RunsPanel({
  runs,
  sessions,
  presets,
  actions,
  onReveal,
  onOpen,
  onOpenPr,
  onPrompt
}: Props): React.JSX.Element {
  const api = window.cockpit
  const [graphRuns, setGraphRuns] = useState<Set<string>>(() => new Set())

  const toggleGraph = (runId: string): void => {
    setGraphRuns((prev) => {
      const next = new Set(prev)
      if (next.has(runId)) next.delete(runId)
      else next.add(runId)
      return next
    })
  }

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
    } else if (s.path && !item.external) {
      onOpen(
        s.path,
        item.presetId ?? run.presetId,
        s.phase === 'working' && !s.agent ? 'last' : undefined
      )
    }
  }

  const itemMenu = async (run: RunView, item: RunItemView): Promise<void> => {
    const s = item.state
    const startable = !item.external && !run.cancelled
    const open = sessionToShow(sessionsIn(item, sessions))
    const canResume = Boolean(!open && s.path && !item.external)
    const presetId = item.external ? run.presetId : (item.presetId ?? run.presetId)
    const prompts = actionMenu('runItem', actions, runItemFields(item), {
      here: sessions.find((x) => x.focused) ?? null,
      worktree: s.path,
      presetId
    })
    const items: MenuItem[] = [
      ...(canResume
        ? [
            { id: 'resumeAgent', label: 'Resume last session' },
            { id: 'openAgent', label: 'Open fresh session' },
            { type: 'separator' as const }
          ]
        : []),
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
      ...(!item.external ? [{ id: 'copy-branch', label: 'Copy branch name' }] : []),
      ...prompts.items
    ]
    const chosen = await api.menu(items)
    const req = prompts.pick(chosen)
    if (req) onPrompt(req)
    else if (chosen === 'resumeAgent' && s.path && !item.external) {
      onOpen(s.path, presetId, 'last')
    } else if (chosen === 'openAgent' && s.path && !item.external) {
      onOpen(s.path, presetId)
    } else if (chosen === 'startNow' || chosen === 'markDone' || chosen === 'retry') {
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
      {
        id: 'toggleAutoFixCi',
        label: 'Auto-fix failing CI',
        checked: run.autoFixCi,
        enabled: !run.cancelled && !run.finished
      },
      { id: 'cancel', label: 'Cancel run', enabled: !run.cancelled && !run.finished },
      { type: 'separator' },
      { id: 'remove', label: 'Remove', enabled: run.cancelled || run.finished }
    ]
    const chosen = await api.menu(items)
    if (
      chosen === 'pause' ||
      chosen === 'resume' ||
      chosen === 'toggleAutoFixCi' ||
      chosen === 'cancel' ||
      chosen === 'remove'
    ) {
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
              <button
                type="button"
                tabIndex={-1}
                className="activity-chip"
                title={graphRuns.has(run.id) ? 'Show as list' : 'Show dependency graph'}
                onClick={() => toggleGraph(run.id)}
              >
                {graphRuns.has(run.id) ? 'List' : 'Graph'}
              </button>
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
              <span className="prs-meta run-meta">{runMeta(run, sessions)}</span>
            </div>
            {graphRuns.has(run.id) ? (
              <RunDag
                items={run.items}
                states={Object.fromEntries(run.items.map((i) => [i.id, i.state]))}
                onSelect={(id) => {
                  const found = run.items.find((i) => i.id === id)
                  if (found) show(run, found)
                }}
                onContextMenu={(id) => {
                  const found = run.items.find((i) => i.id === id)
                  if (found) void itemMenu(run, found)
                }}
              />
            ) : (
              <ol className="run-items">
                {run.items.map((item) => (
                  <li key={item.id}>
                    <button
                      type="button"
                      tabIndex={-1}
                      className={`prs-row task-row run-row phase-${item.state.phase}`}
                      title={
                        item.state.phase === 'working' &&
                        !item.state.agent &&
                        item.state.path &&
                        !item.external
                          ? `${item.id}: ${item.title}\nClick to resume its last session; right-click for more`
                          : `${item.id}: ${item.title}\nClick to show it; right-click for more`
                      }
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
                        {item.id} · {itemMeta(item, run, sessionsIn(item, sessions))}
                        {!item.external && item.presetId && item.presetId !== run.presetId
                          ? ` · ${presets.find((p) => p.id === item.presetId)?.name ?? item.presetId}`
                          : ''}
                      </span>
                    </button>
                  </li>
                ))}
              </ol>
            )}
          </li>
        ))}
      </ol>
    </div>
  )
}
