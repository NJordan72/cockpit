import { afterEach, beforeEach, describe, expect, it, jest } from 'bun:test'
import type { AgentKind, SessionInfo, SessionStatus } from '@shared/widgets'
import {
  CHECK_EVERY_MS,
  FIRST_CHECK_MS,
  isDeveloperIdSignature,
  restartPrompt,
  Updates
} from './updater'

interface Harness {
  updates: Updates
  checks: number
  installs: number
  asked: string[]
  told: string[]
  answer: boolean
  canAsk: boolean
}

function harness(): Harness {
  const h = { checks: 0, installs: 0, asked: [], told: [], answer: false, canAsk: true } as Omit<
    Harness,
    'updates'
  > as Harness
  h.updates = new Updates({
    currentVersion: '0.3.0',
    check: () => {
      h.checks++
      return Promise.resolve()
    },
    install: () => h.installs++,
    askToRestart: (version) => {
      h.asked.push(version)
      return Promise.resolve(h.answer)
    },
    tell: (message) => h.told.push(message),
    canAsk: () => h.canAsk,
    onChange: () => undefined
  })
  return h
}

/** Lets askToRestart's promise and its .then run. */
const settle = async (): Promise<void> => {
  await Promise.resolve()
  await Promise.resolve()
}

let h: Harness
let warn: { mockRestore: () => void }

beforeEach(() => {
  jest.useFakeTimers()
  warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined)
  h = harness()
})

afterEach(() => {
  h.updates.close()
  warn.mockRestore()
  jest.useRealTimers()
})

describe('Updates', () => {
  it('checks a minute after start, then every four hours', () => {
    h.updates.start()
    jest.advanceTimersByTime(FIRST_CHECK_MS - 1)
    expect(h.checks).toBe(0)
    jest.advanceTimersByTime(1)
    expect(h.checks).toBe(1)
    h.updates.notAvailable()
    jest.advanceTimersByTime(CHECK_EVERY_MS)
    expect(h.checks).toBe(2)
  })

  it('asks once per version, and Later leaves it for the next quit', async () => {
    h.updates.start()
    jest.advanceTimersByTime(FIRST_CHECK_MS)
    h.updates.available('0.3.1')
    expect(h.updates.menuItem()).toEqual({ label: 'Downloading Cockpit 0.3.1…', enabled: false })
    h.updates.downloaded('0.3.1')
    await settle()
    expect(h.asked).toEqual(['0.3.1'])
    expect(h.installs).toBe(0)
    expect(h.updates.menuItem()).toEqual({
      label: 'Restart to Install Cockpit 0.3.1…',
      enabled: true
    })
    // Later: the next tick neither asks again nor checks again.
    jest.advanceTimersByTime(CHECK_EVERY_MS)
    await settle()
    expect(h.asked).toEqual(['0.3.1'])
    expect(h.checks).toBe(1)
  })

  it('installs when the user picks Restart Now', async () => {
    h.answer = true
    h.updates.downloaded('0.3.1')
    await settle()
    expect(h.installs).toBe(1)
  })

  it('asks again from the menu after Later', async () => {
    h.updates.downloaded('0.3.1')
    await settle()
    h.answer = true
    h.updates.checkNow()
    await settle()
    expect(h.asked).toEqual(['0.3.1', '0.3.1'])
    expect(h.installs).toBe(1)
  })

  it('waits to ask while a dialog would be out of place', async () => {
    h.updates.start()
    h.canAsk = false
    h.updates.downloaded('0.3.1')
    await settle()
    expect(h.asked).toEqual([])
    h.canAsk = true
    jest.advanceTimersByTime(FIRST_CHECK_MS)
    await settle()
    expect(h.asked).toEqual(['0.3.1'])
  })

  it('reports the outcome of a check from the menu, and keeps quiet otherwise', () => {
    h.updates.start()
    jest.advanceTimersByTime(FIRST_CHECK_MS)
    h.updates.notAvailable()
    h.updates.failed(new Error('offline'))
    expect(h.told).toEqual([])

    h.updates.checkNow()
    expect(h.updates.menuItem()).toEqual({ label: 'Checking for Updates…', enabled: false })
    h.updates.notAvailable()
    h.updates.checkNow()
    h.updates.failed(new Error('offline'))
    expect(h.told).toEqual(["You're up to date", "Cockpit couldn't check for updates"])
    expect(h.updates.current).toEqual({ kind: 'idle' })
  })

  it('keeps a downloaded update when a later step fails', () => {
    h.updates.downloaded('0.3.1')
    h.updates.failed(new Error('boom'))
    expect(h.updates.current).toEqual({ kind: 'ready', version: '0.3.1' })
  })
})

function session(status: SessionStatus, agent: AgentKind | null = null): SessionInfo {
  return {
    id: `p${Math.random().toString()}`,
    tabId: 't1',
    presetId: agent ?? 'shell',
    name: agent ?? 'Shell',
    cwd: '~',
    branch: null,
    status,
    since: 0,
    agent,
    title: null,
    tokens: null,
    focused: false
  }
}

describe('restartPrompt', () => {
  it('says Cockpit just reopens when nothing is running', () => {
    const p = restartPrompt('0.3.1', [session('exited')])
    expect(p.message).toBe('Cockpit 0.3.1 is ready to install')
    expect(p.detail).toBe(
      'Cockpit will close and reopen. Choose Later to install it the next time you quit Cockpit.'
    )
    expect(p.defaultId).toBe(0)
  })

  it('counts the terminals a restart would close', () => {
    const p = restartPrompt('0.3.1', [session('idle'), session('done', 'claude')])
    expect(p.detail).toContain("Restarting closes 2 terminals and ends what's running in them. ")
    expect(p.defaultId).toBe(0)
  })

  it('calls out busy agents and makes Later the default', () => {
    const p = restartPrompt('0.3.1', [
      session('working', 'claude'),
      session('needs-input', 'codex'),
      session('working'),
      session('idle', 'claude')
    ])
    expect(p.detail).toContain(
      "closes 4 terminals and ends what's running in them, including 2 agents that are working or waiting for you."
    )
    expect(p.buttons).toEqual(['Restart Now', 'Later'])
    expect(p.defaultId).toBe(1)
    expect(p.cancelId).toBe(1)
  })

  it('uses the singular for one of each', () => {
    const p = restartPrompt('0.3.1', [session('working', 'claude')])
    expect(p.detail).toContain(
      "closes 1 terminal and ends what's running in it, including 1 agent that is working"
    )
  })
})

describe('isDeveloperIdSignature', () => {
  it('accepts a Developer ID signature and rejects an ad-hoc one', () => {
    expect(
      isDeveloperIdSignature(
        [
          'Identifier=io.github.njordan72.cockpit',
          'Authority=Developer ID Application: Nick Jordan (PYDSP98TRH)',
          'Authority=Developer ID Certification Authority',
          'Authority=Apple Root CA',
          'TeamIdentifier=PYDSP98TRH'
        ].join('\n')
      )
    ).toBe(true)
    expect(
      isDeveloperIdSignature(
        'Identifier=io.github.njordan72.cockpit\nSignature=adhoc\nTeamIdentifier=not set'
      )
    ).toBe(false)
  })
})
