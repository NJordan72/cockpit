// The built-in banner: a head-up display whose traffic is your agent
// sessions. Pure geometry and data here; Hud.tsx draws it.
import type { SessionStatus } from '@shared/widgets'

/** Sizes scale with the banner's height; 180 px is the Cockpit layout's. */
export interface HudMetrics {
  /** Scale factor. */
  s: number
  /** Heading tape: pixels per degree. */
  ppd: number
  /** Pitch ladder: pixels per degree. */
  ppp: number
  /** The flight path marker's center. */
  cx: number
  cy: number
}

export function hudMetrics(width: number, height: number): HudMetrics {
  const s = Math.min(1.6, Math.max(0.55, height / 180))
  return { s, ppd: 7 * s, ppp: 4.5 * s, cx: width / 2, cy: height * 0.6 }
}

export interface Attitude {
  /** 0 to 360. */
  heading: number
  /** Degrees, right wing down positive. */
  bank: number
  /** Degrees, nose up positive. */
  pitch: number
}

const START_HEADING = 247

/**
 * A slow, calm flight at `ms` milliseconds in: a gentle bank that comes and
 * goes, with the heading turning the way the wings lean.
 */
export function attitudeAt(ms: number): Attitude {
  const t = ms / 1000
  const wave = (period: number): number => (2 * Math.PI * t) / period
  const bank = 3.5 * Math.sin(wave(23)) + 1.2 * Math.sin(wave(7.3))
  // The turn follows the bank: the heading's slope is the long bank wave.
  const heading = START_HEADING + 0.5 * t - 6 * Math.cos(wave(23)) + 6
  const pitch = 0.5 + 1.6 * Math.sin(wave(17))
  return { heading: ((heading % 360) + 360) % 360, bank, pitch }
}

/** N, E, S, W on the cardinal points, otherwise tens of degrees: 03, 12, 33. */
export function headingLabel(deg: number): string {
  const d = ((Math.round(deg) % 360) + 360) % 360
  const cardinal: Record<number, string> = { 0: 'N', 90: 'E', 180: 'S', 270: 'W' }
  return cardinal[d] ?? String(Math.round(d / 10)).padStart(2, '0')
}

export interface Tick {
  /** Degrees along the tape; past 360 or below 0 where the tape wraps. */
  deg: number
  major: boolean
  label: string | null
}

/**
 * Ticks every 5 degrees, long ones every 10 and labels every 30, from
 * `-margin` to `360 + margin` so the tape can scroll through north without a
 * gap. `margin` is how many degrees half the banner shows.
 */
export function headingTicks(margin: number): Tick[] {
  const pad = Math.ceil(margin / 5) * 5 + 10
  const ticks: Tick[] = []
  for (let deg = -pad; deg <= 360 + pad; deg += 5) {
    const d = ((deg % 360) + 360) % 360
    ticks.push({ deg, major: d % 10 === 0, label: d % 30 === 0 ? headingLabel(d) : null })
  }
  return ticks
}

/** Rungs of the pitch ladder, in degrees. The horizon is drawn on its own. */
export const PITCH_RUNGS = [-10, -5, 5, 10]

/** One agent session as traffic. */
export interface Blip {
  id: string
  status: SessionStatus
  /** The project folder. */
  label: string
  /** Context size, when the agent reports it: "42k". */
  tag: string | null
  focused: boolean
}

interface BlipSource {
  id: string
  cwd: string
  status: SessionStatus
  agent: string | null
  tokens: number | null
  focused: boolean
}

/** The last part of a `~/dev/proj` path, cut to fit under a blip. */
export function shortName(cwd: string, max = 12): string {
  const parts = cwd.split('/').filter((p) => p.length > 0)
  const name = parts.at(-1) ?? '/'
  return name.length > max ? `${name.slice(0, max - 1)}…` : name
}

export function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1000) return `${String(Math.round(n / 1000))}k`
  return String(n)
}

/** Panes that run an agent, as traffic. Shells aren't flying anywhere. */
export function blips(sessions: readonly BlipSource[]): Blip[] {
  return sessions
    .filter((s) => s.agent !== null)
    .map((s) => ({
      id: s.id,
      status: s.status,
      label: shortName(s.cwd),
      tag: s.tokens === null ? null : formatTokens(s.tokens),
      focused: s.focused
    }))
}

/**
 * Where blips can go, nearest the center first: alternating right and left,
 * moving out, clear of the pitch ladder's labels and `edge` from the sides.
 */
export function trafficSlots(m: HudMetrics, width: number): number[] {
  const inner = 135 * m.s
  const step = 100 * m.s
  const edge = 50 * m.s
  const slots: number[] = []
  for (let k = 0; ; k++) {
    const dx = inner + Math.floor(k / 2) * step
    if (m.cx + dx > width - edge) break
    slots.push(k % 2 === 0 ? m.cx + dx : m.cx - dx)
  }
  return slots
}

export interface TrafficPlan {
  /** Where the first `xs.length` blips go, left to right in session order. */
  xs: number[]
  /** Sessions left over, shown as "+n" at `more`. */
  hidden: number
  more: number | null
}

/**
 * The slots nearest the center, as many as there are blips, read left to
 * right so the blips keep the tabs' order. When they don't all fit, the
 * rightmost slot says how many more there are.
 */
export function planTraffic(count: number, m: HudMetrics, width: number): TrafficPlan {
  const slots = trafficSlots(m, width)
  if (count <= slots.length) {
    return { xs: slots.slice(0, count).sort((a, b) => a - b), hidden: 0, more: null }
  }
  const sorted = [...slots].sort((a, b) => a - b)
  const more = sorted.pop() ?? null
  return { xs: sorted, hidden: count - sorted.length, more }
}

/** Lights along the bottom edge: lit while any pane is in that state. */
export interface Annunciator {
  id: 'working' | 'needs-input' | 'done'
  label: string
  count: number
}

export function annunciators(sessions: readonly { status: SessionStatus }[]): Annunciator[] {
  const count = (status: SessionStatus): number =>
    sessions.filter((s) => s.status === status).length
  return [
    { id: 'working', label: 'WORK', count: count('working') },
    { id: 'needs-input', label: 'INPUT', count: count('needs-input') },
    { id: 'done', label: 'DONE', count: count('done') }
  ]
}

/** Every agent's context added up: the readout in the bottom right. */
export function totalTokens(sessions: readonly { tokens: number | null }[]): number | null {
  const known = sessions.filter((s) => s.tokens !== null)
  return known.length === 0 ? null : known.reduce((sum, s) => sum + (s.tokens ?? 0), 0)
}
