// Each pane's activity for the Activity panel: a log of what Claude
// Code's hooks and Codex's notifications report, the files Claude's tools
// touched, and the subagents it started. It's kept in memory only and goes
// to the chrome, never to widgets, since the log quotes commands and prompts.
import os from 'node:os'
import path from 'node:path'
import {
  ACTIVITY_MAX_ENTRIES,
  type ActivityEntry,
  type ActivityUpdate,
  type FileChange,
  type FileTouch,
  type PaneActivity,
  type SubagentRun
} from '@shared/activity'
import type { AgentKind } from '@shared/widgets'
import type { AgentSignal } from './events'

/** Entries kept per pane; older ones are dropped. */
export const MAX_ENTRIES = ACTIVITY_MAX_ENTRIES
const MAX_FILES = 1000
const MAX_AGENTS = 200
/** Agent tool calls waiting for the subagent they start. */
const MAX_SPAWNS = 50
/** Longest one-line text in an entry. */
const MAX_TEXT = 300
/** A long command or message is kept whole in an entry's detail up to this length. */
const MAX_DETAIL = 4000
/** A Bash command longer than this can't be copied or run from the log. */
const MAX_COMMAND = 20_000
/** Updates are batched, so a burst of parallel tool calls goes out as one. */
export const FLUSH_MS = 100

type Obj = Record<string, unknown>
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v)
const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null)

const cut = (s: string, max: number): string => (s.length > max ? s.slice(0, max - 1) + '…' : s)

/** One line of `s` for the log, and the whole of it when the line left something out. */
export function clip(s: string): { text: string; detail: string | null } {
  const whole = s.trim()
  const lines = whole.split('\n')
  const first = (lines[0] ?? '').replace(/\s+/g, ' ').trim()
  const text = cut(lines.length > 1 ? `${first} …` : first, MAX_TEXT)
  const lost = lines.length > 1 || first.length > MAX_TEXT
  return { text, detail: lost ? cut(whole, MAX_DETAIL) : null }
}

/** Relative to the session's directory when inside it, otherwise with ~ for home. */
export function displayPath(p: string, cwd: string | null, home = os.homedir()): string {
  if (cwd && path.isAbsolute(p)) {
    const rel = path.relative(cwd, p)
    if (rel && rel !== '..' && !rel.startsWith('..' + path.sep) && !path.isAbsolute(rel)) return rel
  }
  if (p === home) return '~'
  if (p.startsWith(home + path.sep)) return '~' + p.slice(home.length)
  return p
}

/** For tools describeTool has no case for: the input fields most likely to say what a call does, best first. */
const TELLING_FIELDS = [
  'description',
  'command',
  'query',
  'url',
  'file_path',
  'path',
  'pattern',
  'prompt',
  'name',
  'title',
  'subject'
]

function firstString(input: Obj): string | null {
  for (const key of TELLING_FIELDS) {
    const v = str(input[key])
    if (v) return v
  }
  for (const v of Object.values(input)) {
    const s = str(v)
    if (s) return s
  }
  return null
}

const SPAWN_TOOLS = new Set(['Agent', 'Task'])

/** What the log can do with a call: copy or rerun a Bash command. */
export function actionable(
  tool: string,
  input: unknown,
  cwd: string | null
): Pick<ActivityEntry, 'command'> {
  const i = isObj(input) ? input : {}
  const command = tool === 'Bash' && typeof i.command === 'string' ? i.command : ''
  return {
    command: command.trim() && command.length <= MAX_COMMAND ? { text: command, cwd } : null
  }
}

/** What a tool call is about, in a line: "Bash" and its command, "Edit" and its file. */
export function describeTool(
  tool: string,
  input: unknown,
  cwd: string | null,
  home = os.homedir()
): { label: string; text: string; detail: string | null } {
  const i = isObj(input) ? input : {}
  const file = (v: unknown): string | null => {
    const s = str(v)
    return s ? displayPath(s, cwd, home) : null
  }
  const within = (what: string | null, where: string | null): string | null =>
    what && where ? `${what} in ${where}` : what
  let label = tool
  let text: string | null
  const mcp = /^mcp__(.+?)__(.+)$/.exec(tool)
  if (mcp) {
    label = mcp[2] ?? tool
    text = firstString(i) ?? mcp[1] ?? null
  } else {
    switch (tool) {
      case 'Bash':
        text = str(i.command)
        break
      case 'Read':
      case 'Edit':
      case 'MultiEdit':
      case 'Write':
        text = file(i.file_path)
        break
      case 'NotebookEdit':
      case 'NotebookRead':
        text = file(i.notebook_path)
        break
      case 'Grep':
        text = within(str(i.pattern), file(i.path) ?? str(i.glob))
        break
      case 'Glob':
        text = within(str(i.pattern), file(i.path))
        break
      case 'WebFetch':
        text = str(i.url)
        break
      case 'WebSearch':
        text = str(i.query)
        break
      case 'Agent':
      case 'Task': {
        const type = str(i.subagent_type) ?? 'general-purpose'
        const what = str(i.description)
        text = what ? `${type}: ${what}` : type
        break
      }
      case 'TodoWrite':
        text = Array.isArray(i.todos) ? `${String(i.todos.length)} items` : null
        break
      case 'Skill':
        text = str(i.skill) ?? str(i.name)
        break
      default:
        text = firstString(i)
    }
  }
  return { label, ...clip(text ?? '') }
}

/** Lines added and removed in a tool response's structuredPatch. */
export function patchCounts(patch: unknown): { added: number; removed: number } {
  let added = 0
  let removed = 0
  if (!Array.isArray(patch)) return { added, removed }
  for (const hunk of patch) {
    if (!isObj(hunk) || !Array.isArray(hunk.lines)) continue
    for (const line of hunk.lines) {
      if (typeof line !== 'string') continue
      if (line.startsWith('+')) added++
      else if (line.startsWith('-')) removed++
    }
  }
  return { added, removed }
}

/** What a <task-notification> prompt says about a background task. */
export interface TaskNotification {
  /** For a background subagent, its agent_id. */
  taskId: string | null
  /** The tool call that started the task. */
  toolUseId: string | null
  status: string | null
  summary: string | null
}

/**
 * Claude Code tells the model a background task (a subagent, a shell
 * command) has finished by submitting a prompt like this one, which fires
 * UserPromptSubmit like a prompt the user typed.
 */
export function parseTaskNotification(prompt: string): TaskNotification | null {
  if (!prompt.startsWith('<task-notification>')) return null
  const tag = (name: string): string | null =>
    str(new RegExp(`<${name}>([\\s\\S]*?)</${name}>`).exec(prompt)?.[1])
  return {
    taskId: tag('task-id'),
    toolUseId: tag('tool-use-id'),
    status: tag('status'),
    summary: tag('summary')
  }
}

const CHANGE_RANK: Record<FileChange, number> = { read: 0, edited: 1, created: 2 }

const SESSION_SOURCES: Record<string, string> = {
  startup: 'Started',
  resume: 'Resumed',
  clear: 'Cleared',
  fork: 'Forked'
}

interface Spawn {
  toolUseId: string | null
  type: string
  description: string | null
  background: boolean
}

interface PaneLog {
  seq: number
  entries: ActivityEntry[]
  /** Insertion order is touch order, oldest first. */
  files: Map<string, FileTouch>
  /** Insertion order is start order. */
  agents: Map<string, SubagentRun>
  /** Agent tool calls whose subagent hasn't started yet. */
  spawns: Spawn[]
  /** Every recent Agent tool call's description, by tool_use_id. */
  calls: Map<string, string>
  /** The directory the main thread's hooks last ran in. */
  cwd: string | null
  /** Not sent to the chrome yet. */
  fresh: ActivityEntry[]
  filesDirty: boolean
  agentsDirty: boolean
}

type NewEntry = Omit<ActivityEntry, 'seq' | 'at' | 'detail' | 'agent' | 'command'> &
  Partial<Pick<ActivityEntry, 'detail' | 'agent' | 'command'>>

export class ActivityLog {
  private panes = new Map<string, PaneLog>()
  private timer: NodeJS.Timeout | null = null

  constructor(
    private readonly onUpdate: (update: ActivityUpdate) => void,
    private readonly home = os.homedir()
  ) {}

  /** A pane's process started. Claude Code says so itself, through SessionStart. */
  started(paneId: string, agent: AgentKind | null): void {
    const pane = this.pane(paneId)
    if (agent === 'codex') this.add(pane, { kind: 'session', label: 'Started', text: 'Codex' })
  }

  /** A pane's process ended. Shells, which never logged anything, stay empty. */
  exited(paneId: string): void {
    const pane = this.panes.get(paneId)
    if (!pane || pane.seq === 0) return
    this.stopRuns(pane, false)
    // Claude Code's SessionEnd already said so.
    const last = pane.entries.at(-1)
    if (last?.kind === 'session' && last.label === 'Ended') return
    this.add(pane, { kind: 'session', label: 'Exited', text: '' })
  }

  /** The pane is gone. */
  remove(paneId: string): void {
    this.panes.delete(paneId)
  }

  /** The directory the pane's Claude session runs in, as its hooks last reported. */
  cwd(paneId: string): string | null {
    return this.panes.get(paneId)?.cwd ?? null
  }

  snapshot(paneId: string): PaneActivity {
    const pane = this.panes.get(paneId)
    if (!pane) return { paneId, entries: [], files: [], agents: [] }
    return { paneId, entries: [...pane.entries], files: fileList(pane), agents: agentList(pane) }
  }

  /** A Claude Code hook, already matched to its pane. A null payload has only the event name. */
  claude(paneId: string, event: string, payload: unknown): void {
    const pane = this.pane(paneId)
    const p = isObj(payload) ? payload : {}
    const name = str(p.hook_event_name) ?? event
    const agentId = str(p.agent_id)
    const run = agentId ? pane.agents.get(agentId) : undefined
    const agent = agentId ? (str(p.agent_type) ?? run?.type ?? 'subagent') : null
    const cwd = str(p.cwd)
    if (cwd && !agentId) pane.cwd = cwd
    const where = cwd ?? pane.cwd
    const tool = str(p.tool_name) ?? '?'
    const call = (): ReturnType<typeof describeTool> & ReturnType<typeof actionable> => ({
      ...describeTool(tool, p.tool_input, where, this.home),
      ...actionable(tool, p.tool_input, where)
    })

    switch (name) {
      case 'SessionStart': {
        // A compaction restarts the session; PreCompact already said so.
        if (p.source === 'compact') break
        const label = SESSION_SOURCES[str(p.source) ?? ''] ?? 'Started'
        this.add(pane, { kind: 'session', label, text: str(p.model) ?? '' })
        break
      }
      case 'SessionEnd':
        // /clear ends the session and starts the next one, which says "Cleared".
        if (p.reason !== 'clear') this.add(pane, { kind: 'session', label: 'Ended', text: '' })
        this.stopRuns(pane, false)
        break
      case 'UserPromptSubmit': {
        const prompt = str(p.prompt) ?? ''
        const task = parseTaskNotification(prompt)
        if (task) {
          this.taskNotified(pane, task)
          break
        }
        this.stopRuns(pane, true)
        this.add(pane, { kind: 'prompt', label: '', ...clip(prompt) })
        break
      }
      case 'PreToolUse': {
        this.add(pane, { kind: 'tool', ...call(), agent })
        if (run) {
          run.tools++
          pane.agentsDirty = true
        }
        if (SPAWN_TOOLS.has(tool)) {
          const input = isObj(p.tool_input) ? p.tool_input : {}
          const spawn: Spawn = {
            toolUseId: str(p.tool_use_id),
            type: str(input.subagent_type) ?? 'general-purpose',
            description: str(input.description),
            background: input.run_in_background === true
          }
          pane.spawns.push(spawn)
          if (pane.spawns.length > MAX_SPAWNS) pane.spawns.shift()
          if (spawn.toolUseId && spawn.description) {
            pane.calls.set(spawn.toolUseId, spawn.description)
            if (pane.calls.size > MAX_AGENTS) {
              const oldest = pane.calls.keys().next().value
              if (oldest !== undefined) pane.calls.delete(oldest)
            }
          }
        }
        break
      }
      case 'PermissionRequest':
        this.add(pane, { kind: 'ask', ...call(), agent })
        break
      case 'PermissionDenied': {
        const c = call()
        this.add(pane, { ...c, kind: 'fail', label: `${c.label} denied`, agent })
        break
      }
      case 'PostToolUse':
        this.touch(pane, tool, p.tool_input, p.tool_response, where)
        if (SPAWN_TOOLS.has(tool)) this.spawned(pane, p, 'done')
        break
      case 'PostToolUseFailure': {
        const error = p.is_interrupt === true ? 'interrupted' : (str(p.error) ?? 'failed')
        this.add(pane, { kind: 'fail', label: tool, ...clip(error), agent })
        if (SPAWN_TOOLS.has(tool)) this.spawned(pane, p, 'failed')
        break
      }
      case 'Notification':
        this.add(pane, { kind: 'note', label: '', ...clip(str(p.message) ?? 'Notification') })
        break
      case 'Elicitation':
        this.add(pane, {
          kind: 'ask',
          label: str(p.mcp_server_name) ?? 'Question',
          ...clip(str(p.message) ?? '')
        })
        break
      case 'SubagentStart':
        if (agentId) this.startRun(pane, agentId, agent ?? 'subagent')
        break
      case 'SubagentStop':
        if (agentId) this.finishRun(pane, agentId, p.last_assistant_message)
        break
      case 'Stop':
        this.stopRuns(pane, true)
        this.add(pane, {
          kind: 'stop',
          label: '',
          ...clip(str(p.last_assistant_message) ?? 'Done')
        })
        break
      case 'StopFailure':
        this.stopRuns(pane, true)
        this.add(pane, { kind: 'fail', label: 'Turn failed', ...clip(str(p.error) ?? '') })
        break
      case 'PreCompact':
        this.add(pane, {
          kind: 'compact',
          label: p.trigger === 'manual' ? 'Compacting' : 'Auto-compacting',
          text: ''
        })
        break
    }
  }

  /** What Codex reported through its terminal (see CodexWatcher). */
  codex(paneId: string, signal: AgentSignal): void {
    const pane = this.panes.get(paneId)
    if (!pane) return
    if (signal.kind === 'working' && signal.clears) {
      this.add(pane, { kind: 'prompt', label: '', text: 'Turn started' })
    } else if (signal.kind === 'waiting' && signal.message) {
      this.add(pane, { kind: 'ask', label: 'Approval', ...clip(signal.message) })
    } else if (signal.kind === 'done') {
      this.add(pane, { kind: 'stop', label: '', ...clip(signal.message ?? 'Turn complete') })
    }
  }

  /** Send what's waiting now instead of at the next batch. */
  flush(): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    for (const [paneId, pane] of this.panes) {
      if (pane.fresh.length === 0 && !pane.filesDirty && !pane.agentsDirty) continue
      const update: ActivityUpdate = { paneId, entries: pane.fresh }
      if (pane.filesDirty) update.files = fileList(pane)
      if (pane.agentsDirty) update.agents = agentList(pane)
      pane.fresh = []
      pane.filesDirty = false
      pane.agentsDirty = false
      this.onUpdate(update)
    }
  }

  close(): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
  }

  private pane(paneId: string): PaneLog {
    let pane = this.panes.get(paneId)
    if (!pane) {
      pane = {
        seq: 0,
        entries: [],
        files: new Map(),
        agents: new Map(),
        spawns: [],
        calls: new Map(),
        cwd: null,
        fresh: [],
        filesDirty: false,
        agentsDirty: false
      }
      this.panes.set(paneId, pane)
    }
    return pane
  }

  private add(pane: PaneLog, e: NewEntry): void {
    const entry: ActivityEntry = {
      seq: ++pane.seq,
      at: Date.now(),
      kind: e.kind,
      label: e.label,
      text: e.text,
      detail: e.detail ?? null,
      agent: e.agent ?? null,
      command: e.command ?? null
    }
    pane.entries.push(entry)
    if (pane.entries.length > MAX_ENTRIES) pane.entries.splice(0, pane.entries.length - MAX_ENTRIES)
    pane.fresh.push(entry)
    if (pane.fresh.length > MAX_ENTRIES) pane.fresh.splice(0, pane.fresh.length - MAX_ENTRIES)
    this.schedule()
  }

  private schedule(): void {
    this.timer ??= setTimeout(() => {
      this.flush()
    }, FLUSH_MS)
  }

  /** A tool call finished; note the file it read or changed. */
  private touch(
    pane: PaneLog,
    tool: string,
    input: unknown,
    response: unknown,
    cwd: string | null
  ): void {
    const i = isObj(input) ? input : {}
    const r = isObj(response) ? response : {}
    let file: string | null
    let change: FileChange
    switch (tool) {
      case 'Read':
        file = str(i.file_path)
        change = 'read'
        break
      case 'Edit':
      case 'MultiEdit':
        file = str(i.file_path)
        change = 'edited'
        break
      case 'Write':
        file = str(i.file_path)
        change = r.type === 'create' ? 'created' : 'edited'
        break
      case 'NotebookEdit':
        file = str(i.notebook_path)
        change = 'edited'
        break
      default:
        return
    }
    if (!file || !path.isAbsolute(file)) return
    const patch = patchCounts(r.structuredPatch)
    let added = patch.added
    // A new file's patch is empty; all of its lines are new.
    if (change === 'created' && added === 0 && typeof i.content === 'string' && i.content) {
      added = i.content.replace(/\n$/, '').split('\n').length
    }
    const prev = pane.files.get(file)
    const touch: FileTouch = prev ?? {
      path: file,
      display: displayPath(file, cwd, this.home),
      change,
      reads: 0,
      edits: 0,
      added: 0,
      removed: 0,
      at: 0
    }
    if (CHANGE_RANK[change] > CHANGE_RANK[touch.change]) touch.change = change
    if (change === 'read') touch.reads++
    else touch.edits++
    touch.added += added
    touch.removed += patch.removed
    touch.at = Date.now()
    // Re-inserted, so the map stays in touch order.
    pane.files.delete(file)
    pane.files.set(file, touch)
    if (pane.files.size > MAX_FILES) {
      const oldest = pane.files.keys().next().value
      if (oldest !== undefined) pane.files.delete(oldest)
    }
    pane.filesDirty = true
    this.schedule()
  }

  private startRun(pane: PaneLog, id: string, type: string): void {
    // When a background agent's Agent call returns before its SubagentStart,
    // spawned() has already created the run.
    const known = pane.agents.get(id)
    if (known) {
      this.add(pane, { kind: 'agent', label: `▸ ${type}`, text: known.description ?? 'started' })
      return
    }
    // SubagentStart doesn't say which Agent call started it. Take the oldest
    // waiting call for the same type; the call's result names the subagent
    // and corrects this if it guessed wrong.
    const i = pane.spawns.findIndex((s) => s.type === type)
    const spawn = i === -1 ? undefined : pane.spawns.splice(i, 1)[0]
    const run: SubagentRun = {
      id,
      type,
      description: spawn?.description ?? null,
      status: 'running',
      started: Date.now(),
      ended: null,
      tools: 0,
      result: null,
      background: spawn?.background ?? false
    }
    pane.agents.set(id, run)
    if (pane.agents.size > MAX_AGENTS) {
      const oldest = [...pane.agents.values()].find((r) => r.status !== 'running')
      if (oldest) pane.agents.delete(oldest.id)
    }
    pane.agentsDirty = true
    this.add(pane, { kind: 'agent', label: `▸ ${type}`, text: run.description ?? 'started' })
  }

  private finishRun(pane: PaneLog, id: string, message: unknown): void {
    // Claude Code's own helpers (the prompt suggester, for one) send
    // SubagentStop with no type and no SubagentStart. Leave them out.
    const run = pane.agents.get(id)
    if (!run) return
    const result = clip(str(message) ?? '')
    run.status = 'done'
    run.ended = Date.now()
    run.result = result.text || null
    pane.agentsDirty = true
    this.add(pane, {
      kind: 'agent',
      label: `■ ${run.type}`,
      ...result,
      text: result.text || 'done'
    })
  }

  /** A background task finished and Claude was told. */
  private taskNotified(pane: PaneLog, task: TaskNotification): void {
    const run = task.taskId ? pane.agents.get(task.taskId) : undefined
    if (run) {
      run.background = true
      run.description ??= task.toolUseId ? (pane.calls.get(task.toolUseId) ?? null) : null
      if (run.status === 'running') {
        run.status =
          task.status === 'completed' ? 'done' : task.status === 'failed' ? 'failed' : 'stopped'
        run.ended = Date.now()
      }
      pane.agentsDirty = true
    }
    this.add(pane, { kind: 'note', label: '', ...clip(task.summary ?? 'A background task ended') })
  }

  /** The Agent call that started a subagent returned (or failed). */
  private spawned(pane: PaneLog, p: Obj, outcome: 'done' | 'failed'): void {
    const input = isObj(p.tool_input) ? p.tool_input : {}
    const response = isObj(p.tool_response) ? p.tool_response : {}
    const toolUseId = str(p.tool_use_id)
    const id = str(response.agentId)
    // Agents run in the background unless told otherwise; the call then
    // returns once the agent is launched.
    const background =
      response.isAsync === true ||
      response.status === 'async_launched' ||
      input.run_in_background === true
    const waiting = toolUseId ? pane.spawns.findIndex((s) => s.toolUseId === toolUseId) : -1
    // Without an id, a background agent's SubagentStart still needs the call to match.
    if (!id && background) return
    const spawn = waiting === -1 ? undefined : pane.spawns.splice(waiting, 1)[0]
    if (!id) return
    let run = pane.agents.get(id)
    if (!run) {
      // No SubagentStart arrived for it.
      run = {
        id,
        type: str(response.agentType) ?? spawn?.type ?? 'subagent',
        description: null,
        status: 'running',
        started: Date.now(),
        ended: null,
        tools: 0,
        result: null,
        background
      }
      pane.agents.set(id, run)
    }
    run.description = str(input.description) ?? str(response.description) ?? run.description
    run.background = background
    if (!background && run.status === 'running') {
      run.status = outcome
      run.ended = Date.now()
    }
    pane.agentsDirty = true
    this.schedule()
  }

  /**
   * The turn or the session ended, so subagents that never reported back
   * aren't running any more (an interrupt sends no SubagentStop). With
   * `foregroundOnly`, background ones may still be.
   */
  private stopRuns(pane: PaneLog, foregroundOnly: boolean): void {
    for (const run of pane.agents.values()) {
      if (run.status !== 'running' || (foregroundOnly && run.background)) continue
      run.status = 'stopped'
      run.ended = Date.now()
      pane.agentsDirty = true
    }
    if (pane.agentsDirty) this.schedule()
  }
}

function fileList(pane: PaneLog): FileTouch[] {
  return [...pane.files.values()].reverse().map((f) => ({ ...f }))
}

function agentList(pane: PaneLog): SubagentRun[] {
  return [...pane.agents.values()].map((r) => ({ ...r }))
}
