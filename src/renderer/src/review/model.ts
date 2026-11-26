// Pure helpers for the diff review pane: choosing which agent pane receives
// comments and building line-range excerpts.
import type { PaneSession } from '@shared/ipc'
import type { DiffLine } from '@shared/review'
import type { TaskInfo } from '@shared/tasks'
import type { HandOffChoice } from '../prs/model'

const inside = (cwd: string, dir: string): boolean => cwd === dir || cwd.startsWith(`${dir}/`)

const running = (s: PaneSession): boolean => s.agent !== null && s.status !== 'exited'

/**
 * Where review comments can be sent, in menu groups:
 * 1. Running agent panes in the reviewed worktree/directory (or a new agent in its task).
 * 2. Other running agent panes.
 * 3. A new agent tab in the reviewed directory.
 */
export function reviewHandOffChoices(
  dir: string,
  branch: string | null,
  sessions: readonly PaneSession[],
  tasks: readonly TaskInfo[]
): HandOffChoice[][] {
  const task = tasks.find((t) => inside(dir, t.path)) ?? null
  const scope = task?.path ?? dir
  const inScope = sessions.filter((s) => running(s) && inside(s.cwd, scope))
  const own: HandOffChoice[] = inScope.map((s) => ({
    label: `${s.title ?? s.name}${branch ? ` (${branch})` : ''}${s.status === 'working' ? ' · working' : ''}`,
    target: { kind: 'pane', paneId: s.id }
  }))
  if (task && inScope.length === 0) {
    own.push({
      label: `New agent in task${branch ? ` ${branch}` : ''}`,
      target: { kind: 'task', path: task.path }
    })
  }
  const others = sessions
    .filter((s) => running(s) && !inScope.includes(s))
    .map((s): HandOffChoice => ({
      label: `${s.title ?? s.name} · ${s.cwd}`,
      target: { kind: 'pane', paneId: s.id }
    }))
  const fresh: HandOffChoice[] = [
    { label: `New agent in ${dir}`, target: { kind: 'newSession', cwd: dir } }
  ]
  return [own, others, fresh].filter((g) => g.length > 0)
}

/** The single obvious running agent pane in `dir` (or its task), or null if 0 or >1. */
export function soleAgentInDir(
  dir: string,
  sessions: readonly PaneSession[],
  tasks: readonly TaskInfo[]
): PaneSession | null {
  const task = tasks.find((t) => inside(dir, t.path)) ?? null
  const scope = task?.path ?? dir
  const matches = sessions.filter((s) => running(s) && inside(s.cwd, scope))
  return matches.length === 1 ? (matches[0] ?? null) : null
}

/** Build a diff-prefixed excerpt for lines [fromIdx..toIdx] within a hunk. */
export function buildLineExcerpt(
  lines: readonly DiffLine[],
  fromIdx: number,
  toIdx: number
): string {
  const lo = Math.max(0, Math.min(fromIdx, toIdx))
  const hi = Math.min(lines.length - 1, Math.max(fromIdx, toIdx))
  const out: string[] = []
  for (let i = lo; i <= hi; i++) {
    const l = lines[i]
    if (!l || l.kind === 'meta') continue
    const prefix = l.kind === 'add' ? '+' : l.kind === 'del' ? '-' : ' '
    out.push(`${prefix}${l.text}`)
  }
  return out.join('\n')
}

/** Resolve the 1-based start/end line numbers and side for a hunk line range. */
export function resolveLineRange(
  lines: readonly DiffLine[],
  fromIdx: number,
  toIdx: number
): { startLine: number; endLine: number; side: 'new' | 'old' } | null {
  const lo = Math.max(0, Math.min(fromIdx, toIdx))
  const hi = Math.min(lines.length - 1, Math.max(fromIdx, toIdx))
  const slice = lines.slice(lo, hi + 1).filter((l) => l.kind !== 'meta')
  if (slice.length === 0) return null
  const newNums = slice.map((l) => l.newLine).filter((n): n is number => n !== null)
  if (newNums.length > 0) {
    return {
      startLine: Math.min(...newNums),
      endLine: Math.max(...newNums),
      side: 'new'
    }
  }
  const oldNums = slice.map((l) => l.oldLine).filter((n): n is number => n !== null)
  if (oldNums.length > 0) {
    return {
      startLine: Math.min(...oldNums),
      endLine: Math.max(...oldNums),
      side: 'old'
    }
  }
  return null
}
