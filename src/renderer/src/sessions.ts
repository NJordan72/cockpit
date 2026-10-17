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
