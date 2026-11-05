import { useCallback, useEffect, useState } from 'react'
import type { MenuItem, PaneSession } from '@shared/ipc'
import {
  filterPrs,
  PR_FILTERS,
  prPrompt,
  type PrAction,
  type PrFilter,
  type PrList,
  type PullRequest
} from '@shared/prs'

/** How often the list is read again while the panel is on screen. */
const REFRESH_MS = 60_000

export type RunWhere = 'new' | 'here'

interface Props {
  session: PaneSession | null
  visible: boolean
  /** config.json's prActions: what the right-click menu can send about a PR. */
  actions: readonly PrAction[]
  /** Send a prompt to a new agent tab or to the focused pane's agent. */
  onRun: (prompt: string, where: RunWhere) => void
}

const REVIEW_LABEL = {
  approved: 'approved',
  changes: 'changes requested',
  required: 'needs review'
}

function age(ms: number): string {
  const min = Math.round((Date.now() - ms) / 60_000)
  if (min < 60) return `${String(Math.max(1, min))}m`
  if (min < 48 * 60) return `${String(Math.round(min / 60))}h`
  return `${String(Math.round(min / 1440))}d`
}

/** The focused pane's repository's open pull requests, with prompts to send about each. */
export function PrPanel({ session, visible, actions, onRun }: Props): React.JSX.Element {
  const api = window.cockpit
  const paneId = session?.id ?? null
  const cwd = session?.cwd ?? null
  const key = `${paneId ?? ''}:${cwd ?? ''}`
  /** The last list read, and the pane and directory it was read for. */
  const [read, setRead] = useState<{ key: string; list: PrList } | null>(null)
  const [loading, setLoading] = useState(false)
  const [filter, setFilter] = useState<PrFilter>('all')
  const hasAgent =
    session?.agent !== undefined && session.agent !== null && session.status !== 'exited'
  // Another pane or directory: show nothing rather than the last repo's PRs.
  const list = read?.key === key ? read.list : null

  const load = useCallback(() => {
    if (!paneId) return Promise.resolve()
    return api.prs.list(paneId).then((l) => {
      setRead({ key, list: l })
    })
  }, [api, paneId, key])

  const refresh = (): void => {
    setLoading(true)
    void load().finally(() => {
      setLoading(false)
    })
  }

  useEffect(() => {
    if (!visible || !paneId) return
    void load()
    const timer = setInterval(() => void load(), REFRESH_MS)
    return () => {
      clearInterval(timer)
    }
  }, [visible, paneId, load])

  const menu = async (pr: PullRequest): Promise<void> => {
    const items: MenuItem[] = [
      { id: 'open', label: 'Open on GitHub' },
      { id: 'copy', label: 'Copy URL' },
      ...(actions.length > 0 ? [{ type: 'separator' } as const] : []),
      ...actions.map((a, i): MenuItem => ({
        label: a.label,
        submenu: [
          { id: `new:${String(i)}`, label: 'In a new session' },
          { id: `here:${String(i)}`, label: 'In this session', enabled: hasAgent }
        ]
      }))
    ]
    const chosen = await api.menu(items)
    if (chosen === 'open') api.prs.open(pr.url)
    else if (chosen === 'copy') api.clipboard.writeText(pr.url)
    else if (chosen) {
      const [where, index] = chosen.split(':') as [RunWhere, string]
      const action = actions[Number(index)]
      if (action) onRun(prPrompt(action, pr), where)
    }
  }

  if (!session) return <p className="activity-empty">No pane</p>
  const shown = list?.ok ? filterPrs(list.prs, filter) : []

  return (
    <div className="prs">
      <div className="activity-toolbar">
        {PR_FILTERS.map((f) => (
          <button
            key={f.id}
            type="button"
            tabIndex={-1}
            className={`activity-chip${filter === f.id ? ' on' : ''}`}
            aria-pressed={filter === f.id}
            onClick={() => setFilter(f.id)}
          >
            {f.label}
          </button>
        ))}
        <button
          type="button"
          tabIndex={-1}
          className="prs-refresh"
          title={list?.ok ? `${list.repo} · refresh` : 'Refresh'}
          disabled={loading}
          onClick={refresh}
        >
          {loading ? '…' : '⟳'}
        </button>
      </div>
      {!list ? (
        <p className="activity-empty">Reading pull requests…</p>
      ) : !list.ok ? (
        <p className="activity-empty">{list.error}</p>
      ) : shown.length === 0 ? (
        <p className="activity-empty">No open pull requests here</p>
      ) : (
        <ol className="prs-list">
          {shown.map((pr) => (
            <li key={pr.number}>
              <button
                type="button"
                tabIndex={-1}
                className={`prs-row${pr.draft ? ' draft' : ''}`}
                title={`${pr.title}\n${pr.branch}\nRight-click for actions`}
                onClick={() => api.prs.open(pr.url)}
                onContextMenu={(e) => {
                  e.preventDefault()
                  void menu(pr)
                }}
              >
                <span
                  className={`prs-checks ${pr.checks ?? 'none'}`}
                  title={pr.checks ?? 'no checks'}
                />
                <span className="prs-title">
                  <span className="prs-number">#{pr.number}</span> {pr.title}
                </span>
                <span className="prs-meta">
                  {pr.author}
                  {pr.bot && ' · bot'}
                  {pr.draft && ' · draft'}
                  {pr.review && ` · ${REVIEW_LABEL[pr.review]}`}
                  {pr.toReview && ' · review requested'}
                  {` · ${age(pr.updatedAt)}`}
                </span>
              </button>
            </li>
          ))}
        </ol>
      )}
    </div>
  )
}
