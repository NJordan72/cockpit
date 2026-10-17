import { describe, expect, it } from 'vitest'
import { agentLaunch, CODEX_SETTINGS, detectAgent, shQuote } from './launch'

const files = { claudeSettings: '/Users/me/.cockpit/agents/claude-settings.json' }

describe('detectAgent', () => {
  it('finds the agent in the first word', () => {
    expect(detectAgent('claude')).toEqual({ agent: 'claude', end: 6 })
    expect(detectAgent('  codex --search')).toEqual({ agent: 'codex', end: 7 })
    expect(detectAgent('~/.local/bin/claude -c')?.agent).toBe('claude')
    expect(detectAgent('FOO=1 BAR=x claude')?.agent).toBe('claude')
  })

  it('leaves other commands alone', () => {
    expect(detectAgent(undefined)).toBeNull()
    expect(detectAgent('')).toBeNull()
    expect(detectAgent('claude-monitor')).toBeNull()
    expect(detectAgent('cd ~/dev && claude')).toBeNull()
    expect(detectAgent('echo claude')).toBeNull()
  })
})

describe('agentLaunch', () => {
  it('passes Claude Code the hook settings right after its name', () => {
    expect(agentLaunch('claude --model opus', files)).toEqual({
      command: `claude --settings ${files.claudeSettings} --model opus`,
      agent: 'claude'
    })
  })

  it('quotes a settings path with spaces', () => {
    const r = agentLaunch('claude', { claudeSettings: "/Users/me/My Stuff/it's.json" })
    expect(r.command).toBe(`claude --settings '/Users/me/My Stuff/it'\\''s.json'`)
  })

  it('passes Codex its terminal reporting settings', () => {
    const r = agentLaunch('codex resume --last', files)
    expect(r.agent).toBe('codex')
    expect(r.command).toBe(
      `codex ${CODEX_SETTINGS.map((s) => `-c ${shQuote(s)}`).join(' ')} resume --last`
    )
    expect(r.command).toContain(`-c 'tui.notification_method="osc9"'`)
  })

  it('runs anything else unchanged', () => {
    expect(agentLaunch(undefined, files)).toEqual({ command: undefined, agent: null })
    expect(agentLaunch('htop', files)).toEqual({ command: 'htop', agent: null })
  })
})

describe('shQuote', () => {
  it('leaves plain words bare and quotes the rest for sh', () => {
    expect(shQuote('/a/b-c_d.json')).toBe('/a/b-c_d.json')
    expect(shQuote('a b')).toBe(`'a b'`)
    expect(shQuote(`it's`)).toBe(`'it'\\''s'`)
    expect(shQuote('$HOME')).toBe(`'$HOME'`)
  })
})
