// What the Runs panel shows about each run and each of its items. Pure.
import type { PaneSession } from '@shared/ipc'
import type { ItemState, RunItemView, RunMode, RunView } from '@shared/runs'
import { formatTelemetry, rollupTelemetry } from '../sessions'
import { prChip } from '../tasks/model'

/** The status dot's class: the agent's status while the item works, else its phase. */
export function itemDot(s: ItemState): string {
  switch (s.phase) {
    case 'working':
      return s.agent ?? 'exited'
    case 'review':
      return 'review'
    case 'done':
      return 'merged'
    case 'stuck':
      return 'stuck'
    default:
      return 'idle'
  }
}

export function phaseLabel(s: ItemState): string {
  switch (s.phase) {
    case 'waiting':
      return 'Waiting'
    case 'ready':
      return 'Ready'
    case 'working':
      return s.agent === 'needs-input' ? 'Needs input' : 'Working'
    case 'review':
      return 'In review'
    case 'done':
      return 'Done'
    case 'stuck':
      return 'Stuck'
  }
}

const AGENT_NOTE: Record<string, string> = {
  working: 'Agent working',
  'needs-input': 'Agent needs input',
  done: 'Agent finished a turn',
  idle: 'Agent idle'
}

/** The line under an item's title, with rolled-up telemetry from its open sessions when present. */
export function itemMeta(
  item: RunItemView,
  run: Pick<RunView, 'mode' | 'paused'>,
  sessions: readonly PaneSession[] = [],
  now = Date.now()
): string {
  const base = itemPhaseMeta(item, run)
  const telemetry = sessions.length > 0 ? formatTelemetry(rollupTelemetry(sessions, now)) : null
  return telemetry ? `${base} · ${telemetry}` : base
}

function itemPhaseMeta(item: RunItemView, run: Pick<RunView, 'mode' | 'paused'>): string {
  const s = item.state
  if (item.external) {
    if (s.phase === 'done') return 'Done'
    return item.pr
      ? 'Outside the run. Done when its pull request merges'
      : 'Outside the run. Mark it done when it is'
  }
  switch (s.phase) {
    case 'waiting':
      return `Waits on ${s.waitingOn.join(', ')}`
    case 'ready': {
      const where = s.startsOn ? ` on ${s.startsOn}` : ''
      return run.paused
        ? `Starts${where} when the run resumes`
        : `Starts${where} when a slot frees up`
    }
    case 'working':
      return s.agent ? (AGENT_NOTE[s.agent] ?? 'Agent idle') : 'No agent running. Click to open one'
    case 'review': {
      if (!s.pr) return 'In review'
      const parts = [prChip(s.pr)]
      if (s.mergedInto) parts.push(`merged into ${s.mergedInto}, which isn't done`)
      else if (run.mode === 'stack' && s.pr.base) parts.push(`into ${s.pr.base}`)
      if (s.baseMerged) parts.push('the branch under it merged, so rebase it')
      return parts.join(' · ')
    }
    case 'done':
      return s.pr ? prChip(s.pr) : 'Done'
    case 'stuck':
      return s.reason ?? 'Stuck'
  }
}

const MODE_LABEL: Record<RunMode, string> = {
  merge: 'waits for merges',
  stack: 'stacks pull requests'
}

/** The line under a run's title, with rolled-up telemetry across all of its items' sessions. */
export function runMeta(
  v: RunView,
  sessions: readonly PaneSession[] = [],
  now = Date.now()
): string {
  const parts = [`${String(v.done)}/${String(v.total)} done`, MODE_LABEL[v.mode]]
  if (v.cancelled) parts.push('cancelled')
  else if (v.finished) parts.push('finished')
  else if (v.paused) parts.push('paused')
  else parts.push(`${String(v.maxParallel)} at a time`)
  const open = sessions.length > 0 ? sessionsInRun(v, sessions) : []
  const telemetry = open.length > 0 ? formatTelemetry(rollupTelemetry(open, now)) : null
  if (telemetry) parts.push(telemetry)
  return parts.join(' · ')
}

/** The panes open in an item's worktree. */
export function sessionsIn(item: RunItemView, sessions: readonly PaneSession[]): PaneSession[] {
  const dir = item.state.path
  if (!dir) return []
  return sessions.filter((s) => s.cwd === dir || s.cwd.startsWith(`${dir}/`))
}

/** Every unique pane open across any of a run's items. */
export function sessionsInRun(run: RunView, sessions: readonly PaneSession[]): PaneSession[] {
  const seen = new Set<string>()
  const out: PaneSession[] = []
  for (const item of run.items) {
    for (const s of sessionsIn(item, sessions)) {
      if (seen.has(s.id)) continue
      seen.add(s.id)
      out.push(s)
    }
  }
  return out
}
