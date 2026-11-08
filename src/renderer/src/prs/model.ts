// What the pull request pane shows and where it can send feedback. Pure, so
// it can be unit tested.
import type { PaneSession } from '@shared/ipc'
import type { Feedback, PrDetail, PrNote, PrReviewNote, PrThread } from '@shared/prs'
import type { TaskInfo } from '@shared/tasks'

export type TimelineItem =
  { kind: 'comment'; note: PrNote } | { kind: 'review'; note: PrReviewNote }

/**
 * Comments and reviews, oldest first. A review that only commented and has
 * no text of its own is left out, since its comments are in the threads.
 */
export function timeline(pr: Pick<PrDetail, 'comments' | 'reviews'>): TimelineItem[] {
  const items: TimelineItem[] = [
    ...pr.comments.map((note): TimelineItem => ({ kind: 'comment', note })),
    ...pr.reviews
      .filter((r) => r.verdict !== 'commented' || r.body.trim())
      .map((note): TimelineItem => ({ kind: 'review', note }))
  ]
  return items.sort((a, b) => a.note.at - b.note.at)
}

const threadRank = (t: PrThread): number => (t.resolved ? 2 : t.outdated ? 1 : 0)

/** Open threads on the current code first, then outdated ones, then resolved ones, each by file and line. */
export function sortThreads(threads: readonly PrThread[]): PrThread[] {
  return [...threads].sort(
    (a, b) =>
      threadRank(a) - threadRank(b) ||
      a.path.localeCompare(b.path) ||
      (a.line ?? a.originalLine ?? 0) - (b.line ?? b.originalLine ?? 0)
  )
}

/** A thread starts open when it's unresolved and on the current code. */
export const startsOpen = (t: PrThread): boolean => !t.resolved && !t.outdated

/** The key a piece of feedback is selected under. */
export function feedbackKey(item: Feedback): string {
  return item.kind === 'thread' ? `thread:${item.thread.id}` : `${item.kind}:${item.note.id}`
}

/** Every piece of feedback in the pull request, in the pane's order. */
export function allFeedback(pr: PrDetail): Feedback[] {
  return [
    ...sortThreads(pr.threads).map((thread): Feedback => ({ kind: 'thread', thread })),
    ...timeline(pr).map((item): Feedback => item)
  ]
}

/** The last lines of a diff hunk, which end at the commented line. */
export function hunkTail(hunk: string, lines = 6): string[] {
  return hunk
    .split('\n')
    .filter((l) => !l.startsWith('@@'))
    .slice(-lines)
}

export type HandOffTarget =
  | { kind: 'pane'; paneId: string }
  | { kind: 'task'; path: string }
  | { kind: 'newTask'; branch: string; repo: string }
  | { kind: 'newSession'; cwd: string }

export interface HandOffChoice {
  label: string
  target: HandOffTarget
}

const inside = (cwd: string, dir: string): boolean => cwd === dir || cwd.startsWith(`${dir}/`)

const running = (s: PaneSession): boolean => s.agent !== null && s.status !== 'exited'

/** The task on the pull request's branch: by its pull request, or by branch when gh hasn't said. */
export function taskFor(
  pr: Pick<PrDetail, 'url' | 'branch' | 'fork'>,
  tasks: readonly TaskInfo[]
): TaskInfo | null {
  return (
    tasks.find((t) => t.pr?.url === pr.url) ??
    (pr.fork ? null : tasks.find((t) => t.pr === null && t.branch === pr.branch)) ??
    null
  )
}

/**
 * Where feedback can go, in groups for a menu. The first group is the
 * pull request's own branch: agents in its task, a new tab in that task, or
 * a new task on the branch. Then every other agent pane, then a new agent
 * tab in the checkout the pane was opened from.
 */
export function handOffChoices(
  pr: Pick<PrDetail, 'url' | 'branch' | 'fork' | 'state'>,
  cwd: string,
  sessions: readonly PaneSession[],
  tasks: readonly TaskInfo[]
): HandOffChoice[][] {
  const task = taskFor(pr, tasks)
  const own: HandOffChoice[] = []
  const inTask = task ? sessions.filter((s) => running(s) && inside(s.cwd, task.path)) : []
  for (const s of inTask) {
    own.push({
      label: `${s.title ?? s.name} in the task on ${pr.branch}`,
      target: { kind: 'pane', paneId: s.id }
    })
  }
  if (task && inTask.length === 0) {
    own.push({
      label: `New agent in the task on ${pr.branch}`,
      target: { kind: 'task', path: task.path }
    })
  }
  if (!task && !pr.fork && pr.state === 'open') {
    own.push({
      label: `New task on ${pr.branch}…`,
      target: { kind: 'newTask', branch: pr.branch, repo: cwd }
    })
  }
  const others = sessions
    .filter((s) => running(s) && !inTask.includes(s))
    .map((s): HandOffChoice => ({
      label: `${s.title ?? s.name} · ${s.cwd}`,
      target: { kind: 'pane', paneId: s.id }
    }))
  const fresh: HandOffChoice[] = [
    { label: `New agent in ${cwd}`, target: { kind: 'newSession', cwd } }
  ]
  return [own, others, fresh].filter((g) => g.length > 0)
}

/** 5m, 3h, 2d. */
export function ago(ms: number, now = Date.now()): string {
  const min = Math.round((now - ms) / 60_000)
  if (min < 60) return `${String(Math.max(1, min))}m`
  if (min < 48 * 60) return `${String(Math.round(min / 60))}h`
  return `${String(Math.round(min / 1440))}d`
}
