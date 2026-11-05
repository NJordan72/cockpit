// Open pull requests for the repository of the focused pane, as the PRs
// panel shows them, and the agent commands it can send about one.

export type PrChecks = 'passing' | 'failing' | 'pending' | null
export type PrReview = 'approved' | 'changes' | 'required' | null

export interface PullRequest {
  number: number
  title: string
  url: string
  author: string
  bot: boolean
  draft: boolean
  branch: string
  review: PrReview
  checks: PrChecks
  /** ms since the epoch. */
  updatedAt: number
  /** Opened by the gh user. */
  mine: boolean
  /** The gh user is asked to review it. */
  toReview: boolean
}

export type PrList = { ok: true; repo: string; prs: PullRequest[] } | { ok: false; error: string }

export type PrFilter = 'all' | 'mine' | 'review' | 'others' | 'bots'

export const PR_FILTERS: { id: PrFilter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'mine', label: 'Mine' },
  { id: 'review', label: 'To review' },
  { id: 'others', label: 'Others' },
  { id: 'bots', label: 'Bots' }
]

export function filterPrs(prs: readonly PullRequest[], filter: PrFilter): PullRequest[] {
  switch (filter) {
    case 'all':
      return [...prs]
    case 'mine':
      return prs.filter((p) => p.mine)
    case 'review':
      return prs.filter((p) => p.toReview)
    case 'others':
      return prs.filter((p) => !p.mine && !p.bot)
    case 'bots':
      return prs.filter((p) => p.bot)
  }
}

/**
 * A prompt the PRs panel's right-click menu sends to an agent about a pull
 * request: `command` with the PR's URL added at the end.
 */
export interface PrAction {
  label: string
  command: string
}

/** config.json's `prActions` replaces these. */
export const DEFAULT_PR_ACTIONS: PrAction[] = [{ label: 'Review', command: '/code-review' }]

export const MAX_PR_ACTIONS = 20

export const prPrompt = (action: PrAction, pr: Pick<PullRequest, 'url'>): string =>
  `${action.command} ${pr.url}`
