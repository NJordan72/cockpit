import { describe, expect, it } from 'vitest'
import { paneEnv } from './ptyEnv'

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
