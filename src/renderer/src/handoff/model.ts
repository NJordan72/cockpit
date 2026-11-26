// Pure target resolution and prompt formatting for cross-agent handoff and
// side-by-side comparison.
import type { AgentPlan } from '@shared/activity'
import type { Preset } from '@shared/config'
import type { MenuItem, PaneSession } from '@shared/ipc'
import { agentPresets } from '../agentSessions'

export type AgentHandoffTarget =
  | { kind: 'pane'; paneId: string }
  | { kind: 'split'; sourcePaneId: string; presetId: string; cwd: string }
  | { kind: 'newTab'; presetId: string; cwd: string }

export interface AgentHandoffChoice {
  label: string
  target: AgentHandoffTarget
}

export interface HandoffChoicesOptions {
  /** The pane the plan or selection came from, excluded from existing-pane targets. */
  sourcePaneId: string
  /** Working directory for a new split or tab. */
  sourceCwd: string
  /** Preset of the source pane; other agent presets are offered before it. */
  sourcePresetId?: string | null
  sessions: readonly PaneSession[]
  presets: readonly Preset[]
  /** True when a new split can be opened beside the source pane; false opens a new tab instead. */
  canSplit?: boolean
}

const inside = (cwd: string, dir: string): boolean => cwd === dir || cwd.startsWith(`${dir}/`)

const runningAgent = (s: PaneSession): boolean => s.agent !== null && s.status !== 'exited'

/**
 * Where a plan or terminal selection can be sent, grouped for a menu:
 * 1. Other running agent panes (same directory first, then the rest).
 * 2. A new split (or new tab) for each agent preset, other presets before the source's own.
 */
export function handoffChoices({
  sourcePaneId,
  sourceCwd,
  sourcePresetId,
  sessions,
  presets,
  canSplit = true
}: HandoffChoicesOptions): AgentHandoffChoice[][] {
  const candidates = sessions.filter((s) => s.id !== sourcePaneId && runningAgent(s))
  const sameDir = candidates.filter((s) => inside(s.cwd, sourceCwd))
  const otherDir = candidates.filter((s) => !inside(s.cwd, sourceCwd))
  const panes: AgentHandoffChoice[] = [...sameDir, ...otherDir].map((s) => ({
    label: `${s.title ?? s.name} · ${s.cwd}`,
    target: { kind: 'pane', paneId: s.id }
  }))

  const agents = agentPresets(presets)
  const ordered = [
    ...agents.filter((p) => p.id !== sourcePresetId),
    ...agents.filter((p) => p.id === sourcePresetId)
  ]
  const fresh: AgentHandoffChoice[] = ordered.map((p) => ({
    label: canSplit ? `New split: ${p.name}` : `New tab: ${p.name}`,
    target: canSplit
      ? { kind: 'split', sourcePaneId, presetId: p.id, cwd: sourceCwd }
      : { kind: 'newTab', presetId: p.id, cwd: sourceCwd }
  }))

  return [panes, fresh].filter((g) => g.length > 0)
}

/**
 * Turn grouped handoff choices into native menu items with separators and a
 * lookup table keyed by item id.
 */
export function handoffMenuItems(
  groups: readonly AgentHandoffChoice[][],
  prefix = 'handoff'
): { items: MenuItem[]; targets: ReadonlyMap<string, AgentHandoffTarget> } {
  const targets = new Map<string, AgentHandoffTarget>()
  let idx = 0
  const items: MenuItem[] = groups.flatMap((group, g) => [
    ...(g > 0 ? [{ type: 'separator' } as const] : []),
    ...group.map((choice): MenuItem => {
      const id = `${prefix}:${String(idx++)}`
      targets.set(id, choice.target)
      return { id, label: choice.label }
    })
  ])
  return { items, targets }
}

/** A backtick fence longer than any run of backticks in `text`. */
function codeFence(text: string): string {
  let max = 2
  for (const m of text.matchAll(/`+/g)) {
    if (m[0].length > max) max = m[0].length
  }
  return '`'.repeat(max + 1)
}

/** Format a Claude plan with a concise review prompt for a second opinion. */
export function planReviewPrompt(plan: Pick<AgentPlan, 'title' | 'text' | 'file'>): string {
  const body = plan.text.trim()
  const title = plan.title.trim()
  const hasHeading = /^#{1,6}\s/.test(body)
  const parts = [
    'Please review this implementation plan for gaps, risks, edge cases, and simpler alternatives.'
  ]
  if (plan.file) parts.push(`Plan file: ${plan.file}`)
  if (title && !hasHeading) parts.push(`# ${title}\n\n${body}`)
  else if (body) parts.push(body)
  return parts.join('\n\n')
}

/** Trim only leading and trailing blank lines, preserving indentation inside the selection. */
function trimBlankLines(text: string): string {
  const lines = text.replace(/\r\n/g, '\n').split('\n')
  let start = 0
  while (start < lines.length && lines[start]?.trim() === '') start++
  let end = lines.length
  while (end > start && lines[end - 1]?.trim() === '') end--
  return lines.slice(start, end).join('\n')
}

/** Format selected terminal output to send to another agent. */
export function selectionPrompt(selection: string, opts?: { sourceName?: string }): string {
  const body = trimBlankLines(selection)
  const fence = codeFence(body)
  const heading = opts?.sourceName
    ? `From ${opts.sourceName} terminal output:`
    : 'From terminal output:'
  return `${heading}\n\n${fence}\n${body}\n${fence}`
}

/**
 * Default left and right preset ids for side-by-side comparison. Prefers two
 * distinct agent presets, starting from the focused pane's preset if it is one.
 */
export function defaultComparePresets(
  presets: readonly Preset[],
  focusedPresetId?: string | null
): [string, string] | null {
  const agents = agentPresets(presets)
  const pool = agents.length > 0 ? agents : presets
  if (pool.length === 0) return null
  const left = pool.find((p) => p.id === focusedPresetId) ?? pool[0]
  if (!left) return null
  const right = pool.find((p) => p.id !== left.id) ?? left
  return [left.id, right.id]
}
