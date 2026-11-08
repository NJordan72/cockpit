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

/** A pull request a pane shows: the repository as `owner/name`, and its number. */
export interface PrRef {
  repo: string
  number: number
}

const REPO_NAME = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/

export function isPrRef(v: unknown): v is PrRef {
  if (typeof v !== 'object' || v === null) return false
  const { repo, number } = v as Record<string, unknown>
  return (
    typeof repo === 'string' &&
    repo.length <= 200 &&
    REPO_NAME.test(repo) &&
    typeof number === 'number' &&
    Number.isSafeInteger(number) &&
    number > 0
  )
}

/** The pull request a https://github.com/<owner>/<name>/pull/<n> URL names. */
export function prRefFromUrl(url: string): PrRef | null {
  const m = /^https:\/\/github\.com\/([^/]+\/[^/]+)\/pull\/(\d+)(?:[/?#]|$)/.exec(url)
  const ref = m ? { repo: m[1] ?? '', number: Number(m[2]) } : null
  return isPrRef(ref) ? ref : null
}

export type PrState = 'open' | 'closed' | 'merged'
export type MergeMethod = 'squash' | 'merge' | 'rebase'
export type CheckState = 'failing' | 'pending' | 'passing' | 'skipped'
export type ReviewVerdict = 'approved' | 'changes' | 'commented' | 'dismissed'

export const MERGE_LABEL: Record<MergeMethod, string> = {
  squash: 'Squash and merge',
  merge: 'Create a merge commit',
  rebase: 'Rebase and merge'
}

/** A comment on the pull request or in a review thread. */
export interface PrNote {
  id: string
  author: string
  bot: boolean
  body: string
  /** ms since the epoch. */
  at: number
  url: string
}

/** A submitted review. Its inline comments are in the threads. */
export interface PrReviewNote extends PrNote {
  verdict: ReviewVerdict
}

/** An inline review thread on one file. */
export interface PrThread {
  id: string
  path: string
  /** The line on the pull request's head; null once the thread is outdated. */
  line: number | null
  startLine: number | null
  /** The line on the commit the first comment was written against. */
  originalLine: number | null
  resolved: boolean
  outdated: boolean
  /** The diff GitHub keeps with the first comment, ending at its line. */
  hunk: string
  comments: PrNote[]
  canReply: boolean
  canResolve: boolean
  canUnresolve: boolean
}

export interface PrCheck {
  name: string
  /** The GitHub Actions workflow it ran in. */
  workflow: string | null
  state: CheckState
  url: string | null
  /** A GitHub Actions job, whose log gh can read. */
  jobId: number | null
}

export interface PrDetail {
  repo: string
  number: number
  title: string
  url: string
  state: PrState
  draft: boolean
  author: string
  body: string
  branch: string
  base: string
  /** The branch is in another repository, so a task can't check it out. */
  fork: boolean
  review: PrReview
  checks: PrCheck[]
  mergeable: 'yes' | 'conflicts' | 'unknown'
  /** The repository's allowed methods, its default first. */
  mergeMethods: MergeMethod[]
  /** Opened by the gh user. */
  mine: boolean
  /** The gh user may close it, reopen it, or mark it ready. */
  canUpdate: boolean
  comments: PrNote[]
  reviews: PrReviewNote[]
  threads: PrThread[]
  /** ms since the epoch. */
  updatedAt: number
}

export type PrDetailResult = { ok: true; pr: PrDetail } | { ok: false; error: string }

/** What the pull request pane can do through gh. */
export type PrAct =
  | { type: 'comment'; body: string }
  | { type: 'reply'; threadId: string; body: string }
  | { type: 'resolve'; threadId: string; resolved: boolean }
  | { type: 'review'; verdict: 'approve' | 'changes'; body: string }
  | { type: 'ready' }
  | { type: 'close' }
  | { type: 'reopen' }
  | { type: 'merge'; method: MergeMethod }

/** `cancelled` means the user said no when main asked. */
export type PrActResult =
  { ok: true } | { ok: false; cancelled: true } | { ok: false; error: string }

export type PrLogResult = { ok: true; log: string } | { ok: false; error: string }

/** GitHub's limit for a comment. */
export const MAX_PR_BODY = 65_536

/** Feedback the pane can hand to an agent. */
export type Feedback =
  | { kind: 'thread'; thread: PrThread }
  | { kind: 'comment'; note: PrNote }
  | { kind: 'review'; note: PrReviewNote }

/** Main refuses longer prompts; this leaves room for the frame around the feedback. */
const PROMPT_BUDGET = 19_000
const MAX_NOTE = 3_000

const VERDICT_LABEL: Record<ReviewVerdict, string> = {
  approved: 'approved',
  changes: 'changes requested',
  commented: 'commented',
  dismissed: 'dismissed'
}

/** Bots put metadata in HTML comments, which GitHub doesn't show. */
export const stripHtmlComments = (s: string): string => s.replace(/<!--[\s\S]*?-->/g, '').trim()

/** `src/a.ts line 42`, `src/a.ts lines 40-42`, or the line it had on an earlier commit. */
export function threadPlace(
  t: Pick<PrThread, 'path' | 'line' | 'startLine' | 'originalLine'>
): string {
  if (t.line === null) {
    return t.originalLine === null ? t.path : `${t.path} line ${String(t.originalLine)} (outdated)`
  }
  return t.startLine !== null && t.startLine !== t.line
    ? `${t.path} lines ${String(t.startLine)}-${String(t.line)}`
    : `${t.path} line ${String(t.line)}`
}

function clip(text: string, max: number, url: string): string {
  const body = stripHtmlComments(text)
  return body.length <= max
    ? body
    : `${body.slice(0, max).trimEnd()}… (cut short; the rest is at ${url})`
}

const indent = (text: string): string =>
  text
    .split('\n')
    .map((l) => (l ? `   ${l}` : ''))
    .join('\n')

function describe(item: Feedback, n: number): string {
  if (item.kind === 'thread') {
    const t = item.thread
    const notes = t.comments
      .map((c) => indent(`${c.author}: ${clip(c.body, MAX_NOTE, c.url)}`))
      .join('\n')
    return `${String(n)}. Review thread on ${threadPlace(t)} (${t.comments[0]?.url ?? ''}):\n${notes}`
  }
  const { note } = item
  const head =
    item.kind === 'review'
      ? `Review by ${note.author}, ${VERDICT_LABEL[item.note.verdict]}`
      : `Comment by ${note.author}`
  return `${String(n)}. ${head} (${note.url}):\n${indent(clip(note.body, MAX_NOTE, note.url))}`
}

const prLine = (pr: Pick<PrDetail, 'number' | 'title' | 'url' | 'branch'>): string =>
  `pull request #${String(pr.number)}, "${pr.title}" (${pr.url}), on branch ${pr.branch}`

/**
 * The prompt that asks an agent to act on review feedback. Items that would
 * push it past what main accepts are named by link only.
 */
export function feedbackPrompt(
  pr: Pick<PrDetail, 'number' | 'title' | 'url' | 'branch'>,
  items: readonly Feedback[]
): string {
  const one = items.length === 1
  const head = `Address ${one ? 'this piece' : 'these pieces'} of review feedback on ${prLine(pr)}.`
  const tail = `Fix what ${one ? 'it asks' : 'each one asks'} for, or say why not. When you're done, say what you changed for ${one ? 'it' : 'each one'}.`
  let used = head.length + tail.length
  const parts = items.map((item, i) => {
    const full = describe(item, i + 1)
    if (used + full.length <= PROMPT_BUDGET) {
      used += full.length
      return full
    }
    const url = item.kind === 'thread' ? (item.thread.comments[0]?.url ?? '') : item.note.url
    const short = `${String(i + 1)}. Too long to include here; read it at ${url}`
    used += short.length
    return short
  })
  return [head, ...parts, tail].join('\n\n')
}

/** How much of a failed log goes into the prompt. */
const LOG_BUDGET = 12_000

/** The prompt that asks an agent to fix a failing check, with the end of its log when there is one. */
export function checkPrompt(
  pr: Pick<PrDetail, 'repo' | 'number' | 'title' | 'url' | 'branch'>,
  check: PrCheck,
  log: string | null
): string {
  const name =
    check.workflow && check.workflow !== check.name
      ? `${check.workflow} / ${check.name}`
      : check.name
  const lines = [`The check "${name}" failed on ${prLine(pr)}. Find out why and fix it.`]
  if (check.url) lines.push(`Details: ${check.url}`)
  if (log) {
    const tail = log.length > LOG_BUDGET ? log.slice(log.length - LOG_BUDGET) : log
    lines.push(`The end of its failed log:\n\n\`\`\`\n${tail.replaceAll('```', "'''")}\n\`\`\``)
  } else if (check.jobId !== null) {
    lines.push(
      `Read its log with \`gh run view --job ${String(check.jobId)} --log-failed --repo ${pr.repo}\`.`
    )
  }
  return lines.join('\n\n')
}
