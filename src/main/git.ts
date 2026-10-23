// The git state of a pane's directory for the Activity panel: branch,
// upstream, changed files, and the latest commits. Runs git without optional
// locks, so it never takes index.lock out from under an agent using git, and
// with core.fsmonitor off, so a repository's config can't name a program for
// Cockpit to run every few seconds just because a pane is in it.
import { execFile } from 'node:child_process'
import { GIT_MAX_FILES, type GitCommit, type GitFile, type GitStatus } from '@shared/activity'
import { abbreviateHome } from './paths'

const TIMEOUT_MS = 3000
const COMMITS = 5

function git(cwd: string, args: string[]): Promise<string | null> {
  return new Promise((resolve) => {
    execFile(
      'git',
      ['--no-optional-locks', '-c', 'core.fsmonitor=false', '-C', cwd, ...args],
      {
        timeout: TIMEOUT_MS,
        maxBuffer: 8 * 1024 * 1024,
        env: { ...process.env, GIT_OPTIONAL_LOCKS: '0', LC_ALL: 'C' }
      },
      (err, stdout) => {
        resolve(err ? null : stdout)
      }
    )
  })
}

export interface ParsedStatus {
  branch: string | null
  head: string | null
  upstream: string | null
  ahead: number
  behind: number
  files: GitFile[]
  changed: number
}

/** `git status --porcelain=v2 --branch -z` output. */
export function parseStatus(out: string): ParsedStatus {
  const s: ParsedStatus = {
    branch: null,
    head: null,
    upstream: null,
    ahead: 0,
    behind: 0,
    files: [],
    changed: 0
  }
  const fields = out.split('\0')
  const add = (f: GitFile): void => {
    s.changed++
    if (s.files.length < GIT_MAX_FILES) s.files.push(f)
  }
  // The path is everything after a fixed number of space-separated fields.
  const pathAfter = (rec: string, n: number): string => rec.split(' ').slice(n).join(' ')
  for (let i = 0; i < fields.length; i++) {
    const rec = fields[i] ?? ''
    if (rec.startsWith('# ')) {
      const [, key, ...rest] = rec.split(' ')
      const value = rest.join(' ')
      if (key === 'branch.oid') s.head = value === '(initial)' ? null : value.slice(0, 7)
      else if (key === 'branch.head') s.branch = value === '(detached)' ? null : value
      else if (key === 'branch.upstream') s.upstream = value
      else if (key === 'branch.ab') {
        const m = /^\+(\d+) -(\d+)$/.exec(value)
        if (m) {
          s.ahead = Number(m[1])
          s.behind = Number(m[2])
        }
      }
    } else if (rec.startsWith('1 ') || rec.startsWith('u ')) {
      const xy = rec.slice(2, 4)
      add({
        path: pathAfter(rec, rec.startsWith('1 ') ? 8 : 10),
        from: null,
        index: xy[0] ?? '.',
        worktree: xy[1] ?? '.'
      })
    } else if (rec.startsWith('2 ')) {
      // Renames and copies: with -z, the original path is the next field.
      const xy = rec.slice(2, 4)
      const from = fields[++i] ?? null
      add({ path: pathAfter(rec, 9), from, index: xy[0] ?? '.', worktree: xy[1] ?? '.' })
    } else if (rec.startsWith('? ')) {
      add({ path: rec.slice(2), from: null, index: '?', worktree: '?' })
    }
  }
  return s
}

/** `git log --format=%h%x1f%ct%x1f%s` output. */
export function parseLog(out: string): GitCommit[] {
  return out
    .split('\n')
    .map((line) => line.split('\x1f'))
    .filter((parts) => parts.length >= 3 && parts[0])
    .map(([hash = '', at = '0', ...subject]) => ({
      hash,
      at: Number(at) * 1000,
      subject: subject.join('\x1f')
    }))
}

/** The top level of the directory's repository, or null when it isn't in one. */
export async function gitRoot(cwd: string): Promise<string | null> {
  return (await git(cwd, ['rev-parse', '--show-toplevel']))?.trim() ?? null
}

/** The directory's repository, or null when it isn't in one (or git isn't installed). */
export async function gitStatus(cwd: string): Promise<GitStatus | null> {
  const [root, status, log] = await Promise.all([
    git(cwd, ['rev-parse', '--show-toplevel']),
    git(cwd, ['status', '--porcelain=v2', '--branch', '-z', '--untracked-files=normal']),
    git(cwd, ['log', '-n', String(COMMITS), '--format=%h%x1f%ct%x1f%s'])
  ])
  if (root === null || status === null) return null
  return {
    root: abbreviateHome(root.trim()),
    ...parseStatus(status),
    // Fails before the first commit.
    commits: log === null ? [] : parseLog(log)
  }
}
