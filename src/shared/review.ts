// Diff review pane: data types, unified diff parser, and comment-to-prompt
// formatting. Pure so it can be unit tested.

/** A diff review pane's target: the worktree or checkout directory (with ~ for home). */
export interface ReviewRef {
  dir: string
  /** Last known branch name, used as a tab label before the first diff loads. */
  branch?: string
}

export function isReviewRef(v: unknown): v is ReviewRef {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return false
  const { dir, branch } = v as Record<string, unknown>
  if (typeof dir !== 'string' || dir.length === 0 || dir.length > 4096) return false
  if (
    branch !== undefined &&
    (typeof branch !== 'string' || branch.length === 0 || branch.length > 256)
  ) {
    return false
  }
  return true
}

export type DiffFileStatus = 'added' | 'modified' | 'deleted' | 'renamed' | 'untracked'

export type DiffLineKind = 'context' | 'add' | 'del' | 'meta'

export interface DiffLine {
  kind: DiffLineKind
  /** Line number in the old (base) file, or null for added/meta lines. */
  oldLine: number | null
  /** Line number in the new (working tree) file, or null for deleted/meta lines. */
  newLine: number | null
  /** Line text without the leading +, -, or space prefix. */
  text: string
}

export interface DiffHunk {
  header: string
  oldStart: number
  oldCount: number
  newStart: number
  newCount: number
  lines: DiffLine[]
}

export interface DiffFile {
  /** Repo-relative path (the new path for renames). */
  path: string
  /** Original path before a rename, or null. */
  oldPath: string | null
  status: DiffFileStatus
  binary: boolean
  added: number
  removed: number
  /** Total diff lines before per-file capping. */
  totalLines: number
  /** True when the file's hunks were capped for display. */
  truncated: boolean
  hunks: DiffHunk[]
}

export interface ReviewDiff {
  /** Top-level directory of the worktree/repository, with ~ for home. */
  root: string
  /** Current branch name, or null if detached. */
  branch: string | null
  /** Human-readable base compared against (e.g. "origin/main" or "HEAD"). */
  base: string | null
  /** Short commit SHA of the merge-base, if comparing against a base branch. */
  mergeBase: string | null
  files: DiffFile[]
  totalAdded: number
  totalRemoved: number
  /** True if the diff was truncated (too many files or too large). */
  truncated: boolean
  /** ms since the epoch when read. */
  fetchedAt: number
}

export type ReviewDiffResult = { ok: true; diff: ReviewDiff } | { ok: false; error: string }

/** A draft comment attached to a line or line range in a diff file. */
export interface ReviewComment {
  id: string
  path: string
  /** First line number in the range (1-based). */
  startLine: number
  /** Last line number in the range (1-based, >= startLine). */
  endLine: number
  /** Which side of the diff the line numbers refer to. */
  side: 'new' | 'old'
  /** Code excerpt for the commented line(s), prefixed with +, -, or space. */
  excerpt: string
  /** The reviewer's comment text. */
  body: string
}

/** Per-file diff line cap so huge generated/lock files don't freeze the renderer. */
export const MAX_FILE_DIFF_LINES = 1200
/** Maximum number of files parsed from a single diff. */
export const MAX_DIFF_FILES = 200
/** Files larger than this start collapsed in the UI. */
export const AUTO_COLLAPSE_LINES = 300

export function startsCollapsed(
  file: Pick<DiffFile, 'binary' | 'truncated' | 'totalLines'>
): boolean {
  return file.binary || file.truncated || file.totalLines > AUTO_COLLAPSE_LINES
}

/** Unquote a git C-escaped path like `"a/foo \"bar\".ts"` if quoted. */
function unquoteGitPath(raw: string): string {
  const trimmed = raw.trim()
  if (!trimmed.startsWith('"') || !trimmed.endsWith('"')) return trimmed
  const inner = trimmed.slice(1, -1)
  return inner.replace(/\\([\\nrt"']|[0-7]{3})/g, (_, esc: string) => {
    if (esc === 'n') return '\n'
    if (esc === 'r') return '\r'
    if (esc === 't') return '\t'
    if (esc === '"' || esc === "'" || esc === '\\') return esc
    return String.fromCharCode(Number.parseInt(esc, 8))
  })
}

/** Strip leading `a/` or `b/` from a git diff header path. */
function stripPrefix(p: string): string {
  const unquoted = unquoteGitPath(p)
  if (unquoted.startsWith('a/') || unquoted.startsWith('b/')) return unquoted.slice(2)
  return unquoted
}

/** Extract `old` and `new` paths from `diff --git a/... b/...`. */
function parseDiffGitHeader(line: string): { oldPath: string; newPath: string } | null {
  const rest = line.slice('diff --git '.length)
  // Quoted paths: "a/..." "b/..."
  if (rest.startsWith('"')) {
    const m = /^("(?:[^"\\]|\\.)*")\s+("(?:[^"\\]|\\.)*"|\S+)$/.exec(rest)
    if (m?.[1] && m[2]) {
      return { oldPath: stripPrefix(m[1]), newPath: stripPrefix(m[2]) }
    }
  }
  const idx = rest.indexOf(' b/')
  if (idx !== -1) {
    return {
      oldPath: stripPrefix(rest.slice(0, idx)),
      newPath: stripPrefix(rest.slice(idx + 1))
    }
  }
  const parts = rest.split(' ')
  if (parts.length >= 2 && parts[0] && parts[1]) {
    return { oldPath: stripPrefix(parts[0]), newPath: stripPrefix(parts[1]) }
  }
  return null
}

const HUNK_RE = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(.*)$/

export interface ParseDiffOptions {
  maxFileLines?: number
  maxFiles?: number
}

/**
 * Parse unified `git diff` output into structured files and hunks.
 * Caps per-file lines and total files so massive diffs stay responsive.
 */
export function parseUnifiedDiff(
  raw: string,
  opts: ParseDiffOptions = {}
): { files: DiffFile[]; truncated: boolean } {
  const maxFileLines = opts.maxFileLines ?? MAX_FILE_DIFF_LINES
  const maxFiles = opts.maxFiles ?? MAX_DIFF_FILES
  if (!raw.trim()) return { files: [], truncated: false }

  const lines = raw.split('\n')
  const files: DiffFile[] = []
  let truncated = false
  let cur: DiffFile | null = null
  let curHunk: DiffHunk | null = null
  let oldLine = 0
  let newLine = 0
  let keptLines = 0

  const flushHunk = (): void => {
    if (cur && curHunk) {
      cur.hunks.push(curHunk)
      curHunk = null
    }
  }

  const flushFile = (): void => {
    flushHunk()
    if (cur) {
      files.push(cur)
      cur = null
    }
  }

  for (const line of lines) {
    if (line.startsWith('diff --git ')) {
      flushFile()
      if (files.length >= maxFiles) {
        truncated = true
        break
      }
      const parsed = parseDiffGitHeader(line)
      cur = {
        path: parsed?.newPath ?? '',
        oldPath: null,
        status: 'modified',
        binary: false,
        added: 0,
        removed: 0,
        totalLines: 0,
        truncated: false,
        hunks: []
      }
      keptLines = 0
      continue
    }

    if (!cur) continue

    if (!curHunk) {
      if (line.startsWith('new file mode ')) {
        cur.status = 'added'
        continue
      }
      if (line.startsWith('deleted file mode ')) {
        cur.status = 'deleted'
        continue
      }
      if (line.startsWith('rename from ')) {
        cur.status = 'renamed'
        cur.oldPath = unquoteGitPath(line.slice('rename from '.length))
        continue
      }
      if (line.startsWith('rename to ')) {
        cur.status = 'renamed'
        cur.path = unquoteGitPath(line.slice('rename to '.length))
        continue
      }
      if (line.startsWith('Binary files ') || line === 'GIT binary patch') {
        cur.binary = true
        continue
      }
      if (line.startsWith('--- ')) {
        const p = line.slice(4)
        if (p !== '/dev/null' && !cur.oldPath && cur.status === 'deleted') {
          cur.path = stripPrefix(p)
        }
        continue
      }
      if (line.startsWith('+++ ')) {
        const p = line.slice(4)
        if (p !== '/dev/null') cur.path = stripPrefix(p)
        continue
      }
    }

    if (line.startsWith('@@ ')) {
      const m = HUNK_RE.exec(line)
      if (m) {
        flushHunk()
        oldLine = Number(m[1])
        const oldCount = m[2] === undefined ? 1 : Number(m[2])
        newLine = Number(m[3])
        const newCount = m[4] === undefined ? 1 : Number(m[4])
        if (keptLines < maxFileLines) {
          curHunk = {
            header: line,
            oldStart: oldLine,
            oldCount,
            newStart: newLine,
            newCount,
            lines: []
          }
        } else {
          cur.truncated = true
        }
        continue
      }
    }

    if (!curHunk && !cur.truncated) continue

    const ch = line[0]
    if (ch === '+') {
      cur.added++
      cur.totalLines++
      if (curHunk && keptLines < maxFileLines) {
        curHunk.lines.push({ kind: 'add', oldLine: null, newLine, text: line.slice(1) })
        keptLines++
      } else {
        cur.truncated = true
      }
      newLine++
    } else if (ch === '-') {
      cur.removed++
      cur.totalLines++
      if (curHunk && keptLines < maxFileLines) {
        curHunk.lines.push({ kind: 'del', oldLine, newLine: null, text: line.slice(1) })
        keptLines++
      } else {
        cur.truncated = true
      }
      oldLine++
    } else if (ch === ' ') {
      cur.totalLines++
      if (curHunk && keptLines < maxFileLines) {
        curHunk.lines.push({ kind: 'context', oldLine, newLine, text: line.slice(1) })
        keptLines++
      } else {
        cur.truncated = true
      }
      oldLine++
      newLine++
    } else if (line.startsWith('\\ ')) {
      if (curHunk && keptLines < maxFileLines) {
        curHunk.lines.push({ kind: 'meta', oldLine: null, newLine: null, text: line })
        keptLines++
      }
    }
  }

  flushFile()
  return { files, truncated }
}

/** Main refuses prompts over 20,000 chars; keep room for safety. */
const PROMPT_BUDGET = 19_000
const MAX_EXCERPT_CHARS = 1_500
const MAX_COMMENT_CHARS = 3_000

function formatLocation(c: Pick<ReviewComment, 'path' | 'startLine' | 'endLine' | 'side'>): string {
  const range =
    c.startLine === c.endLine
      ? `line ${String(c.startLine)}`
      : `lines ${String(c.startLine)}-${String(c.endLine)}`
  const sideNote = c.side === 'old' ? ' (removed)' : ''
  return `${c.path} ${range}${sideNote}`
}

function clipText(text: string, max: number): string {
  const t = text.trim()
  return t.length <= max ? t : `${t.slice(0, max).trimEnd()}…`
}

/**
 * Format all draft review comments into one structured prompt for an agent pane.
 * Sorted by file path then line number, and capped to stay within main's prompt limit.
 */
export function formatReviewPrompt(
  comments: readonly ReviewComment[],
  ctx: { branch?: string | null; base?: string | null } = {}
): string {
  if (comments.length === 0) return ''

  const sorted = [...comments].sort(
    (a, b) => a.path.localeCompare(b.path) || a.startLine - b.startLine || a.endLine - b.endLine
  )
  const one = sorted.length === 1
  const where = ctx.branch
    ? `on branch \`${ctx.branch}\`${ctx.base ? ` (vs \`${ctx.base}\`)` : ''}`
    : 'on the current changes'
  const head = `Please address ${one ? 'this code review comment' : `these ${String(sorted.length)} code review comments`} ${where}:`
  const tail = `Fix what ${one ? 'it asks' : 'each one asks'} for, or explain why not. Summarize what you changed when done.`

  const SEP = 2
  let used = head.length + tail.length + SEP
  const parts: string[] = []

  for (const [i, c] of sorted.entries()) {
    const loc = formatLocation(c)
    const body = clipText(c.body, MAX_COMMENT_CHARS)
    const excerpt = c.excerpt.trim()
      ? clipText(c.excerpt, MAX_EXCERPT_CHARS).replaceAll('```', "'''")
      : ''
    const full = excerpt
      ? `${String(i + 1)}. ${loc}\n\`\`\`diff\n${excerpt}\n\`\`\`\n${body}`
      : `${String(i + 1)}. ${loc}\n${body}`
    const compact = `${String(i + 1)}. ${loc}\n${body}`
    const part = used + full.length + SEP <= PROMPT_BUDGET ? full : compact
    if (used + part.length + SEP > PROMPT_BUDGET) {
      const remaining = sorted.length - i
      parts.push(
        `(${String(remaining)} more comment${remaining === 1 ? '' : 's'} omitted to fit the prompt limit.)`
      )
      break
    }
    used += part.length + SEP
    parts.push(part)
  }

  return [head, ...parts, tail].join('\n\n')
}
