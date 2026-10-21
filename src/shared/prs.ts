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

/** Skills the PRs panel can run on a pull request. Each gets the PR's URL. */
export const PR_ACTIONS: { skill: string; label: string }[] = [
  { skill: 'review-pr', label: 'Review' },
  { skill: 'prep-review', label: 'Prep review' },
  { skill: 'propose-ship', label: 'Propose ship' },
  { skill: 'approve-ship', label: 'Approve ship' },
  { skill: 'ship-pr', label: 'Ship' }
]

export const prPrompt = (skill: string, pr: Pick<PullRequest, 'url'>): string =>
  `/${skill} ${pr.url}`
