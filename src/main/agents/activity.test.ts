import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ActivityUpdate } from '@shared/activity'
import {
  ActivityLog,
  clip,
  describeTool,
  displayPath,
  FLUSH_MS,
  MAX_ENTRIES,
  parseTaskNotification,
  patchCounts
} from './activity'

const HOME = '/Users/me'
const CWD = '/Users/me/dev/proj'

let updates: ActivityUpdate[]
let log: ActivityLog

/** A hook as Claude Code 2.1.302 sends it (captured, trimmed). */
function hook(event: string, fields: object = {}): void {
  log.claude('p1', event, { hook_event_name: event, cwd: CWD, session_id: 's', ...fields })
}

const entries = (): { kind: string; label: string; text: string; agent: string | null }[] =>
  log.snapshot('p1').entries.map(({ kind, label, text, agent }) => ({ kind, label, text, agent }))

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(1_000_000)
  updates = []
  log = new ActivityLog((u) => updates.push(u), HOME)
  log.started('p1', 'claude')
})

afterEach(() => {
  log.close()
  vi.useRealTimers()
})

describe('describeTool', () => {
  it('names the command, file, or query', () => {
    expect(describeTool('Bash', { command: 'ls -la', description: 'List' }, CWD, HOME)).toEqual({
      label: 'Bash',
      text: 'ls -la',
      detail: null
    })
    expect(describeTool('Edit', { file_path: `${CWD}/src/a.ts` }, CWD, HOME).text).toBe('src/a.ts')
    expect(describeTool('Read', { file_path: '/Users/me/.zshrc' }, CWD, HOME).text).toBe('~/.zshrc')
    expect(describeTool('Grep', { pattern: 'TODO', path: `${CWD}/src` }, CWD, HOME).text).toBe(
      'TODO in src'
    )
    expect(
      describeTool('Agent', { subagent_type: 'Explore', description: 'find it' }, CWD, HOME).text
    ).toBe('Explore: find it')
    expect(describeTool('TodoWrite', { todos: [{}, {}] }, CWD, HOME).text).toBe('2 items')
  })

  it('shortens MCP tool names and falls back to a telling field', () => {
    expect(
      describeTool('mcp__claude_ai_Gmail__search_threads', { query: 'from:me' }, CWD, HOME)
    ).toMatchObject({ label: 'search_threads', text: 'from:me' })
    expect(describeTool('Mystery', { zzz: 'x', name: 'n' }, CWD, HOME).text).toBe('n')
    expect(describeTool('Mystery', 'not an object', CWD, HOME).text).toBe('')
  })

  it('keeps a multi-line command whole in the detail', () => {
    const d = describeTool('Bash', { command: "python3 - <<'EOF'\nprint(1)\nEOF" }, CWD, HOME)
    expect(d.text).toBe("python3 - <<'EOF' …")
    expect(d.detail).toBe("python3 - <<'EOF'\nprint(1)\nEOF")
  })
})

describe('helpers', () => {
  it('reads task notifications', () => {
    expect(parseTaskNotification('fix the bug')).toBeNull()
    expect(
      parseTaskNotification(
        '<task-notification>\n<task-id>a7e</task-id>\n<status>completed</status>\n' +
          '<summary>Agent "x" finished</summary>\n<note>...</note>'
      )
    ).toEqual({
      taskId: 'a7e',
      toolUseId: null,
      status: 'completed',
      summary: 'Agent "x" finished'
    })
  })

  it('clips to one line', () => {
    expect(clip('  one   two  ')).toEqual({ text: 'one two', detail: null })
    const long = 'x'.repeat(400)
    expect(clip(long).text).toHaveLength(300)
    expect(clip(long).detail).toBe(long)
  })

  it('shows paths relative to the session, or from home', () => {
    expect(displayPath(`${CWD}/a/b.ts`, CWD, HOME)).toBe('a/b.ts')
    expect(displayPath('/Users/me/dev/proj-two/x', CWD, HOME)).toBe('~/dev/proj-two/x')
    expect(displayPath(`${CWD}/..foo`, CWD, HOME)).toBe('..foo')
    expect(displayPath('/etc/hosts', CWD, HOME)).toBe('/etc/hosts')
    expect(displayPath(`${CWD}/x`, null, HOME)).toBe('~/dev/proj/x')
  })

  it('counts patch lines', () => {
    expect(
      patchCounts([
        { lines: ['-a', '+b', '+c', ' d'] },
        { lines: ['-e'] },
        'junk',
        { lines: 'nope' }
      ])
    ).toEqual({ added: 2, removed: 2 })
    expect(patchCounts(undefined)).toEqual({ added: 0, removed: 0 })
  })
})

describe('ActivityLog', () => {
  it('logs a turn the way Claude Code reports it', () => {
    hook('SessionStart', { source: 'startup', model: 'claude-opus-5-5' })
    hook('UserPromptSubmit', { prompt: 'fix the bug\nplease' })
    hook('PreToolUse', { tool_name: 'Bash', tool_input: { command: 'bun test' } })
    hook('PostToolUseFailure', {
      tool_name: 'Bash',
      tool_input: { command: 'bun test' },
      error: 'Exit code 1\nmore'
    })
    hook('Notification', { message: 'Claude is waiting for your input' })
    hook('Stop', { last_assistant_message: 'Fixed it.\n\nDetails...' })
    expect(entries()).toEqual([
      { kind: 'session', label: 'Started', text: 'claude-opus-5-5', agent: null },
      { kind: 'prompt', label: '', text: 'fix the bug …', agent: null },
      { kind: 'tool', label: 'Bash', text: 'bun test', agent: null },
      { kind: 'fail', label: 'Bash', text: 'Exit code 1 …', agent: null },
      { kind: 'note', label: '', text: 'Claude is waiting for your input', agent: null },
      { kind: 'stop', label: '', text: 'Fixed it. …', agent: null }
    ])
    expect(log.snapshot('p1').entries.map((e) => e.seq)).toEqual([1, 2, 3, 4, 5, 6])
    expect(log.cwd('p1')).toBe(CWD)
  })

  it('batches updates and sends only what is new', () => {
    hook('PreToolUse', { tool_name: 'Read', tool_input: { file_path: `${CWD}/a.ts` } })
    hook('PostToolUse', { tool_name: 'Read', tool_input: { file_path: `${CWD}/a.ts` } })
    expect(updates).toHaveLength(0)
    vi.advanceTimersByTime(FLUSH_MS)
    expect(updates).toHaveLength(1)
    expect(updates[0]?.entries.map((e) => e.seq)).toEqual([1])
    expect(updates[0]?.files?.map((f) => f.display)).toEqual(['a.ts'])
    expect(updates[0]?.agents).toBeUndefined()

    hook('Stop', {})
    vi.advanceTimersByTime(FLUSH_MS)
    expect(updates[1]?.entries.map((e) => e.seq)).toEqual([2])
    expect(updates[1]?.files).toBeUndefined()
  })

  it('tracks files with the strongest change and patch line counts', () => {
    const file = `${CWD}/src/a.ts`
    hook('PostToolUse', { tool_name: 'Read', tool_input: { file_path: file } })
    vi.advanceTimersByTime(1000)
    hook('PostToolUse', {
      tool_name: 'Edit',
      tool_input: { file_path: file },
      tool_response: { structuredPatch: [{ lines: ['-old', '+new', '+more'] }] }
    })
    hook('PostToolUse', {
      tool_name: 'Write',
      tool_input: { file_path: `${CWD}/b.ts`, content: 'one\ntwo\n' },
      tool_response: { type: 'create', structuredPatch: [] }
    })
    // Failed edits fire PostToolUseFailure, and relative paths aren't files we can place.
    hook('PostToolUse', { tool_name: 'Edit', tool_input: { file_path: 'rel.ts' } })
    hook('PostToolUse', { tool_name: 'Bash', tool_input: { command: 'touch c.ts' } })
    expect(log.snapshot('p1').files).toEqual([
      {
        path: `${CWD}/b.ts`,
        display: 'b.ts',
        change: 'created',
        reads: 0,
        edits: 1,
        added: 2,
        removed: 0,
        at: 1_001_000
      },
      {
        path: file,
        display: 'src/a.ts',
        change: 'edited',
        reads: 1,
        edits: 1,
        added: 2,
        removed: 1,
        at: 1_001_000
      }
    ])
  })

  it('follows a subagent from its Agent call to its result', () => {
    const input = { subagent_type: 'Explore', description: 'find hello', prompt: '...' }
    hook('PreToolUse', { tool_name: 'Agent', tool_input: input, tool_use_id: 't1' })
    hook('SubagentStart', { agent_id: 'a1', agent_type: 'Explore' })
    hook('PreToolUse', {
      agent_id: 'a1',
      agent_type: 'Explore',
      tool_name: 'Grep',
      tool_input: { pattern: 'hello' }
    })
    expect(log.snapshot('p1').agents).toMatchObject([
      { id: 'a1', type: 'Explore', description: 'find hello', status: 'running', tools: 1 }
    ])
    vi.advanceTimersByTime(5000)
    hook('SubagentStop', {
      agent_id: 'a1',
      agent_type: 'Explore',
      last_assistant_message: 'a.txt has it.\nLine 1.'
    })
    hook('PostToolUse', {
      tool_name: 'Agent',
      tool_input: input,
      tool_use_id: 't1',
      tool_response: { status: 'completed', agentId: 'a1', agentType: 'Explore' }
    })
    expect(log.snapshot('p1').agents).toEqual([
      {
        id: 'a1',
        type: 'Explore',
        description: 'find hello',
        status: 'done',
        started: 1_000_000,
        ended: 1_005_000,
        tools: 1,
        result: 'a.txt has it. …',
        background: false
      }
    ])
    expect(entries()).toEqual([
      { kind: 'tool', label: 'Agent', text: 'Explore: find hello', agent: null },
      { kind: 'agent', label: '▸ Explore', text: 'find hello', agent: null },
      { kind: 'tool', label: 'Grep', text: 'hello', agent: 'Explore' },
      { kind: 'agent', label: '■ Explore', text: 'a.txt has it. …', agent: null }
    ])
  })

  it("corrects a guessed description from the Agent call's result", () => {
    const call = (id: string, description: string): object => ({
      tool_name: 'Agent',
      tool_use_id: id,
      tool_input: { subagent_type: 'Explore', description }
    })
    hook('PreToolUse', call('t1', 'first'))
    hook('PreToolUse', call('t2', 'second'))
    // The second call's subagent starts first.
    hook('SubagentStart', { agent_id: 'b', agent_type: 'Explore' })
    hook('SubagentStart', { agent_id: 'a', agent_type: 'Explore' })
    expect(log.snapshot('p1').agents.map((r) => r.description)).toEqual(['first', 'second'])
    hook('PostToolUse', { ...call('t2', 'second'), tool_response: { agentId: 'b' } })
    hook('PostToolUse', { ...call('t1', 'first'), tool_response: { agentId: 'a' } })
    expect(log.snapshot('p1').agents.map((r) => [r.id, r.description, r.status])).toEqual([
      ['b', 'second', 'done'],
      ['a', 'first', 'done']
    ])
  })

  it('leaves background subagents running past the turn, and stops foreground ones', () => {
    hook('PreToolUse', {
      tool_name: 'Agent',
      tool_use_id: 't1',
      tool_input: { subagent_type: 'general-purpose', run_in_background: true }
    })
    hook('SubagentStart', { agent_id: 'bg', agent_type: 'general-purpose' })
    hook('PostToolUse', {
      tool_name: 'Agent',
      tool_use_id: 't1',
      tool_input: { run_in_background: true },
      tool_response: { status: 'async_launched', agentId: 'bg' }
    })
    hook('SubagentStart', { agent_id: 'fg', agent_type: 'Explore' })
    // Interrupted: no SubagentStop for fg.
    hook('Stop', {})
    expect(log.snapshot('p1').agents.map((r) => [r.id, r.status, r.background])).toEqual([
      ['bg', 'running', true],
      ['fg', 'stopped', false]
    ])
    log.exited('p1')
    expect(log.snapshot('p1').agents.map((r) => r.status)).toEqual(['stopped', 'stopped'])
  })

  it('keeps an async agent running past its call and the turn, as 2.1.302 runs them', () => {
    // Captured order: Explore agents run in the background without being asked.
    const input = { description: 'count files', subagent_type: 'Explore' }
    hook('PreToolUse', { tool_name: 'Agent', tool_use_id: 't1', tool_input: input })
    hook('SubagentStart', { agent_id: 'a1', agent_type: 'Explore' })
    hook('PostToolUse', {
      tool_name: 'Agent',
      tool_use_id: 't1',
      tool_input: input,
      tool_response: { isAsync: true, status: 'async_launched', agentId: 'a1' }
    })
    hook('Stop', { last_assistant_message: 'Both agents are running.' })
    expect(log.snapshot('p1').agents).toMatchObject([
      { id: 'a1', description: 'count files', status: 'running', background: true }
    ])
    hook('SubagentStop', { agent_id: 'a1', agent_type: 'Explore', last_assistant_message: '2' })
    hook('UserPromptSubmit', {
      prompt:
        '<task-notification>\n<task-id>a1</task-id>\n<tool-use-id>t1</tool-use-id>\n' +
        '<status>completed</status>\n<summary>Agent "count files" finished</summary>\n' +
        '</task-notification>'
    })
    // Claude Code's prompt-suggestion helper.
    hook('SubagentStop', { agent_id: 'h1', agent_type: '', last_assistant_message: 'commit this' })
    expect(log.snapshot('p1').agents.map((r) => [r.id, r.status])).toEqual([['a1', 'done']])
    // The notification isn't a prompt the user typed, and the helper isn't listed.
    expect(entries()).toEqual([
      { kind: 'tool', label: 'Agent', text: 'Explore: count files', agent: null },
      { kind: 'agent', label: '▸ Explore', text: 'count files', agent: null },
      { kind: 'stop', label: '', text: 'Both agents are running.', agent: null },
      { kind: 'agent', label: '■ Explore', text: '2', agent: null },
      { kind: 'note', label: '', text: 'Agent "count files" finished', agent: null }
    ])
  })

  it('matches a background agent whose call returns before it starts', () => {
    const input = { description: 'list exports', subagent_type: 'Explore' }
    hook('PreToolUse', { tool_name: 'Agent', tool_use_id: 't1', tool_input: input })
    hook('PostToolUse', {
      tool_name: 'Agent',
      tool_use_id: 't1',
      tool_input: input,
      tool_response: { status: 'async_launched', agentId: 'a1', agentType: 'Explore' }
    })
    hook('SubagentStart', { agent_id: 'a1', agent_type: 'Explore' })
    expect(log.snapshot('p1').agents).toMatchObject([
      { id: 'a1', description: 'list exports', status: 'running' }
    ])
    expect(entries().at(-1)).toMatchObject({ label: '▸ Explore', text: 'list exports' })

    // Without an agentId in the result, SubagentStart still finds the call.
    const other = { description: 'second', subagent_type: 'Plan' }
    hook('PreToolUse', { tool_name: 'Agent', tool_use_id: 't2', tool_input: other })
    hook('PostToolUse', {
      tool_name: 'Agent',
      tool_use_id: 't2',
      tool_input: other,
      tool_response: { isAsync: true }
    })
    hook('SubagentStart', { agent_id: 'a2', agent_type: 'Plan' })
    expect(log.snapshot('p1').agents.map((r) => r.description)).toEqual(['list exports', 'second'])
  })

  it('names an agent from its task notification when nothing else did', () => {
    hook('PreToolUse', {
      tool_name: 'Agent',
      tool_use_id: 't9',
      tool_input: { description: 'find greeting', subagent_type: 'Explore' }
    })
    // Its start was matched to nothing (the call was consumed elsewhere).
    log.claude('p1', 'SubagentStart', { agent_id: 'zz', agent_type: 'general-purpose' })
    hook('UserPromptSubmit', {
      prompt:
        '<task-notification><task-id>zz</task-id><tool-use-id>t9</tool-use-id><status>failed</status></task-notification>'
    })
    expect(log.snapshot('p1').agents).toMatchObject([
      { id: 'zz', description: 'find greeting', status: 'failed', background: true }
    ])
    expect(entries().at(-1)).toMatchObject({ kind: 'note', text: 'A background task ended' })
  })

  it('logs permission requests, denials, and session changes', () => {
    hook('PermissionRequest', { tool_name: 'Bash', tool_input: { command: 'rm -rf build' } })
    hook('PermissionDenied', { tool_name: 'Bash', tool_input: { command: 'rm -rf build' } })
    hook('PreCompact', { trigger: 'auto' })
    hook('SessionStart', { source: 'compact' })
    hook('SessionEnd', { reason: 'clear' })
    hook('SessionStart', { source: 'clear' })
    hook('SessionEnd', { reason: 'prompt_input_exit' })
    log.exited('p1')
    expect(entries()).toEqual([
      { kind: 'ask', label: 'Bash', text: 'rm -rf build', agent: null },
      { kind: 'fail', label: 'Bash denied', text: 'rm -rf build', agent: null },
      { kind: 'compact', label: 'Auto-compacting', text: '', agent: null },
      { kind: 'session', label: 'Cleared', text: '', agent: null },
      { kind: 'session', label: 'Ended', text: '', agent: null }
    ])
  })

  it('keeps Bash commands whole, with the directory they ran in', () => {
    const script = `cat <<'EOF' > notes.txt\n${'x'.repeat(5000)}\nEOF`
    hook('PreToolUse', { tool_name: 'Bash', tool_input: { command: script } })
    hook('PermissionRequest', {
      tool_name: 'Bash',
      cwd: `${CWD}/web`,
      tool_input: { command: 'rm -rf dist' }
    })
    hook('PreToolUse', { tool_name: 'Bash', tool_input: { command: 'y'.repeat(20_001) } })
    hook('PreToolUse', { tool_name: 'Bash', tool_input: { command: '  ' } })
    expect(log.snapshot('p1').entries.map((e) => e.command)).toEqual([
      { text: script, cwd: CWD },
      { text: 'rm -rf dist', cwd: `${CWD}/web` },
      null,
      null
    ])
  })

  it('keeps the absolute path of the file a call reads or changes', () => {
    hook('PreToolUse', { tool_name: 'Edit', tool_input: { file_path: `${CWD}/a.ts` } })
    hook('PermissionRequest', { tool_name: 'Write', tool_input: { file_path: '/etc/hosts' } })
    hook('PreToolUse', {
      tool_name: 'NotebookEdit',
      tool_input: { notebook_path: `${CWD}/n.ipynb` }
    })
    hook('PreToolUse', { tool_name: 'Read', tool_input: { file_path: 'relative.ts' } })
    hook('PreToolUse', { tool_name: 'Grep', tool_input: { pattern: 'x', path: CWD } })
    hook('PreToolUse', { tool_name: 'Bash', tool_input: { command: 'ls' } })
    expect(log.snapshot('p1').entries.map((e) => e.file)).toEqual([
      `${CWD}/a.ts`,
      '/etc/hosts',
      `${CWD}/n.ipynb`,
      null,
      null,
      null
    ])
  })

  it('copes with a payload too large to read', () => {
    log.claude('p1', 'PreToolUse', null)
    log.claude('p1', 'PostToolUse', null)
    expect(entries()).toEqual([{ kind: 'tool', label: '?', text: '', agent: null }])
  })

  it('logs what Codex reports', () => {
    log.started('p2', 'codex')
    log.codex('p2', { kind: 'working', clears: true })
    log.codex('p2', { kind: 'waiting', key: null, message: null })
    log.codex('p2', { kind: 'waiting', key: null, message: 'Approval requested: ls' })
    log.codex('p2', { kind: 'done', message: null })
    log.exited('p2')
    expect(log.snapshot('p2').entries.map((e) => [e.kind, e.label, e.text])).toEqual([
      ['session', 'Started', 'Codex'],
      ['prompt', '', 'Turn started'],
      ['ask', 'Approval', 'Approval requested: ls'],
      ['stop', '', 'Turn complete'],
      ['session', 'Exited', '']
    ])
  })

  it('keeps shells empty, keeps the newest entries, and forgets removed panes', () => {
    log.started('shell', null)
    log.exited('shell')
    expect(log.snapshot('shell').entries).toEqual([])

    for (let i = 0; i < MAX_ENTRIES + 5; i++) hook('Notification', { message: `n${String(i)}` })
    const kept = log.snapshot('p1').entries
    expect(kept).toHaveLength(MAX_ENTRIES)
    expect(kept[0]?.seq).toBe(6)
    expect(kept.at(-1)?.seq).toBe(MAX_ENTRIES + 5)

    log.remove('p1')
    expect(log.snapshot('p1')).toEqual({ paneId: 'p1', entries: [], files: [], agents: [] })
  })
})
