import { describe, expect, it } from 'bun:test'
import { agentEnv, agentLaunch, detectAgent, shQuote } from './launch'

const files = { claudeSettings: '/Users/me/.cockpit/agents/claude-settings.json' }

describe('detectAgent', () => {
  it('finds the agent in the first word', () => {
    expect(detectAgent('claude')).toEqual({ agent: 'claude', end: 6 })
    expect(detectAgent('  codex --search')).toEqual({ agent: 'codex', end: 7 })
    expect(detectAgent('~/.local/bin/claude -c')?.agent).toBe('claude')
    expect(detectAgent('FOO=1 BAR=x claude')?.agent).toBe('claude')
    expect(detectAgent('agy --model x')).toEqual({ agent: 'agy', end: 3 })
    expect(detectAgent('~/.local/share/mise/shims/agy')?.agent).toBe('agy')
  })

  it('leaves other commands alone', () => {
    expect(detectAgent(undefined)).toBeNull()
    expect(detectAgent('')).toBeNull()
    expect(detectAgent('claude-monitor')).toBeNull()
    expect(detectAgent('agy-wrapper')).toBeNull()
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

  it('runs Codex as it is, so it keeps its shared background server', () => {
    expect(agentLaunch('codex resume --last', files)).toEqual({
      command: 'codex resume --last',
      agent: 'codex'
    })
    expect(agentEnv('codex')).toEqual({})
  })

  it('runs agy as it is; its reporting is switched on in the environment', () => {
    expect(agentLaunch('agy --model x', files)).toEqual({ command: 'agy --model x', agent: 'agy' })
    expect(agentEnv('agy')).toEqual({ AGY_CLI_OSC7501: 'on' })
    expect(agentEnv('claude')).toEqual({})
    expect(agentEnv(null)).toEqual({})
  })

  it("continues agy's latest conversation when resuming, since it has no picker flag", () => {
    expect(agentLaunch('agy --model x', files, { resume: true }).command).toBe(
      'agy --continue --model x'
    )
  })

  it('passes agy a first prompt as one word, so a leading "--" stays text', () => {
    expect(agentLaunch('agy', files, { prompt: ' --fix it' }).command).toBe(
      `agy '--prompt-interactive=--fix it'`
    )
    expect(agentLaunch('agy', files, { prompt: "it's" }).command).toBe(
      `agy '--prompt-interactive=it'\\''s'`
    )
  })

  it('opens the session picker when resuming', () => {
    expect(agentLaunch('claude --model opus', files, { resume: true }).command).toBe(
      `claude --resume --settings ${files.claudeSettings} --model opus`
    )
    expect(agentLaunch('codex --search', files, { resume: true }).command).toBe(
      'codex resume --search'
    )
    expect(agentLaunch('htop', files, { resume: true })).toEqual({ command: 'htop', agent: null })
  })

  it('resumes a specific session id or falls back to the latest conversation on auto-resume', () => {
    expect(
      agentLaunch('claude --model opus', files, { resume: 'last', sessionId: 'sess-123' }).command
    ).toBe(`claude --resume sess-123 --settings ${files.claudeSettings} --model opus`)
    expect(agentLaunch('claude', files, { sessionId: 'sess-123' }).command).toBe(
      `claude --resume sess-123 --settings ${files.claudeSettings}`
    )
    expect(agentLaunch('claude', files, { resume: false, sessionId: 'sess-123' }).command).toBe(
      `claude --settings ${files.claudeSettings}`
    )
    expect(agentLaunch('claude', files, { resume: 'last' }).command).toBe(
      `claude --continue --settings ${files.claudeSettings}`
    )
    // Invalid session ids (e.g. starting with "-" or path traversal) fall back to --continue.
    expect(agentLaunch('claude', files, { resume: 'last', sessionId: '--bad' }).command).toBe(
      `claude --continue --settings ${files.claudeSettings}`
    )
    expect(agentLaunch('codex --search', files, { resume: 'last' }).command).toBe(
      'codex resume --last --search'
    )
    expect(agentLaunch('agy --model x', files, { resume: 'last' }).command).toBe(
      'agy --continue --model x'
    )
    expect(
      agentLaunch('claude', files, { resume: 'last', sessionId: 'sess-123', prompt: 'hi' }).prompted
    ).toBeUndefined()
  })

  it('passes a first prompt last, quoted', () => {
    expect(agentLaunch('claude', files, { prompt: "/start-story sc-12 it's" }).command).toBe(
      `claude --settings ${files.claudeSettings} '/start-story sc-12 it'\\''s'`
    )
    expect(agentLaunch('codex', files, { prompt: 'fix it' })).toEqual({
      command: `codex 'fix it'`,
      agent: 'codex',
      prompted: true
    })
    // Resuming opens the picker, so there's no first prompt to give.
    expect(agentLaunch('codex', files, { prompt: 'fix it', resume: true }).prompted).toBeUndefined()
    expect(agentLaunch('codex', files, { prompt: '  ' }).prompted).toBeUndefined()
    expect(agentLaunch('htop', files, { prompt: 'hi' }).command).toBe('htop')
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

describe('agentLaunch with a model and effort', () => {
  it('gives Claude Code both, after its hook settings and before the prompt', () => {
    const r = agentLaunch('claude', files, {
      model: 'claude-opus-5-5',
      effort: 'medium',
      prompt: '/approve-ship --quick https://x.slack.com/archives/C1/p2'
    })
    expect(r.command).toBe(
      `claude --settings ${files.claudeSettings} --model claude-opus-5-5 --effort medium ` +
        `'/approve-ship --quick https://x.slack.com/archives/C1/p2'`
    )
    expect(r.prompted).toBe(true)
  })

  it('quotes a model with brackets', () => {
    expect(agentLaunch('claude', files, { model: 'opus[1m]' }).command).toBe(
      `claude --settings ${files.claudeSettings} --model 'opus[1m]'`
    )
  })

  it('gives Codex the model only', () => {
    expect(agentLaunch('codex', files, { model: 'gpt-5.5', effort: 'high' }).command).toBe(
      'codex --model gpt-5.5'
    )
  })

  it('gives agy neither', () => {
    expect(agentLaunch('agy', files, { model: 'x', effort: 'low' }).command).toBe('agy')
  })

  it('leaves other commands alone', () => {
    expect(agentLaunch('bash', files, { model: 'x' }).command).toBe('bash')
  })
})
