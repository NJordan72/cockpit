// Open pull requests through the GitHub CLI, so Cockpit uses the user's own
// gh login and never holds a GitHub token.
import { execFile } from 'node:child_process'
import { homedir } from 'node:os'
import {
  MAX_PR_BODY,
  type CheckState,
  type MergeMethod,
  type PrAct,
  type PrActResult,
  type PrCheck,
  type PrChecks,
  type PrDetailResult,
  type PrList,
  type PrLogResult,
  type PrNote,
  type PrRef,
  type PrReview,
  type PrReviewNote,
  type PrThread,
  type PullRequest,
  type ReviewVerdict
} from '@shared/prs'
import { abbreviateHome } from './paths'

const TIMEOUT_MS = 15_000
const LIMIT = 100
const FIELDS =
  'number,title,url,author,isDraft,headRefName,reviewDecision,updatedAt,reviewRequests,statusCheckRollup'
/** An app opened from the Dock doesn't get the login shell's PATH. */
const EXTRA_PATH = ['/opt/homebrew/bin', '/usr/local/bin']

export function gh(
  cwd: string,
  args: string[],
  timeout = TIMEOUT_MS
): Promise<{ out: string } | { error: string }> {
  const PATH = [process.env.PATH ?? '', ...EXTRA_PATH].filter(Boolean).join(':')
  return new Promise((resolve) => {
    execFile(
      'gh',
      args,
      { cwd, timeout, maxBuffer: 16 * 1024 * 1024, env: { ...process.env, PATH } },
      (err, stdout, stderr) => {
        if (!err) resolve({ out: stdout })
        else if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
          resolve({ error: 'gh is not installed' })
        } else {
          const first = stderr.trim().split('\n')[0]
          resolve({ error: first && first.length > 0 ? first : err.message })
        }
      }
    )
  })
}

type Obj = Record<string, unknown>
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v)
const str = (v: unknown): string => (typeof v === 'string' ? v : '')

export function review(decision: string): PrReview {
  if (decision === 'APPROVED') return 'approved'
  if (decision === 'CHANGES_REQUESTED') return 'changes'
  if (decision === 'REVIEW_REQUIRED') return 'required'
  return null
}

/** One state for all of a PR's check runs and commit statuses. */
export function rollup(checks: unknown): PrChecks {
  if (!Array.isArray(checks) || checks.length === 0) return null
  let pending = false
  for (const c of checks) {
    if (!isObj(c)) continue
    // CheckRun: status + conclusion. StatusContext: state.
    const state = str(c.conclusion) || str(c.state)
    const status = str(c.status)
    if (['FAILURE', 'ERROR', 'TIMED_OUT', 'CANCELLED', 'ACTION_REQUIRED'].includes(state)) {
      return 'failing'
    }
    if ((status && status !== 'COMPLETED') || state === 'PENDING' || state === 'EXPECTED') {
      pending = true
    }
  }
  return pending ? 'pending' : 'passing'
}

/** `gh pr list --json <FIELDS>` output, from the point of view of `viewer`. */
export function parsePrs(json: unknown, viewer: string | null): PullRequest[] {
  if (!Array.isArray(json)) return []
  return json.filter(isObj).map((p) => {
    const author = isObj(p.author) ? p.author : {}
    const login = str(author.login)
    const named = `${login} ${str(author.name)}`.toLowerCase()
    const requests = Array.isArray(p.reviewRequests) ? p.reviewRequests.filter(isObj) : []
    return {
      number: typeof p.number === 'number' ? p.number : 0,
      title: str(p.title),
      url: str(p.url),
      author: login,
      // gh names bots like app/claude or renovate[bot], in the login or the name.
      bot: author.is_bot === true || login.startsWith('app/') || named.includes('[bot]'),
      draft: p.isDraft === true,
      branch: str(p.headRefName),
      review: review(str(p.reviewDecision)),
      checks: rollup(p.statusCheckRollup),
      updatedAt: Date.parse(str(p.updatedAt)) || 0,
      mine: viewer !== null && login === viewer,
      toReview: viewer !== null && requests.some((r) => str(r.login) === viewer)
    }
  })
}

let viewer: Promise<string | null> | null = null

/** The gh user's login, asked once per run. */
function viewerLogin(cwd: string): Promise<string | null> {
  viewer ??= gh(cwd, ['api', 'user', '--jq', '.login']).then((r) => {
    if ('out' in r) return r.out.trim() || null
    viewer = null
    return null
  })
  return viewer
}

/** Open pull requests for the GitHub repository `cwd` is in. */
export async function listPrs(cwd: string): Promise<PrList> {
  const [list, me] = await Promise.all([
    gh(cwd, ['pr', 'list', '--state', 'open', '--limit', String(LIMIT), '--json', FIELDS]),
    viewerLogin(cwd)
  ])
  if ('error' in list) return { ok: false, error: list.error }
  const repo = await gh(cwd, ['repo', 'view', '--json', 'nameWithOwner', '--jq', '.nameWithOwner'])
  try {
    const prs = parsePrs(JSON.parse(list.out), me)
    return { ok: true, repo: 'out' in repo ? repo.out.trim() : abbreviateHome(cwd), prs }
  } catch {
    return { ok: false, error: 'gh returned something that is not JSON' }
  }
}

const DETAIL_QUERY = `query($owner: String!, $name: String!, $number: Int!) {
  viewer { login }
  repository(owner: $owner, name: $name) {
    nameWithOwner
    mergeCommitAllowed squashMergeAllowed rebaseMergeAllowed viewerDefaultMergeMethod
    pullRequest(number: $number) {
      number title url state isDraft body updatedAt
      headRefName baseRefName isCrossRepository reviewDecision mergeable viewerCanUpdate
      author { __typename login }
      comments(last: 100) { nodes { id author { __typename login } body createdAt url } }
      reviews(last: 100) { nodes { id author { __typename login } state body submittedAt url } }
      reviewThreads(first: 100) {
        nodes {
          id isResolved isOutdated path line startLine originalLine
          viewerCanReply viewerCanResolve viewerCanUnresolve
          comments(first: 50) { nodes { id author { __typename login } body createdAt url diffHunk } }
        }
      }
      commits(last: 1) {
        nodes {
          commit {
            statusCheckRollup {
              contexts(first: 100) {
                nodes {
                  __typename
                  ... on CheckRun {
                    name status conclusion detailsUrl databaseId
                    checkSuite { workflowRun { workflow { name } } }
                  }
                  ... on StatusContext { context state targetUrl }
                }
              }
            }
          }
        }
      }
    }
  }
}`

const nodes = (v: unknown): Obj[] =>
  isObj(v) && Array.isArray(v.nodes) ? v.nodes.filter(isObj) : []
const num = (v: unknown): number | null => (typeof v === 'number' ? v : null)
const time = (v: unknown): number => Date.parse(str(v)) || 0

/** A deleted account comes back as a null author; GitHub shows it as ghost. */
function who(author: unknown): { author: string; bot: boolean } {
  if (!isObj(author)) return { author: 'ghost', bot: false }
  const login = str(author.login) || 'ghost'
  return { author: login, bot: author.__typename === 'Bot' || login.endsWith('[bot]') }
}

function note(n: Obj, at: unknown): PrNote {
  return { id: str(n.id), ...who(n.author), body: str(n.body), at: time(at), url: str(n.url) }
}

const VERDICTS: Record<string, ReviewVerdict> = {
  APPROVED: 'approved',
  CHANGES_REQUESTED: 'changes',
  COMMENTED: 'commented',
  DISMISSED: 'dismissed'
}

/** One check run or commit status. */
export function checkState(c: Obj): CheckState {
  if (c.__typename === 'StatusContext') {
    const state = str(c.state)
    if (state === 'SUCCESS') return 'passing'
    if (state === 'FAILURE' || state === 'ERROR') return 'failing'
    return 'pending'
  }
  if (str(c.status) !== 'COMPLETED') return 'pending'
  const conclusion = str(c.conclusion)
  if (conclusion === 'SUCCESS') return 'passing'
  if (['NEUTRAL', 'SKIPPED', 'STALE'].includes(conclusion)) return 'skipped'
  return 'failing'
}

const CHECK_ORDER: Record<CheckState, number> = { failing: 0, pending: 1, passing: 2, skipped: 3 }

function check(c: Obj): PrCheck {
  const status = c.__typename === 'StatusContext'
  const run = isObj(c.checkSuite) && isObj(c.checkSuite.workflowRun) ? c.checkSuite.workflowRun : {}
  const workflow = isObj(run.workflow) ? str(run.workflow.name) : ''
  const url = str(status ? c.targetUrl : c.detailsUrl)
  return {
    name: str(status ? c.context : c.name),
    workflow: workflow || null,
    state: checkState(c),
    url: /^https?:\/\//.test(url) ? url : null,
    // Only GitHub Actions jobs have a log gh can read.
    jobId: !status && workflow ? num(c.databaseId) : null
  }
}

function thread(t: Obj): PrThread {
  const comments = nodes(t.comments)
  return {
    id: str(t.id),
    path: str(t.path),
    line: num(t.line),
    startLine: num(t.startLine),
    originalLine: num(t.originalLine),
    resolved: t.isResolved === true,
    outdated: t.isOutdated === true,
    hunk: str(comments[0]?.diffHunk),
    comments: comments.map((c) => note(c, c.createdAt)),
    canReply: t.viewerCanReply === true,
    canResolve: t.viewerCanResolve === true,
    canUnresolve: t.viewerCanUnresolve === true
  }
}

function mergeMethods(repo: Obj): MergeMethod[] {
  const allowed: MergeMethod[] = []
  if (repo.squashMergeAllowed === true) allowed.push('squash')
  if (repo.mergeCommitAllowed === true) allowed.push('merge')
  if (repo.rebaseMergeAllowed === true) allowed.push('rebase')
  const first = str(repo.viewerDefaultMergeMethod).toLowerCase()
  return [...allowed.filter((m) => m === first), ...allowed.filter((m) => m !== first)]
}

/** `gh api graphql` output for DETAIL_QUERY. */
export function parsePrDetail(json: unknown): PrDetailResult {
  if (!isObj(json)) return { ok: false, error: 'gh returned something unexpected' }
  if (Array.isArray(json.errors) && json.errors.length > 0) {
    const first = json.errors.find(isObj)
    return { ok: false, error: str(first?.message) || 'GitHub refused the query' }
  }
  const data = isObj(json.data) ? json.data : {}
  const repo = isObj(data.repository) ? data.repository : null
  const p = repo && isObj(repo.pullRequest) ? repo.pullRequest : null
  if (!repo || !p) return { ok: false, error: 'No such pull request' }
  const viewer = isObj(data.viewer) ? str(data.viewer.login) : ''
  const state = str(p.state)
  const commit = nodes(p.commits)[0]?.commit
  const rollupObj = isObj(commit) && isObj(commit.statusCheckRollup) ? commit.statusCheckRollup : {}
  const checks = nodes(rollupObj.contexts)
    .map(check)
    .sort((a, b) => CHECK_ORDER[a.state] - CHECK_ORDER[b.state] || a.name.localeCompare(b.name))
  const reviews: PrReviewNote[] = nodes(p.reviews).flatMap((r) => {
    const verdict = VERDICTS[str(r.state)]
    return verdict ? [{ ...note(r, r.submittedAt), verdict }] : []
  })
  const mergeable = str(p.mergeable)
  const author = who(p.author).author
  return {
    ok: true,
    pr: {
      repo: str(repo.nameWithOwner),
      number: num(p.number) ?? 0,
      title: str(p.title),
      url: str(p.url),
      state: state === 'MERGED' ? 'merged' : state === 'CLOSED' ? 'closed' : 'open',
      draft: p.isDraft === true,
      author,
      body: str(p.body),
      branch: str(p.headRefName),
      base: str(p.baseRefName),
      fork: p.isCrossRepository === true,
      review: review(str(p.reviewDecision)),
      checks,
      mergeable:
        mergeable === 'MERGEABLE' ? 'yes' : mergeable === 'CONFLICTING' ? 'conflicts' : 'unknown',
      mergeMethods: mergeMethods(repo),
      mine: viewer !== '' && author === viewer,
      canUpdate: p.viewerCanUpdate === true,
      comments: nodes(p.comments).map((c) => note(c, c.createdAt)),
      reviews,
      threads: nodes(p.reviewThreads).map(thread),
      updatedAt: time(p.updatedAt)
    }
  }
}

/** Runs gh outside any checkout, so it acts on `--repo` alone and never on local branches. */
const ghAt = (args: string[], timeout?: number): ReturnType<typeof gh> =>
  gh(homedir(), args, timeout)

export async function readPr(ref: PrRef): Promise<PrDetailResult> {
  const [owner, name] = ref.repo.split('/')
  const res = await ghAt([
    'api',
    'graphql',
    '-f',
    `query=${DETAIL_QUERY}`,
    '-f',
    `owner=${owner ?? ''}`,
    '-f',
    `name=${name ?? ''}`,
    '-F',
    `number=${String(ref.number)}`
  ])
  if ('error' in res) return { ok: false, error: res.error }
  try {
    return parsePrDetail(JSON.parse(res.out))
  } catch {
    return { ok: false, error: 'gh returned something that is not JSON' }
  }
}

const THREAD_ID = /^[A-Za-z0-9_=-]{1,200}$/
const METHODS: readonly MergeMethod[] = ['squash', 'merge', 'rebase']

const body = (v: unknown): string | null =>
  typeof v === 'string' && v.trim() && v.length <= MAX_PR_BODY ? v : null

/** An action the renderer sent, checked field by field, or null. */
export function readPrAct(v: unknown): PrAct | null {
  if (!isObj(v)) return null
  switch (v.type) {
    case 'comment': {
      const b = body(v.body)
      return b === null ? null : { type: 'comment', body: b }
    }
    case 'reply': {
      const b = body(v.body)
      const id = str(v.threadId)
      return b === null || !THREAD_ID.test(id) ? null : { type: 'reply', threadId: id, body: b }
    }
    case 'resolve': {
      const id = str(v.threadId)
      return THREAD_ID.test(id) && typeof v.resolved === 'boolean'
        ? { type: 'resolve', threadId: id, resolved: v.resolved }
        : null
    }
    case 'review': {
      if (v.verdict !== 'approve' && v.verdict !== 'changes') return null
      const text = typeof v.body === 'string' ? v.body : ''
      // GitHub needs a body to request changes.
      if (text.length > MAX_PR_BODY || (v.verdict === 'changes' && !text.trim())) return null
      return { type: 'review', verdict: v.verdict, body: text }
    }
    case 'ready':
    case 'close':
    case 'reopen':
      return { type: v.type }
    case 'merge':
      return METHODS.includes(v.method as MergeMethod)
        ? { type: 'merge', method: v.method as MergeMethod }
        : null
    default:
      return null
  }
}

const MUTATIONS = {
  reply:
    'mutation($id: ID!, $body: String!) { addPullRequestReviewThreadReply(input: {pullRequestReviewThreadId: $id, body: $body}) { comment { id } } }',
  resolve: 'mutation($id: ID!) { resolveReviewThread(input: {threadId: $id}) { thread { id } } }',
  unresolve:
    'mutation($id: ID!) { unresolveReviewThread(input: {threadId: $id}) { thread { id } } }'
}

/** The gh arguments for an action. Bodies use `--body=` so one that starts with `-` stays a value. */
export function prActArgs(ref: PrRef, act: PrAct): string[] {
  const pr = [String(ref.number), '--repo', ref.repo]
  switch (act.type) {
    case 'comment':
      return ['pr', 'comment', ...pr, `--body=${act.body}`]
    case 'reply':
      return [
        'api',
        'graphql',
        '-f',
        `query=${MUTATIONS.reply}`,
        '-f',
        `id=${act.threadId}`,
        '-f',
        `body=${act.body}`
      ]
    case 'resolve':
      return [
        'api',
        'graphql',
        '-f',
        `query=${act.resolved ? MUTATIONS.resolve : MUTATIONS.unresolve}`,
        '-f',
        `id=${act.threadId}`
      ]
    case 'review':
      return [
        'pr',
        'review',
        ...pr,
        act.verdict === 'approve' ? '--approve' : '--request-changes',
        ...(act.body.trim() ? [`--body=${act.body}`] : [])
      ]
    case 'ready':
    case 'close':
    case 'reopen':
      return ['pr', act.type, ...pr]
    case 'merge':
      return ['pr', 'merge', ...pr, `--${act.method}`]
  }
}

/** Runs an action. Main asks the user first for the ones that need it. */
export async function actOnPr(ref: PrRef, act: PrAct): Promise<PrActResult> {
  const res = await ghAt(prActArgs(ref, act), act.type === 'merge' ? 60_000 : TIMEOUT_MS)
  if ('error' in res) return { ok: false, error: res.error }
  // gh api graphql exits 0 when GitHub answers with errors.
  if (act.type === 'reply' || act.type === 'resolve') {
    try {
      const json: unknown = JSON.parse(res.out)
      if (isObj(json) && Array.isArray(json.errors) && json.errors.length > 0) {
        const first = json.errors.find(isObj)
        return { ok: false, error: str(first?.message) || 'GitHub refused it' }
      }
    } catch {
      // Nothing to check.
    }
  }
  return { ok: true }
}

const LOG_LINES = 200
const STAMP = /^\d{4}-\d\d-\d\dT[\d:.]+Z ?/
// eslint-disable-next-line no-control-regex
const ANSI = /\x1b\[[0-9;]*[A-Za-z]/g

/**
 * `gh run view --log-failed` output, whose lines are `<job>\t<step>\t<time> <text>`,
 * as the last lines of text with a heading where each step starts.
 */
export function failedLogTail(out: string, lines = LOG_LINES): string {
  const text: string[] = []
  let step = ''
  for (const raw of out.split('\n')) {
    const parts = raw.replace(/^\uFEFF/, '').split('\t')
    if (parts.length < 3) continue
    const name = parts[1] ?? ''
    if (name !== step) {
      step = name
      text.push(`== ${name} ==`)
    }
    text.push(parts.slice(2).join('\t').replace(STAMP, '').replace(ANSI, '').trimEnd())
  }
  return text.slice(-lines).join('\n')
}

export async function checkLog(ref: PrRef, jobId: number): Promise<PrLogResult> {
  const res = await ghAt(
    ['run', 'view', '--job', String(jobId), '--log-failed', '--repo', ref.repo],
    30_000
  )
  if ('error' in res) return { ok: false, error: res.error }
  const log = failedLogTail(res.out)
  return log ? { ok: true, log } : { ok: false, error: 'The log has no failed steps' }
}
