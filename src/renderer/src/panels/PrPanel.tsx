import { useCallback, useEffect, useState } from 'react'
import type { MenuItem, PaneSession } from '@shared/ipc'
import { prFields, type ItemAction } from '@shared/itemActions'
import {
  filterPrs,
  PR_FILTERS,
  prRefFromUrl,
  type PrFilter,
  type PrList,
  type PrRef,
  type PullRequest
} from '@shared/prs'
import { actionMenu, type PromptRequest } from '../itemActions'

/** How often the list is read again while the panel is on screen. */
const REFRESH_MS = 60_000

interface Props {
  session: PaneSession | null
  visible: boolean
  /** config.json's itemActions.pr: what the right-click menu can send about a PR. */
  actions: readonly ItemAction[]
  onPrompt: (req: PromptRequest) => void
  /** Show a pull request in a pane: a new tab, or beside the focused pane. */
  onOpen: (pr: PrRef, title: string, where: 'tab' | 'row') => void
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
export function PrPanel({ session, visible, actions, onPrompt, onOpen }: Props): React.JSX.Element {
  const api = window.cockpit
  const paneId = session?.id ?? null
  const cwd = session?.cwd ?? null
  const key = `${paneId ?? ''}:${cwd ?? ''}`
  /** The last list read, and the pane and directory it was read for. */
  const [read, setRead] = useState<{ key: string; list: PrList } | null>(null)
  const [loading, setLoading] = useState(false)
  const [filter, setFilter] = useState<PrFilter>('all')
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

  const show = (pr: PullRequest, where: 'tab' | 'row'): void => {
    const ref = prRefFromUrl(pr.url)
    if (ref) onOpen(ref, pr.title, where)
    else api.prs.open(pr.url)
  }

  const menu = async (pr: PullRequest): Promise<void> => {
    const prompts = actionMenu('pr', actions, prFields(pr), { here: session })
    const items: MenuItem[] = [
      { id: 'pane', label: 'Open in a new tab' },
      { id: 'split', label: 'Open beside this pane' },
      { id: 'open', label: 'Open on GitHub' },
      { id: 'copy', label: 'Copy URL' },
      ...prompts.items
    ]
    const chosen = await api.menu(items)
    const req = prompts.pick(chosen)
    if (req) onPrompt(req)
    else if (chosen === 'pane') show(pr, 'tab')
    else if (chosen === 'split') show(pr, 'row')
    else if (chosen === 'open') api.prs.open(pr.url)
    else if (chosen === 'copy') api.clipboard.writeText(pr.url)
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
                title={`${pr.title}\n${pr.branch}\nClick to open, Shift-click to open beside this pane, right-click for more`}
                onClick={(e) => {
                  show(pr, e.shiftKey ? 'row' : 'tab')
                }}
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
