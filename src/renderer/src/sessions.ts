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
