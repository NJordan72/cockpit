// The Activity panel's view of a pane: updates from main merged in, the log's
// filters, and the small formatters its rows use. Pure, so it can be tested.
import {
  ACTIVITY_MAX_ENTRIES,
  type ActivityEntry,
  type ActivityKind,
  type ActivityUpdate,
  type GitFile,
  type PaneActivity
} from '@shared/activity'

/**
 * An update applied to what's shown. Entries it already has (by seq) are
 * skipped. A reset replaces everything.
 */
export function applyUpdate(a: PaneActivity, u: ActivityUpdate): PaneActivity {
  if (u.paneId !== a.paneId) return a
  if (u.reset) {
    return {
      paneId: a.paneId,
      entries: u.entries.slice(-ACTIVITY_MAX_ENTRIES),
      plans: u.plans ?? a.plans,
      files: u.files ?? [],
      agents: u.agents ?? []
    }
  }
  const last = a.entries.at(-1)?.seq ?? 0
  const fresh = u.entries.filter((e) => e.seq > last)
  let entries = fresh.length > 0 ? [...a.entries, ...fresh] : a.entries
  if (entries.length > ACTIVITY_MAX_ENTRIES) entries = entries.slice(-ACTIVITY_MAX_ENTRIES)
  return {
    paneId: a.paneId,
    entries,
    plans: u.plans ?? a.plans,
    files: u.files ?? a.files,
    agents: u.agents ?? a.agents
  }
}

/** Every entry the pane has logged, including ones dropped to stay under the cap. */
export const loggedCount = (a: PaneActivity | null): number => a?.entries.at(-1)?.seq ?? 0

export interface LogFilter {
  /** Everything that isn't a tool call. */
  events: boolean
  tools: boolean
}

export function filterLog(entries: ActivityEntry[], f: LogFilter): ActivityEntry[] {
  if (f.events && f.tools) return entries
  return entries.filter((e) => (e.kind === 'tool' ? f.tools : f.events))
}

/**
 * The filter after clicking one of its two switches. Turning off the only
 * one that's on turns the other one on instead, so the log never goes blank.
 */
export function toggleFilter<K extends string>(
  f: Readonly<Record<K, boolean>>,
  key: NoInfer<K>
): Record<K, boolean> {
  const next = { ...f, [key]: !f[key] }
  if (Object.values(next).some(Boolean)) return next
  return Object.fromEntries(Object.keys(f).map((k) => [k, k !== key])) as Record<K, boolean>
}

export const KIND_LABEL: Record<ActivityKind, string> = {
  session: 'SESSION',
  prompt: 'PROMPT',
  tool: 'TOOL',
  fail: 'FAIL',
  ask: 'ASK',
  agent: 'AGENT',
  note: 'NOTE',
  stop: 'STOP',
  compact: 'COMPACT'
}

const pad = (n: number): string => String(n).padStart(2, '0')

/** "13:08:37", local time. */
export function formatClock(ms: number): string {
  const d = new Date(ms)
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

/** "4s", "1m 05s", "2h 03m". */
export function formatDuration(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000))
  if (s < 60) return `${String(s)}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${String(m)}m ${pad(s % 60)}s`
  return `${String(Math.floor(m / 60))}h ${pad(m % 60)}m`
}

/** "src/main/index.ts" → ["src/main/", "index.ts"]. */
export function splitPath(p: string): [dir: string, base: string] {
  const trimmed = p.endsWith('/') ? p.slice(0, -1) : p
  const i = trimmed.lastIndexOf('/')
  return i === -1 ? ['', p] : [p.slice(0, i + 1), p.slice(i + 1)]
}

/** The two status letters `git status -s` shows, with blanks for unchanged. */
export function gitCode(f: GitFile): string {
  const letter = (c: string): string => (c === '.' ? ' ' : c)
  return letter(f.index) + letter(f.worktree)
}
