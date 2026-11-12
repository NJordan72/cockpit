import { describe, expect, it } from 'bun:test'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { CLAUDE_HOOK_EVENTS } from './events'
import { agentLaunch, shQuote } from './launch'
import {
  inlineHookCommand,
  remoteClaudeSettings,
  remoteCommand,
  remoteDir,
  remoteSocketPath
} from './remote'

/**
 * Runs a remote command the way it would run for real, with ssh swapped for
 * a function that hands its last argument to the "remote" user's shell,
 * as sshd does. Returns what the command printed.
 */
function runLocally(command: string): string {
  const fakeSsh = 'ssh() { for a; do last=$a; done; "$SHELL" -c "$last"; }'
  const out = spawnSync('/bin/sh', ['-c', `${fakeSsh}\n${command}`], {
    encoding: 'utf8',
    env: { PATH: process.env.PATH, HOME: os.homedir(), SHELL: '/bin/sh' }
  })
  expect(out.stderr).toBe('')
  return out.stdout
}

describe('remoteCommand', () => {
  it('forwards the event socket for Claude and passes the session through', () => {
    const cmd = remoteCommand({
      host: 'me@box',
      dir: '~/dev',
      command: 'claude --settings x',
      env: { COCKPIT_SESSION_ID: 't1', COCKPIT_SOCKET: '/tmp/cockpit-t1.sock' },
      forward: { local: '/Users/me/.cockpit/run/cockpit-9.sock', remote: '/tmp/cockpit-t1.sock' }
    })
    expect(cmd).toStartWith(
      'ssh -t -o ExitOnForwardFailure=no -R /tmp/cockpit-t1.sock:/Users/me/.cockpit/run/cockpit-9.sock -- me@box '
    )
  })

  it('needs no forward for an agent that reports through the terminal', () => {
    const cmd = remoteCommand({
      host: 'box',
      dir: '~',
      command: 'agy',
      env: { AGY_CLI_OSC7501: 'on' },
      forward: null
    })
    expect(cmd).toStartWith('ssh -t -- box ')
    expect(cmd).not.toContain('-R')
  })

  it('survives every shell on the way, with the directory, env, and settings intact', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cockpit remote '))
    const sock = path.join(dir, "it's.sock")
    fs.writeFileSync(sock, '')
    const settings = remoteClaudeSettings()
    const cmd = remoteCommand({
      host: 'box',
      dir,
      command: `pwd; printf '%s\\n' "$COCKPIT_SESSION_ID" ${shQuote(settings)}`,
      env: { COCKPIT_SESSION_ID: "tok 'quoted'" },
      forward: { local: '/x.sock', remote: sock }
    })
    const lines = runLocally(cmd).split('\n')
    expect(fs.realpathSync(lines[0] ?? '')).toBe(fs.realpathSync(dir))
    expect(lines[1]).toBe("tok 'quoted'")
    expect(lines[2]).toBe(settings)
    // The forwarded socket is cleaned up once the agent exits.
    expect(fs.existsSync(sock)).toBe(false)
    fs.rmSync(dir, { recursive: true })
  })

  it('starts a login shell when the preset has no command', () => {
    const cmd = remoteCommand({ host: 'box', dir: '~', command: undefined, env: {}, forward: null })
    expect(runLocally(cmd.replace('exec "$SHELL" -l', 'echo login'))).toBe('login\n')
  })

  it('carries the flags agentLaunch adds for a remote Claude', () => {
    const launch = agentLaunch('claude', { claudeSettings: remoteClaudeSettings() })
    const printed = runLocally(
      remoteCommand({
        host: 'box',
        dir: '~',
        command: launch.command?.replace(/^claude/, `printf '%s\\n'`),
        env: {},
        forward: null
      })
    )
    expect(printed.split('\n').slice(0, 2)).toEqual(['--settings', remoteClaudeSettings()])
  })
})

describe('remoteDir', () => {
  it('leaves a leading ~ for the remote shell and quotes the rest', () => {
    expect(remoteDir('~')).toBe('~')
    expect(remoteDir('~/')).toBe('~')
    expect(remoteDir('~/my dir')).toBe(`~/'my dir'`)
    expect(remoteDir('/srv/app')).toBe('/srv/app')
    // Another user's home isn't expanded.
    expect(remoteDir('~bob')).toBe(`'~bob'`)
  })
})

describe('remote Claude settings', () => {
  it('registers an inline hook for every event', () => {
    const parsed = JSON.parse(remoteClaudeSettings()) as {
      hooks: Record<string, [{ hooks: [{ command: string }] }]>
    }
    expect(Object.keys(parsed.hooks)).toEqual([...CLAUDE_HOOK_EVENTS])
    expect(parsed.hooks.Stop?.[0].hooks[0].command).toBe(inlineHookCommand('Stop'))
  })

  it('posts the payload to the socket, prints nothing, and exits 0', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cockpit-hook-'))
    // A stand-in curl that records how it was called.
    fs.writeFileSync(
      path.join(dir, 'curl'),
      `#!/bin/sh\nprintf '%s\\n' "$@" > "${dir}/args"\nexit 7\n`,
      {
        mode: 0o755
      }
    )
    const run = (env: Record<string, string>) =>
      spawnSync('/bin/sh', ['-c', inlineHookCommand('Stop')], {
        input: '{}',
        encoding: 'utf8',
        env: { PATH: `${dir}:/usr/bin:/bin`, ...env }
      })
    const quiet = run({})
    expect([quiet.status, quiet.stdout, fs.existsSync(path.join(dir, 'args'))]).toEqual([
      0,
      '',
      false
    ])
    const sent = run({ COCKPIT_SOCKET: '/tmp/s.sock', COCKPIT_SESSION_ID: 'tok' })
    expect([sent.status, sent.stdout]).toEqual([0, ''])
    const args = fs.readFileSync(path.join(dir, 'args'), 'utf8').split('\n')
    expect(args).toContain('/tmp/s.sock')
    expect(args).toContain('X-Cockpit-Session: tok')
    expect(args).toContain('http://cockpit/v1/events/claude/Stop')
    fs.rmSync(dir, { recursive: true })
  })

  it('gives each pane its own short socket path', () => {
    const p = remoteSocketPath('0b6f2a54-5d0e-4a8c-9d3e-2f1a7c6b5e4d')
    expect(p).toBe('/tmp/cockpit-0b6f2a54-5d0e-4a8c-9d3e-2f1a7c6b5e4d.sock')
    expect(Buffer.byteLength(p)).toBeLessThan(104)
  })
})
