import type { PaneSession } from '@shared/ipc'
import type { SessionStatus } from '@shared/widgets'

/** Most urgent first: what a tab's badge shows when its panes differ. */
const URGENCY: readonly SessionStatus[] = ['needs-input', 'done', 'working', 'idle', 'exited']

export function mostUrgent(statuses: Iterable<SessionStatus>): SessionStatus | null {
  let best: SessionStatus | null = null
  for (const s of statuses) {
    if (best === null || URGENCY.indexOf(s) < URGENCY.indexOf(best)) best = s
  }
  return best
}

export type AttentionItem = Pick<PaneSession, 'id' | 'status' | 'since'>

/**
 * Panes that want the user's attention: `needs-input` oldest-first, then
 * `done` oldest-first. Ties break by pane id for a stable cycle order.
 */
export function attentionQueue<T extends AttentionItem>(sessions: readonly T[]): T[] {
  const rank = (s: SessionStatus): number => (s === 'needs-input' ? 0 : s === 'done' ? 1 : 2)
  return sessions
    .filter((s) => s.status === 'needs-input' || s.status === 'done')
    .sort((a, b) => {
      const r = rank(a.status) - rank(b.status)
      if (r !== 0) return r
      if (a.since !== b.since) return a.since - b.since
      return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
    })
}

/**
 * Next pane in the attention queue after `currentId`, wrapping around to the
 * start. When `currentId` isn't in the queue, returns the first item (oldest
 * `needs-input`, or oldest `done`). Returns null when no pane needs attention.
 */
export function nextAttentionTarget<T extends AttentionItem>(
  sessions: readonly T[],
  currentId: string | null
): T | null {
  const queue = attentionQueue(sessions)
  if (queue.length === 0) return null
  if (currentId === null) return queue[0] ?? null
  const idx = queue.findIndex((s) => s.id === currentId)
  if (idx === -1) return queue[0] ?? null
  return queue[(idx + 1) % queue.length] ?? null
}

export const STATUS_LABEL: Record<SessionStatus, string> = {
  idle: 'idle',
  working: 'working',
  'needs-input': 'needs input',
  done: 'done',
  exited: 'exited'
}

/** 950 → "950", 48_213 → "48k", 1_250_000 → "1.3M". */
export function formatTokens(n: number): string {
  if (n < 1000) return String(n)
  if (n < 1_000_000) return `${Math.round(n / 1000).toString()}k`
  return `${(n / 1_000_000).toFixed(1)}M`
}

const DAY_MIN = 24 * 60

/** [unit, its length in minutes, the age in minutes from which it's used], largest first. */
const AGO_UNITS: readonly (readonly [string, number, number])[] = [
  ['y', 365 * DAY_MIN, 365 * DAY_MIN],
  ['mo', 30 * DAY_MIN, 60 * DAY_MIN],
  ['w', 7 * DAY_MIN, 14 * DAY_MIN],
  ['d', DAY_MIN, DAY_MIN],
  ['h', 60, 60],
  ['m', 1, 1]
]

/** How long ago `ms` was, shortly: "now", "5m", "3h", "2d", "3w", "4mo", "2y". */
export function formatAgo(ms: number, now: number): string {
  const minutes = (now - ms) / 60_000
  const unit = AGO_UNITS.find(([, , from]) => minutes >= from)
  return unit ? Math.floor(minutes / unit[1]).toString() + unit[0] : 'now'
}
