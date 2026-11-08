// Tasks: an agent's work on a branch of its own, in a git worktree Cockpit
// made under ~/.cockpit/worktrees/, so agents working in the same repository
// at the same time don't share a working tree. Main reads each task from git
// and gh; nothing about one is stored besides the worktree. Pure, so the
// rules can be unit tested.
import type { PrChecks, PrReview } from './prs'

export type TaskPrState = 'open' | 'merged' | 'closed'

/** The pull request for a task's branch, as gh reports it. */
export interface TaskPr {
  number: number
  title: string
  url: string
  state: TaskPrState
  draft: boolean
  checks: PrChecks
  review: PrReview
  /** The commit GitHub has at the head of the pull request's branch. */
  head: string
  /** The branch the pull request merges into. */
  base: string
}

export interface TaskInfo {
  /** The worktree, with ~ for home. */
  path: string
  /** The repository's main checkout, with ~ for home. */
  repo: string
  /** Null while HEAD is detached. */
  branch: string | null
  /** The full hash of the commit checked out. */
  head: string | null
  /** Files with changes that aren't committed, untracked ones included. */
  changed: number
  /** Commits on HEAD that no remote-tracking branch has. */
  unpushed: number
  /** The newest pull request for the branch, or null when it has none (or gh couldn't say). */
  pr: TaskPr | null
  /** Why gh couldn't look up the pull request. */
  prError: string | null
  /** HEAD is the pull request's head or behind it, so nothing here is newer than the PR. */
  inPr: boolean
  /** When the worktree was made, in ms since the epoch. */
  createdAt: number
}

export interface NewTask {
  /** A directory in the repository: its main checkout, a worktree, or a folder in one. */
  repo: string
  branch: string
  /**
   * The branch a new branch starts from, instead of the remote's default
   * branch: the remote's copy when it has one, else the local one. A branch
   * that exists already ignores it.
   */
  base?: string
}

export type NewTaskResult =
  | {
      ok: true
      /** The worktree, with ~ for home. */
      path: string
      /** The branch already had a task, and this is its worktree. */
      existing: boolean
    }
  | { ok: false; error: string }

/** What the New task dialog starts with, from a widget or the Tasks panel. */
export interface TaskDraft {
  branch?: string
  prompt?: string
  /** A directory in the repository to suggest. */
  repo?: string
  /** The preset to start with, from the Cmd+T picker. */
  presetId?: string
}

export const MAX_BRANCH = 200

/**
 * config.json's `tasks`, keyed by a repository's main checkout with ~ for
 * home ("~/dev/cockpit").
 */
export interface RepoTaskSettings {
  /**
   * Runs in a new worktree's first terminal before its agent starts, through
   * sh in the login shell's environment: "bun install".
   */
  setup?: string
  /**
   * Files and folders git doesn't track that a worktree needs, relative to
   * the repository, copied from the main checkout: ".env".
   */
  copy: string[]
}

export type TaskSettings = Record<string, RepoTaskSettings>

const MAX_REPOS = 100
const MAX_COPY = 50
const MAX_SETUP = 4000

type Obj = Record<string, unknown>
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v)

/** A path inside the repository: relative, with no `..` and no empty parts. */
export function isRepoPath(p: string): boolean {
  if (!p || p.length > 1024 || p.startsWith('/') || p.startsWith('~')) return false
  return p.split('/').every((part) => part !== '' && part !== '.' && part !== '..')
}

export function readTaskSettings(v: unknown): TaskSettings {
  const out: TaskSettings = {}
  if (!isObj(v)) return out
  for (const [repo, raw] of Object.entries(v).slice(0, MAX_REPOS)) {
    const key = repo.trim().replace(/\/+$/, '')
    // A path: ~/dev/app or /Users/me/dev/app.
    if (!/^[~/]/.test(key) || key.length > 1024 || !isObj(raw)) continue
    const settings: RepoTaskSettings = { copy: [] }
    if (typeof raw.setup === 'string' && raw.setup.trim()) {
      settings.setup = raw.setup.trim().slice(0, MAX_SETUP)
    }
    if (Array.isArray(raw.copy)) {
      const paths = raw.copy
        .filter((p): p is string => typeof p === 'string')
        .map((p) => p.trim().replace(/\/+$/, ''))
        .filter(isRepoPath)
      settings.copy = [...new Set(paths)].slice(0, MAX_COPY)
    }
    out[key] = settings
  }
  return out
}

/**
 * Whether git would take `name` as a branch, by the rules of
 * git-check-ref-format, for feedback while it's typed. Main asks git itself
 * before making one.
 */
export function validBranch(name: string): boolean {
  if (!name || name.length > MAX_BRANCH) return false
  if (name.startsWith('-') || name.startsWith('/') || name.endsWith('/')) return false
  if (name.endsWith('.') || name.endsWith('.lock') || name === '@') return false
  if (/[\s~^:?*[\\]|\.\.|@\{|\/\/|\/\./.test(name)) return false
  for (let i = 0; i < name.length; i++) {
    const code = name.charCodeAt(i)
    if (code < 0x20 || code === 0x7f) return false
  }
  return !name.startsWith('.')
}

/** The folder a branch's worktree gets: `nick/sc-12/fix-it` is `nick-sc-12-fix-it`. */
export function worktreeName(branch: string): string {
  const name = branch
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '')
  return name.slice(0, 80).replace(/[-.]+$/, '') || 'task'
}

/** The task whose worktree holds `dir`; both have ~ for home. */
export function taskAt<T extends Pick<TaskInfo, 'path'>>(
  tasks: readonly T[],
  dir: string
): T | null {
  return tasks.find((t) => dir === t.path || dir.startsWith(`${t.path}/`)) ?? null
}

/**
 * Safe to remove without asking: GitHub merged its pull request, nothing is
 * left uncommitted, and nothing here is newer than what was merged.
 */
export function mergedAndClean(t: TaskInfo): boolean {
  return t.pr?.state === 'merged' && t.changed === 0 && t.inPr
}

/** The local branch goes too only when its work is merged on GitHub. */
export function deletesBranch(t: TaskInfo): boolean {
  return t.branch !== null && t.pr?.state === 'merged' && t.inPr
}

const plural = (n: number, one: string, many = `${one}s`): string =>
  `${String(n)} ${n === 1 ? one : many}`

/**
 * What removing a task loses or keeps, one line each, for the dialog that
 * asks first. Empty when there is nothing to warn about.
 */
export function removalWarnings(t: TaskInfo, terminals: number): string[] {
  const lines: string[] = []
  if (t.changed > 0) {
    lines.push(`${plural(t.changed, 'file has', 'files have')} changes that aren't committed.`)
  }
  if (t.branch && !deletesBranch(t)) {
    // After a squash merge the merged commits are on no remote either, so
    // there's no count of what's newer.
    if (t.pr?.state === 'merged') {
      lines.push(`The branch ${t.branch} is kept: it has commits the merged pull request doesn't.`)
    } else {
      const commits = t.unpushed > 0 ? `, with ${plural(t.unpushed, 'commit')} on no remote` : ''
      lines.push(`The branch ${t.branch} is kept${commits}.`)
    }
  } else if (!t.branch && t.unpushed > 0) {
    lines.push(
      `HEAD is detached, and ${plural(t.unpushed, 'commit')} on it ${t.unpushed === 1 ? "isn't" : "aren't"} on any branch or remote.`
    )
  }
  if (terminals > 0) {
    lines.push(`${plural(terminals, 'terminal')} in it will close.`)
  }
  return lines
}

/** A one-word state for the panel and the session list. */
export function prLabel(pr: TaskPr): string {
  if (pr.state !== 'open') return pr.state
  if (pr.draft) return 'draft'
  if (pr.checks === 'failing') return 'failing'
  if (pr.review === 'approved') return 'approved'
  if (pr.review === 'changes') return 'changes'
  if (pr.checks === 'pending') return 'checks'
  return 'open'
}
