// Which agent a preset command starts, and the flags that make it report to
// Cockpit. Everything is passed on the command line or in the pane's
// environment: Cockpit never edits ~/.claude/settings.json,
// ~/.codex/config.toml, or ~/.gemini. Pure, so it can be tested.
import { validSessionId } from '@shared/config'
import type { Effort } from '@shared/quickCommands'
import type { AgentKind } from '@shared/widgets'

/** Quote a string for sh, zsh, and bash. */
export function shQuote(s: string): string {
  return /^[A-Za-z0-9_./:=@%+-]+$/.test(s) ? s : `'${s.replace(/'/g, `'\\''`)}'`
}

const ENV_ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=\S*$/

const AGENTS = new Set<string>(['claude', 'codex', 'agy'] satisfies AgentKind[])

/**
 * The agent a command starts, and where its name ends. The command's first
 * word must be `claude`, `codex`, or `agy` (or a path to one), after any
 * `VAR=value` prefixes. Anything more involved, like `cd x && claude`, isn't
 * recognized and falls back to the output heuristic.
 */
export function detectAgent(command: string | undefined): { agent: AgentKind; end: number } | null {
  if (!command) return null
  const word = /\S+/g
  let m: RegExpExecArray | null
  while ((m = word.exec(command))) {
    if (ENV_ASSIGNMENT.test(m[0])) continue
    const name = m[0].slice(m[0].lastIndexOf('/') + 1)
    if (AGENTS.has(name)) return { agent: name as AgentKind, end: m.index + m[0].length }
    return null
  }
  return null
}

/**
 * agy reports over OSC 7501 only to a terminal that answers its probe, and
 * xterm.js doesn't. This tells it to report anyway. agy reads hooks only
 * from ~/.gemini/config/hooks.json, a trusted workspace's .agents/hooks.json,
 * and plugins, so its reports are all Cockpit gets.
 */
export const AGY_ENV = { AGY_CLI_OSC7501: 'on' }

/** Env vars a pane needs so its agent reports to Cockpit. */
export function agentEnv(agent: AgentKind | null): Record<string, string> {
  return agent === 'agy' ? { ...AGY_ENV } : {}
}

export interface AgentLaunch {
  command: string | undefined
  agent: AgentKind | null
  /** The command gives the agent its first prompt. */
  prompted?: true
}

export interface LaunchOptions {
  /**
   * Resume a past session instead of starting fresh:
   * - `true` / `'picker'`: open the agent's own picker of past sessions in the directory.
   * - `'last'`: resume `sessionId` when given (Claude Code), or the directory's latest
   *   conversation (`claude --continue`, `codex resume --last`, `agy --continue`).
   */
  resume?: boolean | 'picker' | 'last'
  /** Resume a specific Claude Code session (`claude --resume <id>`). */
  sessionId?: string
  /** The first prompt of a new session. */
  prompt?: string
  /** `--model`, for Claude Code and Codex. */
  model?: string
  /** `--effort`, for Claude Code. */
  effort?: Effort
}

/**
 * The flags that pick a model and an effort level. Claude Code takes both;
 * Codex takes `--model`, and its effort is a `-c` setting, which would keep it
 * off its shared background server, so it's left out. agy gets neither.
 */
function modelFlags(agent: AgentKind, model?: string, effort?: Effort): string[] {
  if (agent === 'agy') return []
  const flags = model ? ['--model', model] : []
  return agent === 'claude' && effort ? [...flags, '--effort', effort] : flags
}

/** Flags that resume a past conversation for `agent`, or empty for a fresh start. */
function resumeFlags(
  agent: AgentKind,
  resume: LaunchOptions['resume'],
  sessionId: string | undefined
): string[] {
  const validId = validSessionId(sessionId) ? sessionId : undefined
  const mode =
    resume === 'last' || (resume === undefined && validId) ? 'last' : resume ? 'picker' : null
  if (!mode) return []
  switch (agent) {
    case 'claude':
      if (mode === 'last') return validId ? ['--resume', validId] : ['--continue']
      return ['--resume']
    case 'codex':
      return mode === 'last' ? ['resume', '--last'] : ['resume']
    case 'agy':
      return ['--continue']
  }
}

/**
 * The preset command with the flags its agent needs to report to Cockpit.
 * Codex needs none: it reports over OSC 7501 in any terminal (see codex.ts),
 * and any `-c` would also keep it off its shared background server, so its
 * sessions wouldn't show in `codex agents`. With `resume: true` (or `'picker'`),
 * the agent opens its own picker of past sessions in the directory: `claude --resume`
 * (first, so its optional value can't take the next word) or `codex resume`.
 * With `resume: 'last'`, Claude Code resumes `sessionId` (`claude --resume <id>`)
 * or continues the directory's latest (`claude --continue`), Codex runs
 * `codex resume --last`, and agy runs `agy --continue`. `model` and `effort`
 * come after (see modelFlags). A `prompt` goes last, as the agent's first
 * message (`--prompt-interactive` for agy, whose `--prompt` runs headless).
 * Other commands run as they are.
 */
export function agentLaunch(
  command: string | undefined,
  files: { claudeSettings: string },
  { resume, sessionId, prompt, model, effort }: LaunchOptions = {}
): AgentLaunch {
  const found = detectAgent(command)
  if (!command || !found) return { command, agent: null }
  const resuming = resumeFlags(found.agent, resume, sessionId)
  const flags = [
    ...resuming,
    ...(found.agent === 'claude' ? ['--settings', files.claudeSettings] : []),
    ...modelFlags(found.agent, model, effort)
  ]
  const inserted = flags.map((f) => ` ${shQuote(f)}`).join('')
  const text = prompt?.trim()
  // Joined to its flag with "=", a prompt that starts with "--" can't pass for another flag.
  const first =
    text && resuming.length === 0
      ? ` ${shQuote(found.agent === 'agy' ? `--prompt-interactive=${text}` : text)}`
      : ''
  return {
    command: `${command.slice(0, found.end)}${inserted}${command.slice(found.end)}${first}`,
    agent: found.agent,
    ...(first ? { prompted: true as const } : {})
  }
}
