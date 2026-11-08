// Tasks: git worktrees Cockpit makes under ~/.cockpit/worktrees/<repo>/, one
// branch each, so agents in the same repository don't share a working tree.
// Every task is read again from git and gh when the list is refreshed. The
// only thing kept in between is a new worktree's setup command, until its
// first terminal starts.
import fs from 'node:fs/promises'
import path from 'node:path'
import type { PrChecks } from '@shared/prs'
import {
  isRepoPath,
  worktreeName,
  type NewTask,
  type NewTaskResult,
  type RepoTaskSettings,
  type TaskInfo,
  type TaskPr
} from '@shared/tasks'
import { shQuote } from './agents/launch'
import { parseStatus, runGit } from './git'
import { abbreviateHome, expandHome } from './paths'
import { gh as runGh, review, rollup } from './prs'

export interface Worktree {
  path: string
  head: string | null
  /** Without refs/heads/; null when detached. */
  branch: string | null
  bare: boolean
}

/** `git worktree list --porcelain -z` output. The main checkout comes first. */
export function parseWorktrees(out: string): Worktree[] {
  const list: Worktree[] = []
  let cur: Worktree | null = null
  for (const field of out.split('\0')) {
    if (field.startsWith('worktree ')) {
      cur = { path: field.slice('worktree '.length), head: null, branch: null, bare: false }
      list.push(cur)
    } else if (cur && field.startsWith('HEAD ')) {
      cur.head = field.slice('HEAD '.length)
    } else if (cur && field.startsWith('branch ')) {
      cur.branch = field.slice('branch '.length).replace(/^refs\/heads\//, '')
    } else if (cur && field === 'bare') {
      cur.bare = true
    }
  }
  return list
}

type Obj = Record<string, unknown>
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v)
const str = (v: unknown): string => (typeof v === 'string' ? v : '')

export const PR_FIELDS =
  'number,title,url,state,isDraft,reviewDecision,statusCheckRollup,headRefOid'

/**
 * `gh pr list --head <branch> --state all --limit 1 --json <PR_FIELDS>`
 * output: the branch's newest pull request, or null.
 */
export function parseTaskPr(list: unknown): TaskPr | null {
  const json: unknown = Array.isArray(list) ? list[0] : list
  if (!isObj(json) || typeof json.number !== 'number') return null
  const state = str(json.state)
  const checks: PrChecks = rollup(json.statusCheckRollup)
  return {
    number: json.number,
    title: str(json.title),
    url: str(json.url),
    state: state === 'MERGED' ? 'merged' : state === 'CLOSED' ? 'closed' : 'open',
    draft: json.isDraft === true,
    checks,
    review: review(str(json.reviewDecision)),
    head: str(json.headRefOid)
  }
}

/**
 * The command for a new worktree's first terminal: the repository's setup
 * command, then what the pane runs, or an interactive login shell. sh runs
 * it, so it reads the same whatever the login shell is, with the PATH that
 * shell set up. A failed setup is reported and the pane carries on.
 */
export function withSetup(setup: string, command: string | undefined): string {
  const script = [
    `printf '\\033[2m[cockpit] setting up: %s\\033[0m\\n' ${shQuote(setup)}`,
    `(\n${setup}\n)`,
    'code=$?',
    `[ "$code" -eq 0 ] || printf '\\033[33m[cockpit] setup exited with %s\\033[0m\\n' "$code"`,
    command ?? 'exec "$SHELL" -l'
  ].join('\n')
  return `/bin/sh -c ${shQuote(script)}`
}

const firstLine = (s: string): string => s.trim().split('\n')[0]?.trim() ?? ''

const exists = (p: string): Promise<boolean> =>
  fs.access(p).then(
    () => true,
    () => false
  )

async function readdir(dir: string): Promise<string[]> {
  try {
    return (await fs.readdir(dir, { withFileTypes: true }))
      .filter((d) => d.isDirectory() && !d.name.startsWith('.'))
      .map((d) => d.name)
  } catch {
    return []
  }
}

async function refExists(repo: string, ref: string): Promise<boolean> {
  return (await runGit(repo, ['show-ref', '--verify', '--quiet', ref])).code === 0
}

/** `origin`, or else the first remote, or null without any. */
async function pickRemote(repo: string): Promise<string | null> {
  const r = await runGit(repo, ['remote'])
  const remotes = r.code === 0 ? r.stdout.split('\n').filter(Boolean) : []
  return remotes.includes('origin') ? 'origin' : (remotes[0] ?? null)
}

/** Where a new branch starts: the remote's default branch, or else the main checkout's HEAD (null). */
async function baseRef(repo: string, remote: string | null): Promise<string | null> {
  if (!remote) return null
  const head = await runGit(repo, [
    'symbolic-ref',
    '--quiet',
    '--short',
    `refs/remotes/${remote}/HEAD`
  ])
  if (head.code === 0 && head.stdout.trim()) return head.stdout.trim()
  for (const b of ['main', 'master']) {
    if (await refExists(repo, `refs/remotes/${remote}/${b}`)) return `${remote}/${b}`
  }
  return null
}

/** Whether nothing at HEAD is newer than the pull request: it's the PR's head or behind it. */
async function headInPr(
  worktree: string,
  head: string | null,
  pr: TaskPr | null
): Promise<boolean> {
  if (!head || !pr?.head) return false
  if (head === pr.head) return true
  return (await runGit(worktree, ['merge-base', '--is-ancestor', head, pr.head])).code === 0
}

type Gh = typeof runGh

export interface TaskStoreOptions {
  /** Where worktrees go: ~/.cockpit/worktrees. */
  dir: string
  /** config.json's settings for a repository, by its main checkout with ~ for home. */
  settings: (repo: string) => RepoTaskSettings | undefined
  onChange: (tasks: TaskInfo[]) => void
  /** How long an open pull request's state is kept before gh is asked again. */
  prMaxAgeMs?: number
  /** For tests. */
  gh?: Gh
}

interface PrEntry {
  branch: string
  at: number
  pr: TaskPr | null
  error: string | null
}

export type RemoveResult = { ok: true } | { ok: false; error: string }

/** gh calls at once. */
const GH_PARALLEL = 4
const FETCH_MS = 30_000
const ADD_MS = 120_000

export class TaskStore {
  private tasks: TaskInfo[] = []
  private sent = ''
  /** By the worktree's absolute path. */
  private readonly prs = new Map<string, PrEntry>()
  private readonly lookups = new Map<string, Promise<void>>()
  /** Setup commands waiting for their worktree's first terminal, by absolute path. */
  private readonly setups = new Map<string, string>()
  private chain: Promise<unknown> = Promise.resolve()
  private realDir: string | null = null
  private scannedAt = 0

  constructor(private readonly opts: TaskStoreOptions) {}

  list(): TaskInfo[] {
    return this.tasks
  }

  /** When the worktrees were last read, in ms since the epoch. */
  get lastScan(): number {
    return this.scannedAt
  }

  /** The repository a directory's task belongs to (both with ~), or null outside a task. */
  repoOf(dir: string): string | null {
    return this.tasks.find((t) => dir === t.path || dir.startsWith(`${t.path}/`))?.repo ?? null
  }

  /** Whether a directory (with ~) is in the worktrees folder, as a task or what's left of one. */
  holds(dir: string): boolean {
    const abs = expandHome(dir)
    return [this.opts.dir, this.realDir].some((d) => d !== null && abs.startsWith(d + path.sep))
  }

  /**
   * Read the worktrees again, then ask gh about the pull requests not asked
   * about lately, or about all of them with `force` (just `only`'s, if given).
   * A merged pull request isn't asked about again unless forced.
   */
  async refresh(force = false, only?: string): Promise<TaskInfo[]> {
    await this.serial(() => this.scan())
    await this.lookUpPrs(force, only)
    return this.tasks
  }

  /** A new worktree's setup command, once, for the first terminal that starts in it. */
  takeSetup(cwd: string): string | null {
    const setup = this.setups.get(cwd) ?? null
    this.setups.delete(cwd)
    return setup
  }

  /**
   * Makes a worktree for the branch in the repository `req.repo` is in, after
   * fetching from its remote. A branch that exists already is checked out;
   * one only on the remote tracks it; a new one starts at the remote's
   * default branch with no upstream, so the first push sets its own.
   */
  create(req: NewTask): Promise<NewTaskResult> {
    return this.serial(async (): Promise<NewTaskResult> => {
      const fail = (error: string): NewTaskResult => ({ ok: false, error })
      const from = expandHome(req.repo.trim())
      if (!from || !(await exists(from))) return fail(`${req.repo || 'That folder'} doesn't exist`)
      const list = await runGit(from, ['worktree', 'list', '--porcelain', '-z'])
      const main = list.code === 0 ? parseWorktrees(list.stdout)[0] : undefined
      if (!main) return fail(`${abbreviateHome(from)} isn't in a git repository`)
      if (main.bare) return fail("Tasks can't be made in a bare repository")

      const wanted = req.branch.trim()
      const checked = await runGit(main.path, ['check-ref-format', '--branch', wanted])
      const branch = checked.stdout.trim()
      if (!wanted || wanted.startsWith('-') || checked.code !== 0 || branch !== wanted) {
        return fail(`"${wanted}" isn't a branch name git accepts`)
      }

      const root = await this.root()
      const worktrees = parseWorktrees(list.stdout)
      const open = worktrees.find((w) => w.branch === branch)
      if (open) {
        if (open.path.startsWith(root + path.sep)) {
          return { ok: true, path: abbreviateHome(open.path), existing: true }
        }
        return fail(`${branch} is checked out in ${abbreviateHome(open.path)} already`)
      }

      const remote = await pickRemote(main.path)
      if (remote) await runGit(main.path, ['fetch', '--quiet', remote], { timeoutMs: FETCH_MS })
      const local = await refExists(main.path, `refs/heads/${branch}`)
      const tracked =
        !local && remote && (await refExists(main.path, `refs/remotes/${remote}/${branch}`))
          ? `${remote}/${branch}`
          : null

      const parent = path.join(root, worktreeName(path.basename(main.path)))
      let target = path.join(parent, worktreeName(branch))
      for (let n = 2; await exists(target); n++) {
        target = path.join(parent, `${worktreeName(branch)}-${String(n)}`)
      }
      await fs.mkdir(parent, { recursive: true })

      let args: string[]
      if (local) args = ['worktree', 'add', target, branch]
      else if (tracked) args = ['worktree', 'add', '--track', '-b', branch, target, tracked]
      else {
        const base = await baseRef(main.path, remote)
        args = ['worktree', 'add', '--no-track', '-b', branch, target, ...(base ? [base] : [])]
      }
      const added = await runGit(main.path, args, { timeoutMs: ADD_MS })
      if (added.code !== 0) {
        await fs.rmdir(parent).catch(() => undefined)
        return fail(firstLine(added.stderr) || 'git worktree add failed')
      }

      const repo = abbreviateHome(main.path)
      const settings = this.opts.settings(repo) ?? this.opts.settings(main.path)
      await copyInto(main.path, target, settings?.copy ?? [])
      if (settings?.setup) this.setups.set(target, settings.setup)
      await this.scan()
      return { ok: true, path: abbreviateHome(target), existing: false }
    })
  }

  /**
   * Removes a task's worktree, with `force` even when it has uncommitted
   * changes, and with `deleteBranch` its local branch too.
   */
  remove(taskPath: string, opts: { force: boolean; deleteBranch: boolean }): Promise<RemoveResult> {
    return this.serial(async (): Promise<RemoveResult> => {
      const root = await this.root()
      const abs = expandHome(taskPath)
      const task = this.tasks.find((t) => t.path === taskPath)
      if (!task || !abs.startsWith(root + path.sep))
        return { ok: false, error: 'That task is gone' }
      const main = expandHome(task.repo)
      const r = await runGit(
        main,
        ['worktree', 'remove', ...(opts.force ? ['--force'] : []), abs],
        { timeoutMs: ADD_MS }
      )
      if (r.code !== 0)
        return { ok: false, error: firstLine(r.stderr) || 'git worktree remove failed' }
      if (opts.deleteBranch && task.branch) await runGit(main, ['branch', '-D', task.branch])
      await runGit(main, ['worktree', 'prune'])
      // The repository's folder, once its last task is gone.
      await fs.rmdir(path.dirname(abs)).catch(() => undefined)
      this.prs.delete(abs)
      this.setups.delete(abs)
      await this.scan()
      return { ok: true }
    })
  }

  private serial<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.chain.then(fn, fn)
    this.chain = run.catch(() => undefined)
    return run
  }

  private async root(): Promise<string> {
    if (this.realDir) return this.realDir
    await fs.mkdir(this.opts.dir, { recursive: true })
    this.realDir = await fs.realpath(this.opts.dir)
    return this.realDir
  }

  private emit(): void {
    const json = JSON.stringify(this.tasks)
    if (json === this.sent) return
    this.sent = json
    this.opts.onChange(this.tasks)
  }

  /** Every worktree two levels under the root that git lists as a worktree of its repository. */
  private async scan(): Promise<TaskInfo[]> {
    const root = await this.root()
    const candidates = (
      await Promise.all(
        (await readdir(root)).map(async (repo) =>
          (await readdir(path.join(root, repo))).map((name) => path.join(root, repo, name))
        )
      )
    ).flat()
    const read = await Promise.all(candidates.map((c) => this.readOne(c)))
    const tasks = read
      .filter((t): t is TaskInfo => t !== null)
      .sort((a, b) => b.createdAt - a.createdAt)
    const live = new Set(tasks.map((t) => expandHome(t.path)))
    for (const p of this.prs.keys()) if (!live.has(p)) this.prs.delete(p)
    this.tasks = tasks
    this.scannedAt = Date.now()
    this.emit()
    return tasks
  }

  private async readOne(dir: string): Promise<TaskInfo | null> {
    const dotGit = await fs.stat(path.join(dir, '.git')).catch(() => null)
    if (!dotGit?.isFile()) return null
    const [list, status, rev] = await Promise.all([
      runGit(dir, ['worktree', 'list', '--porcelain', '-z']),
      runGit(dir, ['status', '--porcelain=v2', '--branch', '-z', '--untracked-files=normal']),
      runGit(dir, ['rev-parse', '--verify', '--quiet', 'HEAD'])
    ])
    if (list.code !== 0 || status.code !== 0) return null
    const worktrees = parseWorktrees(list.stdout)
    const main = worktrees[0]
    if (!main || main.path === dir || !worktrees.some((w) => w.path === dir)) return null
    const head = rev.code === 0 ? rev.stdout.trim() : null
    // Work merged into the main checkout locally isn't lost either.
    const unpushed = head
      ? await runGit(dir, [
          'rev-list',
          '--count',
          'HEAD',
          '--not',
          '--remotes',
          ...(main.head ? [main.head] : [])
        ])
      : null
    const s = parseStatus(status.stdout)
    const st = await fs.stat(dir)
    const known = this.prs.get(dir)
    const pr = known?.branch === s.branch ? known : null
    return {
      path: abbreviateHome(dir),
      repo: abbreviateHome(main.path),
      branch: s.branch,
      head,
      changed: s.changed,
      unpushed: unpushed?.code === 0 ? Number(unpushed.stdout.trim()) || 0 : 0,
      pr: pr?.pr ?? null,
      prError: pr?.error ?? null,
      inPr: await headInPr(dir, head, pr?.pr ?? null),
      createdAt: st.birthtimeMs || st.ctimeMs
    }
  }

  private async lookUpPrs(force: boolean, only?: string): Promise<void> {
    const now = Date.now()
    const maxAge = this.opts.prMaxAgeMs ?? 60_000
    const due = this.tasks.filter((t) => {
      if (!t.branch || (only !== undefined && t.path !== only)) return false
      const known = this.prs.get(expandHome(t.path))
      if (force || known?.branch !== t.branch) return true
      return known.pr?.state !== 'merged' && now - known.at >= maxAge
    })
    const queue = [...due]
    const worker = async (): Promise<void> => {
      for (let t = queue.shift(); t; t = queue.shift()) await this.lookUp(t)
    }
    await Promise.all(Array.from({ length: Math.min(GH_PARALLEL, queue.length) }, worker))
  }

  /** Asks gh for the branch's pull request and puts the answer in the list. */
  private lookUp(t: TaskInfo): Promise<void> {
    const abs = expandHome(t.path)
    const running = this.lookups.get(abs)
    if (running) return running
    const branch = t.branch ?? ''
    const gh = this.opts.gh ?? runGh
    const p = (async () => {
      // `pr view <branch>` would take a branch named 1234 for pull request #1234.
      const r = await gh(abs, [
        'pr',
        'list',
        '--head',
        branch,
        '--state',
        'all',
        '--limit',
        '1',
        '--json',
        PR_FIELDS
      ])
      const before = this.prs.get(abs)
      let entry: PrEntry
      if ('out' in r) {
        let pr: TaskPr | null = null
        try {
          pr = parseTaskPr(JSON.parse(r.out))
        } catch {
          // left as no pull request
        }
        entry = { branch, at: Date.now(), pr, error: null }
      } else {
        // Keep what was known; a network error doesn't close a pull request.
        const pr = before?.branch === branch ? before.pr : null
        entry = { branch, at: Date.now(), pr, error: r.error }
      }
      this.prs.set(abs, entry)
      const cur = this.tasks.find((x) => x.path === t.path)
      if (cur?.branch !== branch) return
      const inPr = await headInPr(abs, cur.head, entry.pr)
      this.tasks = this.tasks.map((x) =>
        x === cur ? { ...x, pr: entry.pr, prError: entry.error, inPr } : x
      )
      this.emit()
    })().finally(() => this.lookups.delete(abs))
    this.lookups.set(abs, p)
    return p
  }
}

/** Copies config.json's `copy` paths from the main checkout into a new worktree. Missing ones are skipped. */
async function copyInto(main: string, target: string, paths: readonly string[]): Promise<void> {
  for (const rel of paths) {
    if (!isRepoPath(rel)) continue
    const from = path.join(main, rel)
    const to = path.join(target, rel)
    try {
      if (!(await exists(from)) || (await exists(to))) continue
      await fs.mkdir(path.dirname(to), { recursive: true })
      await fs.cp(from, to, { recursive: true, force: false, errorOnExist: false })
    } catch (err) {
      console.warn(`could not copy ${rel} into ${abbreviateHome(target)}:`, err)
    }
  }
}
