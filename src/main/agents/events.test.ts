import { describe, expect, it } from 'vitest'
import { parseClaudeHook, toolKey } from './events'

const base = {
  session_id: 's1',
  transcript_path: '/Users/me/.claude/projects/p/s1.jsonl',
  cwd: '/Users/me/dev/x'
}

describe('parseClaudeHook', () => {
  it('maps the turn lifecycle', () => {
    expect(parseClaudeHook('SessionStart', { ...base, source: 'startup' }).signal).toEqual({
      kind: 'idle'
    })
    expect(parseClaudeHook('UserPromptSubmit', { ...base, prompt: 'hi' }).signal).toEqual({
      kind: 'working',
      clears: true
    })
    expect(parseClaudeHook('PreToolUse', { ...base, tool_name: 'Read' }).signal).toEqual({
      kind: 'working'
    })
    expect(
      parseClaudeHook('Stop', { ...base, stop_hook_active: false, last_assistant_message: ' ok ' })
        .signal
    ).toEqual({ kind: 'done', message: 'ok' })
    expect(parseClaudeHook('SessionEnd', { ...base, reason: 'clear' }).signal).toEqual({
      kind: 'idle'
    })
  })

  it('ties a permission request to the tool call that settles it', () => {
    const input = { command: 'rm -rf build' }
    const asked = parseClaudeHook('PermissionRequest', {
      ...base,
      tool_name: 'Bash',
      tool_input: input
    }).signal
    const ran = parseClaudeHook('PostToolUse', {
      ...base,
      tool_name: 'Bash',
      tool_input: input,
      tool_response: { stdout: '' }
    }).signal
    expect(asked).toEqual({
      kind: 'waiting',
      key: toolKey('Bash', input),
      message: 'Claude needs permission to use Bash'
    })
    expect(ran).toEqual({ kind: 'working', resolves: toolKey('Bash', input) })
    // A different call to the same tool settles nothing.
    expect(toolKey('Bash', { command: 'ls' })).not.toBe(toolKey('Bash', input))
  })

  it('treats a question from Claude as needing input', () => {
    const signal = parseClaudeHook('PreToolUse', {
      ...base,
      tool_name: 'AskUserQuestion',
      tool_input: { questions: [] }
    }).signal
    expect(signal).toMatchObject({ kind: 'waiting', message: 'Claude has a question' })
  })

  it('reads blocking notifications as reminders and ignores the rest', () => {
    expect(
      parseClaudeHook('Notification', {
        ...base,
        notification_type: 'permission_prompt',
        message: 'Claude needs your permission to use Bash'
      }).signal
    ).toEqual({
      kind: 'waiting',
      key: null,
      message: 'Claude needs your permission to use Bash',
      reminder: true
    })
    for (const type of ['idle_prompt', 'auth_success', 'agent_completed']) {
      expect(
        parseClaudeHook('Notification', { ...base, notification_type: type, message: 'x' }).signal
      ).toEqual({ kind: 'none' })
    }
  })

  it('tells a manual compaction from one inside a turn', () => {
    // Compaction restarts the session, which mustn't end a running turn.
    expect(parseClaudeHook('SessionStart', { ...base, source: 'compact' }).signal).toEqual({
      kind: 'none'
    })
    expect(parseClaudeHook('PostCompact', { ...base, trigger: 'manual' }).signal).toEqual({
      kind: 'idle'
    })
    expect(parseClaudeHook('PostCompact', { ...base, trigger: 'auto' }).signal).toEqual({
      kind: 'none'
    })
  })

  it('carries the transcript path and session title', () => {
    const r = parseClaudeHook('SessionStart', { ...base, session_title: 'Fix login' })
    expect(r.transcriptPath).toBe(base.transcript_path)
    expect(r.title).toBe('Fix login')
  })

  it('falls back to the event name from the URL when the payload is unreadable', () => {
    expect(parseClaudeHook('Stop', null).signal).toEqual({ kind: 'done', message: null })
    expect(parseClaudeHook('PostToolUse', 'not json').signal).toMatchObject({ kind: 'working' })
    expect(parseClaudeHook('SomethingNew', {}).signal).toEqual({ kind: 'none' })
  })
})
