// Where a new agent session goes when a panel or widget asks for one.
import type { Preset } from '@shared/config'
import type { PaneSession } from '@shared/ipc'

/** The agent a preset's command starts, read the way main reads it: the first word after any VAR=value. */
function presetAgent(command: string | undefined): 'claude' | 'codex' | null {
  for (const word of command?.trim().split(/\s+/) ?? []) {
    if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(word)) continue
    const name = word.slice(word.lastIndexOf('/') + 1)
    return name === 'claude' || name === 'codex' ? name : null
  }
  return null
}

/**
 * The preset and directory for a new agent session: the focused pane's, if
 * it runs an agent; otherwise the first Claude Code preset (then Codex) in
 * the focused pane's directory.
 */
export function newSessionTarget(
  presets: readonly Preset[],
  focused: PaneSession | null
): { presetId: string; cwd: string } | null {
  const own = focused && presets.find((p) => p.id === focused.presetId)
  const preset =
    (own && presetAgent(own.command) ? own : null) ??
    presets.find((p) => presetAgent(p.command) === 'claude') ??
    presets.find((p) => presetAgent(p.command) === 'codex')
  if (!preset) return null
  return { presetId: preset.id, cwd: focused?.cwd ?? preset.cwd }
}
