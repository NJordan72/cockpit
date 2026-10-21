// Open pull requests through the GitHub CLI, so Cockpit uses the user's own
// gh login and never holds a GitHub token.
import { execFile } from 'node:child_process'
import type { PrChecks, PrList, PrReview, PullRequest } from '@shared/prs'
import { abbreviateHome } from './paths'

const TIMEOUT_MS = 15_000
const LIMIT = 100
const FIELDS =
  'number,title,url,author,isDraft,headRefName,reviewDecision,updatedAt,reviewRequests,statusCheckRollup'
/** An app opened from the Dock doesn't get the login shell's PATH. */
const EXTRA_PATH = ['/opt/homebrew/bin', '/usr/local/bin']

function gh(cwd: string, args: string[]): Promise<{ out: string } | { error: string }> {
  const PATH = [process.env.PATH ?? '', ...EXTRA_PATH].filter(Boolean).join(':')
  return new Promise((resolve) => {
    execFile(
      'gh',
      args,
      { cwd, timeout: TIMEOUT_MS, maxBuffer: 16 * 1024 * 1024, env: { ...process.env, PATH } },
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

function review(decision: string): PrReview {
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
