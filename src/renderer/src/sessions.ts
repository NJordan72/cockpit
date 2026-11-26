import type { PaneSession } from '@shared/ipc'
import type { SessionStatus } from '@shared/widgets'

/** Default context-window limit (tokens) used when estimating fill percentage. */
export const DEFAULT_CONTEXT_LIMIT = 200_000
/** Context fill percentage thresholds for amber (warn) and red (high) states. */
export const PRESSURE_WARN = 70
export const PRESSURE_HIGH = 85

export type ContextPressureTone = 'normal' | 'warn' | 'high'

export interface ContextPressure {
  tokens: number
  limit: number
  /** Rounded fill percentage (can exceed 100 if tokens surpass the default limit). */
  percent: number
  /** Clamped 0–100 fill percentage for rendering a progress bar. */
  barPercent: number
  tone: ContextPressureTone
}

/**
 * Context-window pressure for a token count against `limit`: amber at >=70%,
 * red at >=85%. Returns null when no token count is known.
 */
export function contextPressure(
  tokens: number | null,
  limit = DEFAULT_CONTEXT_LIMIT
): ContextPressure | null {
  if (tokens === null || limit <= 0) return null
  const raw = Math.max(0, (tokens / limit) * 100)
  const percent = Math.round(raw)
  const barPercent = Math.min(100, raw)
  const tone: ContextPressureTone =
    percent >= PRESSURE_HIGH ? 'high' : percent >= PRESSURE_WARN ? 'warn' : 'normal'
  return { tokens, limit, percent, barPercent, tone }
}

/** Compact active-duration formatting: "0s", "42s", "5m", "1h 12m". */
export function formatDuration(ms: number): string {
  if (ms <= 0) return '0s'
  const totalSec = Math.floor(ms / 1000)
  if (totalSec < 60) return `${String(Math.max(1, totalSec))}s`
  const totalMin = Math.floor(totalSec / 60)
  if (totalMin < 60) return `${String(totalMin)}m`
  const hours = Math.floor(totalMin / 60)
  const mins = totalMin % 60
  return mins > 0 ? `${String(hours)}h ${String(mins)}m` : `${String(hours)}h`
}

/** Total active working time for a session at `now`, including an in-progress working stretch. */
export function sessionActiveMs(
  session: Pick<PaneSession, 'status' | 'since' | 'activeMs'>,
  now = Date.now()
): number {
  const live =
    session.status === 'working' && session.since > 0 ? Math.max(0, now - session.since) : 0
  return session.activeMs + live
}

export interface TelemetryRollup {
  activeMs: number
  toolCalls: number
  tokens: number | null
}

/** Rolls up active working time, tool calls, and context tokens across sessions. */
export function rollupTelemetry(
  sessions: readonly Pick<PaneSession, 'status' | 'since' | 'activeMs' | 'toolCalls' | 'tokens'>[],
  now = Date.now()
): TelemetryRollup {
  let activeMs = 0
  let toolCalls = 0
  let tokenSum = 0
  let hasTokens = false
  for (const s of sessions) {
    activeMs += sessionActiveMs(s, now)
    toolCalls += s.toolCalls
    if (s.tokens !== null) {
      tokenSum += s.tokens
      hasTokens = true
    }
  }
  return { activeMs, toolCalls, tokens: hasTokens ? tokenSum : null }
}

/** Compact one-line summary of rolled-up telemetry, or null when nothing has been recorded yet. */
export function formatTelemetry(rollup: TelemetryRollup): string | null {
  const parts: string[] = []
  if (rollup.activeMs >= 1000) parts.push(formatDuration(rollup.activeMs))
  if (rollup.toolCalls > 0) {
    parts.push(`${String(rollup.toolCalls)} ${rollup.toolCalls === 1 ? 'tool' : 'tools'}`)
  }
  if (rollup.tokens !== null && rollup.tokens > 0) parts.push(`${formatTokens(rollup.tokens)} tok`)
  return parts.length > 0 ? parts.join(' · ') : null
}

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
