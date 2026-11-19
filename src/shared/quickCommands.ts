// Quick commands: prompts config.json names, each with the agent, model, and
// effort to run it with, started from the Quick command dialog. A background
// one runs in a tab the tab bar leaves out until it's opened. Pure, so it can
// be unit tested.

/** Claude Code's `--effort` levels. */
export const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'] as const
export type Effort = (typeof EFFORTS)[number]

/** A value typed in before the command runs, such as a Slack link. */
export interface QuickInput {
  /** Shown above the field ("Slack link"). */
  label: string
  /**
   * A regular expression the value must match. A clipboard that matches it
   * fills the field in.
   */
  pattern?: string
}

export interface QuickCommand {
  id: string
  label: string
  /** The preset that runs it, by id. */
  preset: string
  /** The agent's first prompt. `{input}` stands for the typed value. */
  prompt: string
  /** Passed as `--model` to Claude Code and Codex. */
  model?: string
  /** Passed as `--effort` to Claude Code. */
  effort?: Effort
  input?: QuickInput
  /** Where it runs; the preset's directory when left out. */
  cwd?: string
  /** Runs out of sight, in a tab the tab bar leaves out until it's opened. */
  background: boolean
}

export const MAX_QUICK_COMMANDS = 20
const MAX_LABEL = 40
const MAX_PROMPT = 20_000
export const MAX_INPUT = 2000
const ID = /^[A-Za-z0-9_-]{1,40}$/
/** `claude-opus-5-5`, `opus`, `opus[1m]`, `gpt-5.5`, `vendor/model:tag`. */
const MODEL = /^[A-Za-z0-9][A-Za-z0-9._:/[\]-]{0,99}$/

type Obj = Record<string, unknown>
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v)
const text = (v: unknown): string => (typeof v === 'string' ? v.trim() : '')

/** The pattern compiled, or null when it isn't a valid regular expression. */
export function inputPattern(pattern: string | undefined): RegExp | null {
  if (!pattern) return null
  try {
    return new RegExp(pattern)
  } catch {
    return null
  }
}

function readInput(v: unknown): QuickInput | undefined {
  if (v === true) return { label: 'Input' }
  if (!isObj(v)) return undefined
  const input: QuickInput = { label: text(v.label).slice(0, MAX_LABEL) || 'Input' }
  const pattern = text(v.pattern)
  if (inputPattern(pattern)) input.pattern = pattern
  return input
}

function readQuickCommand(v: unknown): QuickCommand | null {
  if (!isObj(v)) return null
  const id = text(v.id)
  const label = text(v.label).slice(0, MAX_LABEL)
  const preset = text(v.preset)
  const prompt = text(v.prompt)
  if (!ID.test(id) || !label || !preset || !prompt || prompt.length > MAX_PROMPT) return null
  const cmd: QuickCommand = { id, label, preset, prompt, background: v.background !== false }
  const model = text(v.model)
  if (MODEL.test(model)) cmd.model = model
  const effort = EFFORTS.find((e) => e === v.effort)
  if (effort) cmd.effort = effort
  const input = readInput(v.input)
  if (input) cmd.input = input
  const cwd = text(v.cwd)
  if (cwd) cmd.cwd = cwd
  return cmd
}

/** config.json's `quickCommands`, without bad entries or a second use of an id. */
export function readQuickCommands(v: unknown): QuickCommand[] {
  if (!Array.isArray(v)) return []
  const seen = new Set<string>()
  const out: QuickCommand[] = []
  for (const raw of v) {
    const cmd = readQuickCommand(raw)
    if (!cmd || seen.has(cmd.id)) continue
    seen.add(cmd.id)
    out.push(cmd)
    if (out.length === MAX_QUICK_COMMANDS) break
  }
  return out
}

/** The typed value on one line, trimmed. */
export const cleanInput = (value: string): string => value.replace(/\s+/g, ' ').trim()

/** Whether `value` will do for the command's input: present, short enough, and matching. */
export function inputValid(cmd: QuickCommand, value: string): boolean {
  if (!cmd.input) return true
  const v = cleanInput(value)
  if (!v || v.length > MAX_INPUT) return false
  const re = inputPattern(cmd.input.pattern)
  return !re || re.test(v)
}

/**
 * The prompt the command sends. `{input}` is replaced by the typed value; a
 * command that takes input but has no `{input}` gets it added at the end.
 * Null when the value won't do.
 */
export function quickPrompt(cmd: QuickCommand, value = ''): string | null {
  if (!cmd.input) return cmd.prompt
  if (!inputValid(cmd, value)) return null
  const v = cleanInput(value)
  return cmd.prompt.includes('{input}')
    ? cmd.prompt.replaceAll('{input}', () => v)
    : `${cmd.prompt} ${v}`
}

/** The clipboard's text when it will do for the command's input and a pattern says what that is. */
export function clipboardInput(cmd: QuickCommand, clipboard: string): string {
  if (!cmd.input?.pattern) return ''
  const v = cleanInput(clipboard)
  return inputValid(cmd, v) ? v : ''
}
