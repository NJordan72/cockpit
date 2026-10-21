// Which agent a preset command starts, and the flags that make it report to
// Cockpit. Everything is passed on the command line: Cockpit never edits
// ~/.claude/settings.json or ~/.codex/config.toml. Pure, so it can be tested.
import type { AgentKind } from '@shared/widgets'

/** Quote a string for sh, zsh, and bash. */
export function shQuote(s: string): string {
  return /^[A-Za-z0-9_./:=@%+-]+$/.test(s) ? s : `'${s.replace(/'/g, `'\\''`)}'`
}

const ENV_ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=\S*$/

/**
 * The agent a command starts, and where its name ends. The command's first
 * word must be `claude` or `codex` (or a path to one), after any `VAR=value`
 * prefixes. Anything more involved, like `cd x && claude`, isn't recognized
 * and falls back to the output heuristic.
 */
export function detectAgent(command: string | undefined): { agent: AgentKind; end: number } | null {
  if (!command) return null
  const word = /\S+/g
  let m: RegExpExecArray | null
  while ((m = word.exec(command))) {
    if (ENV_ASSIGNMENT.test(m[0])) continue
    const name = m[0].slice(m[0].lastIndexOf('/') + 1)
    if (name === 'claude' || name === 'codex') return { agent: name, end: m.index + m[0].length }
    return null
  }
  return null
}

/**
 * Codex reports through its terminal: OSC 0 titles that name its run state
 * ("Working", "Ready", "[ ! ] Action Required") and OSC 9 notifications when
 * a turn completes or it asks for approval. These settings pin both, since
 * either default could be changed in the user's config. (Codex's hooks would
 * need a trust entry saved to config.toml, and `notify` would replace the
 * user's own notify program.)
 */
export const CODEX_SETTINGS = [
  'tui.terminal_title=["activity","run-state"]',
  'tui.notifications=true',
  'tui.notification_method="osc9"',
  'tui.notification_condition="always"'
]

export interface AgentLaunch {
  command: string | undefined
  agent: AgentKind | null
}

export interface LaunchOptions {
  /** Open the agent's own picker of past sessions in the directory. */
  resume?: boolean
  /** The first prompt of a new session. */
  prompt?: string
}

/**
 * The preset command with the flags its agent needs to report to Cockpit.
 * With `resume`, the agent opens its own picker of past sessions in the
 * directory: `claude --resume` (first, so its optional value can't take the
 * next word) or `codex resume`. A `prompt` goes last, as the agent's first
 * message. Other commands run as they are.
 */
export function agentLaunch(
  command: string | undefined,
  files: { claudeSettings: string },
  { resume = false, prompt }: LaunchOptions = {}
): AgentLaunch {
  const found = detectAgent(command)
  if (!command || !found) return { command, agent: null }
  const flags =
    found.agent === 'claude'
      ? [...(resume ? ['--resume'] : []), '--settings', files.claudeSettings]
      : [...CODEX_SETTINGS.flatMap((s) => ['-c', s]), ...(resume ? ['resume'] : [])]
  const inserted = flags.map(shQuote).join(' ')
  const first = prompt?.trim() && !resume ? ` ${shQuote(prompt.trim())}` : ''
  return {
    command: `${command.slice(0, found.end)} ${inserted}${command.slice(found.end)}${first}`,
    agent: found.agent
  }
}
