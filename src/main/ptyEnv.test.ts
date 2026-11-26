import { describe, expect, it } from 'bun:test'
import { paneEnv, spawnEnv } from './ptyEnv'

describe('paneEnv', () => {
  it('drops what describes where Cockpit was launched, NODE_ENV included, and keeps the rest', () => {
    const env = paneEnv({
      NODE_ENV: 'production',
      ELECTRON_RUN_AS_NODE: '1',
      TMUX: '/tmp/tmux',
      CLAUDECODE: '1',
      PATH: '/usr/bin',
      ANTHROPIC_API_KEY: 'key',
      HOME: '/Users/me'
    })

    expect(env).toEqual({ PATH: '/usr/bin', ANTHROPIC_API_KEY: 'key', HOME: '/Users/me' })
  })

  it('leaves out variables that are set but undefined', () => {
    expect(paneEnv({ PATH: '/usr/bin', EMPTY: undefined })).toEqual({ PATH: '/usr/bin' })
  })
})

describe('spawnEnv', () => {
  it('turns on synchronized output for Claude Code over a value Cockpit inherited', () => {
    const env = spawnEnv({ PATH: '/usr/bin', CLAUDE_CODE_FORCE_SYNC_OUTPUT: '0' })
    expect(env).toMatchObject({ TERM_PROGRAM: 'Cockpit', CLAUDE_CODE_FORCE_SYNC_OUTPUT: '1' })
  })

  it('lets the agent monitor override any of it', () => {
    const env = spawnEnv({ PATH: '/usr/bin' }, { CLAUDE_CODE_FORCE_SYNC_OUTPUT: '0', PATH: '/x' })
    expect(env).toMatchObject({ CLAUDE_CODE_FORCE_SYNC_OUTPUT: '0', PATH: '/x' })
  })
})
