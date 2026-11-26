// Reads a worktree or repository's diff since merge-base with the remote's
// default branch, plus uncommitted and untracked files, via runGit.
import fs from 'node:fs/promises'
import path from 'node:path'
import {
  MAX_DIFF_FILES,
  MAX_FILE_DIFF_LINES,
  parseUnifiedDiff,
  type DiffFile,
  type ReviewDiffResult
} from '@shared/review'
import { runGit, type GitRun } from './git'
import { abbreviateHome, expandHome } from './paths'

const GIT_MS = 15_000
const MAX_DIFF_BUFFER = 16 * 1024 * 1024
const MAX_UNTRACKED_FILES = 50
const MAX_UNTRACKED_BYTES = 256 * 1024
const BINARY_PROBE_BYTES = 8192

const git = (cwd: string, args: string[], maxBuffer?: number): Promise<GitRun> =>
  runGit(cwd, args, { timeoutMs: GIT_MS, ...(maxBuffer ? { maxBuffer } : {}) })

async function refExists(repo: string, ref: string): Promise<boolean> {
  return (await git(repo, ['show-ref', '--verify', '--quiet', ref])).code === 0
}

/** `origin`, or else the first remote, or null without any. */
async function pickRemote(repo: string): Promise<string | null> {
  const r = await git(repo, ['remote'])
  const remotes = r.code === 0 ? r.stdout.split('\n').filter(Boolean) : []
  return remotes.includes('origin') ? 'origin' : (remotes[0] ?? null)
}

/** The remote's default branch ref (e.g. `origin/main`), or local `main`/`master`. */
async function resolveBaseRef(repo: string, currentBranch: string | null): Promise<string | null> {
  const remote = await pickRemote(repo)
  if (remote) {
    const head = await git(repo, [
      'symbolic-ref',
      '--quiet',
      '--short',
      `refs/remotes/${remote}/HEAD`
    ])
    if (head.code === 0 && head.stdout.trim()) return head.stdout.trim()
    for (const b of ['main', 'master']) {
      if (await refExists(repo, `refs/remotes/${remote}/${b}`)) return `${remote}/${b}`
    }
  }
  for (const b of ['main', 'master']) {
    if (b !== currentBranch && (await refExists(repo, `refs/heads/${b}`))) return b
  }
  return null
}

/** Build a synthetic DiffFile for an untracked file in the working tree. */
async function readUntrackedFile(root: string, relPath: string): Promise<DiffFile | null> {
  const abs = path.join(root, relPath)
  try {
    const st = await fs.stat(abs)
    if (!st.isFile()) return null
    if (st.size > MAX_UNTRACKED_BYTES) {
      return {
        path: relPath,
        oldPath: null,
        status: 'untracked',
        binary: false,
        added: 0,
        removed: 0,
        totalLines: 0,
        truncated: true,
        hunks: []
      }
    }
    const buf = await fs.readFile(abs)
    const probeLen = Math.min(buf.length, BINARY_PROBE_BYTES)
    let isBinary = false
    for (let i = 0; i < probeLen; i++) {
      if (buf[i] === 0) {
        isBinary = true
        break
      }
    }
    if (isBinary) {
      return {
        path: relPath,
        oldPath: null,
        status: 'untracked',
        binary: true,
        added: 0,
        removed: 0,
        totalLines: 0,
        truncated: false,
        hunks: []
      }
    }
    const text = buf.toString('utf8')
    const rawLines =
      text.length === 0
        ? []
        : text.endsWith('\n')
          ? text.slice(0, -1).split('\n')
          : text.split('\n')
    const truncated = rawLines.length > MAX_FILE_DIFF_LINES
    const shown = truncated ? rawLines.slice(0, MAX_FILE_DIFF_LINES) : rawLines
    const hunks =
      shown.length > 0
        ? [
            {
              header: `@@ -0,0 +1,${String(rawLines.length)} @@`,
              oldStart: 0,
              oldCount: 0,
              newStart: 1,
              newCount: rawLines.length,
              lines: shown.map((line, i) => ({
                kind: 'add' as const,
                oldLine: null,
                newLine: i + 1,
                text: line
              }))
            }
          ]
        : []
    return {
      path: relPath,
      oldPath: null,
      status: 'untracked',
      binary: false,
      added: rawLines.length,
      removed: 0,
      totalLines: rawLines.length,
      truncated,
      hunks
    }
  } catch {
    return null
  }
}

/**
 * Compute the review diff for `dir`: changes since merge-base with the remote's
 * default branch plus staged, unstaged, and untracked files.
 */
export async function readReviewDiff(dir: string): Promise<ReviewDiffResult> {
  const abs = expandHome(dir.trim())
  if (!abs) return { ok: false, error: 'No directory specified' }

  const top = await git(abs, ['rev-parse', '--show-toplevel'])
  if (top.code !== 0 || !top.stdout.trim()) {
    return { ok: false, error: `${abbreviateHome(abs)} is not in a git repository` }
  }
  const root = top.stdout.trim()

  const [branchRes, headRes] = await Promise.all([
    git(root, ['symbolic-ref', '--quiet', '--short', 'HEAD']),
    git(root, ['rev-parse', '--verify', '--quiet', 'HEAD'])
  ])
  const branch = branchRes.code === 0 && branchRes.stdout.trim() ? branchRes.stdout.trim() : null
  const head = headRes.code === 0 && headRes.stdout.trim() ? headRes.stdout.trim() : null

  let base: string | null = null
  let mergeBase: string | null = null
  let diffTarget: string | null = null

  if (head) {
    const baseRef = await resolveBaseRef(root, branch)
    if (baseRef) {
      const mbRes = await git(root, ['merge-base', baseRef, 'HEAD'])
      if (mbRes.code === 0 && mbRes.stdout.trim()) {
        const mb = mbRes.stdout.trim()
        base = baseRef
        mergeBase = mb.slice(0, 7)
        diffTarget = mb
      }
    }
    if (!diffTarget) {
      base = 'HEAD'
      diffTarget = 'HEAD'
    }
  }

  // `git diff <target>` compares <target> directly to the working tree,
  // combining commits since merge-base, staged changes, and unstaged changes.
  const diffArgs = diffTarget
    ? ['diff', '--no-ext-diff', '--no-color', '-M', '--unified=3', diffTarget]
    : ['diff', '--no-ext-diff', '--no-color', '-M', '--unified=3', '--cached']

  const [diffRes, untrackedRes] = await Promise.all([
    git(root, diffArgs, MAX_DIFF_BUFFER),
    git(root, ['ls-files', '--others', '--exclude-standard', '-z'])
  ])

  let truncated = false
  let files: DiffFile[] = []

  if (diffRes.code === 0) {
    const parsed = parseUnifiedDiff(diffRes.stdout)
    files = parsed.files
    truncated = parsed.truncated
  } else if (diffRes.stdout.length > 0) {
    // Even if git hit maxBuffer, parse what we got and mark truncated.
    const parsed = parseUnifiedDiff(diffRes.stdout)
    files = parsed.files
    truncated = true
  } else if (diffTarget) {
    const first = diffRes.stderr.trim().split('\n')[0]
    const msg = first && first.length > 0 ? first : 'git diff failed'
    return { ok: false, error: msg }
  }

  if (untrackedRes.code === 0 && untrackedRes.stdout) {
    const trackedPaths = new Set(files.map((f) => f.path))
    const untrackedPaths = untrackedRes.stdout
      .split('\0')
      .filter((p) => p.length > 0 && !trackedPaths.has(p))
    if (
      untrackedPaths.length > MAX_UNTRACKED_FILES ||
      files.length + untrackedPaths.length > MAX_DIFF_FILES
    ) {
      truncated = true
    }
    const room = Math.max(0, Math.min(MAX_UNTRACKED_FILES, MAX_DIFF_FILES - files.length))
    const untracked = await Promise.all(
      untrackedPaths.slice(0, room).map((p) => readUntrackedFile(root, p))
    )
    for (const f of untracked) {
      if (f) files.push(f)
    }
  }

  files.sort((a, b) => a.path.localeCompare(b.path))
  const totalAdded = files.reduce((n, f) => n + f.added, 0)
  const totalRemoved = files.reduce((n, f) => n + f.removed, 0)

  return {
    ok: true,
    diff: {
      root: abbreviateHome(root),
      branch,
      base,
      mergeBase,
      files,
      totalAdded,
      totalRemoved,
      truncated,
      fetchedAt: Date.now()
    }
  }
}
