// What the Tasks panel and the session list show about each task. Pure.
import type { PaneSession } from '@shared/ipc'
import { prLabel, taskAt, type TaskInfo, type TaskPr } from '@shared/tasks'

/** The color a pull request's state gets: a theme token's name. */
export type PrTone = 'merged' | 'passing' | 'failing' | 'pending' | 'muted'

export function prTone(pr: TaskPr | null): PrTone {
  if (!pr) return 'muted'
  if (pr.state === 'merged') return 'merged'
  if (pr.state === 'closed' || pr.draft) return 'muted'
  if (pr.checks === 'failing' || pr.review === 'changes') return 'failing'
  if (pr.checks === 'pending') return 'pending'
  return 'passing'
}

/** "#12 merged", for the chip beside a task. */
export function prChip(pr: TaskPr): string {
  return `#${String(pr.number)} ${prLabel(pr)}`
}

/** The sessions open in each task's worktree, by the task's path. */
export function sessionsByTask(
  tasks: readonly TaskInfo[],
  sessions: readonly PaneSession[]
): Map<string, PaneSession[]> {
  const out = new Map<string, PaneSession[]>()
  for (const s of sessions) {
    const t = taskAt(tasks, s.cwd)
    if (t) out.set(t.path, [...(out.get(t.path) ?? []), s])
  }
  return out
}

/** The session to show for a task: the focused one, then one that wants the user, then the first. */
export function sessionToShow(sessions: readonly PaneSession[]): PaneSession | null {
  return (
    sessions.find((s) => s.focused) ??
    sessions.find((s) => s.status === 'needs-input' || s.status === 'done') ??
    sessions[0] ??
    null
  )
}

const basename = (p: string): string => p.split('/').filter(Boolean).pop() ?? p

const count = (n: number, one: string, many = `${one}s`): string =>
  `${String(n)} ${n === 1 ? one : many}`

/** The line under a task's branch: its repository, its terminals, and what isn't pushed. */
export function taskMeta(task: TaskInfo, terminals: number): string {
  return [
    basename(task.repo),
    terminals > 0 ? count(terminals, 'terminal') : null,
    task.changed > 0 ? `${String(task.changed)} changed` : null,
    task.unpushed > 0 && task.pr?.state !== 'merged' ? `${String(task.unpushed)} unpushed` : null
  ]
    .filter(Boolean)
    .join(' · ')
}
