// Turns what agents report (Claude Code hook payloads, Codex notify payloads)
// into the few signals that move a pane's status. Pure, so it can be tested.
import { createHash } from 'node:crypto'

export type AgentSignal =
  /**
   * A session started, was cleared, or ended. `keepDone`: the agent went back
   * to its prompt, which doesn't mean a finished turn has been seen.
   */
  | { kind: 'idle'; keepDone?: boolean }
  /**
   * The agent is on a turn. `starts` and `ends` are a tool call beginning and
   * finishing. `resolves` names a pending request this event settles (the
   * tool it was asking about ran). `clears` drops every pending request: the
   * user just sent a prompt, so no dialog can be open.
   */
  | { kind: 'working'; starts?: ToolCall; ends?: ToolCall; resolves?: string; clears?: boolean }
  /**
   * The agent is blocked on the user. `key` matches the event that settles
   * it; null when nothing will (a reminder about a request already pending).
   * A request with a `scope` is also settled once no call in that scope is
   * running, since answering can change a call's input and with it the key.
   * `message` says what it wants; null keeps the one already shown, and so
   * does a `reminder` (it only fills in a message when there is none).
   */
  | {
      kind: 'waiting'
      key: string | null
      scope?: string
      starts?: ToolCall
      message: string | null
      reminder?: boolean
    }
  /** The agent finished its turn. */
  | { kind: 'done'; message: string | null }
  | { kind: 'none' }

export interface AgentReport {
  signal: AgentSignal
  /** Claude Code's transcript, where the title and token counts live. */
  transcriptPath: string | null
  title: string | null
}

type Obj = Record<string, unknown>
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v)
const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null)

/** Identifies one tool call across the hooks that mention it. */
export function toolKey(tool: unknown, input: unknown): string {
  const hash = createHash('sha256')
    .update(JSON.stringify(input ?? null))
    .digest('hex')
    .slice(0, 16)
  return `${typeof tool === 'string' ? tool : '?'}:${hash}`
}

/** Names one agent's calls to one tool; the main conversation and each subagent count separately. */
export function toolScope(tool: unknown, agentId: unknown): string {
  return `${typeof tool === 'string' ? tool : '?'}@${typeof agentId === 'string' ? agentId : 'main'}`
}

/** A tool call between its PreToolUse and its PostToolUse. */
export interface ToolCall {
  /** Claude Code's tool_use_id. PermissionRequest doesn't send one. */
  id: string
  scope: string
}

/** Tools that stop and ask the user something, rather than asking permission to run. */
const QUESTION_TOOLS = new Set(['AskUserQuestion'])

/** Notification types that mean Claude is blocked on the user. */
const WAITING_NOTIFICATIONS = new Set([
  'permission_prompt',
  'elicitation_dialog',
  'elicitation_url_dialog',
  'agent_needs_input'
])

/** Every hook Cockpit registers with Claude Code. The subagent ones only feed the Activity panel. */
export const CLAUDE_HOOK_EVENTS = [
  'SessionStart',
  'UserPromptSubmit',
  'PreToolUse',
  'PermissionRequest',
  'PermissionDenied',
  'PostToolUse',
  'PostToolUseFailure',
  'Notification',
  'SubagentStart',
  'SubagentStop',
  'Elicitation',
  'ElicitationResult',
  'PreCompact',
  'PostCompact',
  'Stop',
  'StopFailure',
  'SessionEnd'
] as const

/**
 * A Claude Code hook. `event` comes from the URL the hook script posted to,
 * so an event whose payload was too large to read still counts.
 */
export function parseClaudeHook(event: string, payload: unknown): AgentReport {
  const p = isObj(payload) ? payload : {}
  const name = str(p.hook_event_name) ?? event
  const report = (signal: AgentSignal): AgentReport => ({
    signal,
    transcriptPath: str(p.transcript_path),
    title: str(p.session_title)
  })
  const tool = str(p.tool_name)
  const key = toolKey(p.tool_name, p.tool_input)
  const scope = toolScope(p.tool_name, p.agent_id)
  const id = str(p.tool_use_id)
  const call = id ? { id, scope } : undefined

  switch (name) {
    case 'SessionStart':
      // Compaction restarts the session, often in the middle of a turn.
      return report(p.source === 'compact' ? { kind: 'none' } : { kind: 'idle' })
    case 'SessionEnd':
      return report({ kind: 'idle' })
    case 'UserPromptSubmit':
      return report({ kind: 'working', clears: true })
    case 'PreToolUse':
      if (tool && QUESTION_TOOLS.has(tool)) {
        return report({
          kind: 'waiting',
          key,
          scope,
          starts: call,
          message: 'Claude has a question'
        })
      }
      return report({ kind: 'working', starts: call })
    case 'PermissionRequest':
      return report({
        kind: 'waiting',
        key,
        scope,
        message: tool ? `Claude needs permission to use ${tool}` : 'Claude needs permission'
      })
    case 'PermissionDenied':
    case 'PostToolUse':
    case 'PostToolUseFailure':
      return report({ kind: 'working', resolves: key, ends: call })
    case 'Notification': {
      const type = str(p.notification_type)
      if (type && WAITING_NOTIFICATIONS.has(type)) {
        // Usually a reminder about a PermissionRequest or Elicitation that is
        // already pending, so it adds nothing for later events to settle.
        return report({
          kind: 'waiting',
          key: null,
          message: str(p.message) ?? 'Claude is waiting for you',
          reminder: true
        })
      }
      return report({ kind: 'none' })
    }
    case 'Elicitation':
      return report({
        kind: 'waiting',
        key: 'elicitation',
        message: str(p.message) ?? 'Claude is asking for input'
      })
    case 'ElicitationResult':
      return report({ kind: 'working', resolves: 'elicitation' })
    case 'PreCompact':
      return report({ kind: 'working' })
    case 'PostCompact':
      // A /compact the user ran is its own turn; an automatic one is part of a turn.
      return report(p.trigger === 'manual' ? { kind: 'idle' } : { kind: 'none' })
    case 'Stop':
      return report({ kind: 'done', message: str(p.last_assistant_message) })
    case 'StopFailure':
      return report({ kind: 'done', message: str(p.error) ?? 'The turn ended with an error' })
    default:
      return report({ kind: 'none' })
  }
}
