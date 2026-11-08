import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { AgentMonitor } from './monitor'

let home: string
let monitor: AgentMonitor
let changed: string[]

function hook(env: Record<string, string>, event: string, payload: object): Promise<number> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        socketPath: env.COCKPIT_SOCKET,
        path: `/v1/events/claude/${event}`,
        method: 'POST',
        headers: { 'x-cockpit-session': env.COCKPIT_SESSION_ID }
      },
      (res) => {
        res.resume()
        resolve(res.statusCode ?? 0)
      }
    )
    req.on('error', reject)
    req.end(JSON.stringify({ hook_event_name: event, ...payload }))
  })
}

beforeEach(async () => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'ck-mon-'))
  changed = []
  monitor = new AgentMonitor({
    home,
    onChange: (id) => changed.push(id),
    onActivity: () => undefined,
    windowFocused: () => true,
    describe: () => ({ name: 'Claude Code', place: 'x' }),
    onClick: () => undefined,
    onFailed: () => undefined
  })
  await monitor.start()
})

afterEach(() => {
  monitor.close()
  fs.rmSync(home, { recursive: true, force: true })
})

describe('AgentMonitor', () => {
  it('writes the hook script and settings, and launches Claude with them', () => {
    expect(fs.statSync(monitor.files.hook).mode & 0o777).toBe(0o755)
    expect(fs.statSync(monitor.files.run).mode & 0o777).toBe(0o755)
    expect(monitor.launch('claude').command).toBe(
      `claude --settings ${monitor.files.claudeSettings}`
    )
  })

  it("puts cockpit-run's folder first on a pane's PATH", () => {
    const env = monitor.spawn('pane-p', null)
    expect(env.PATH?.split(':')[0]).toBe(monitor.files.dir)
    expect(path.dirname(monitor.files.run)).toBe(monitor.files.dir)
  })

  it("leaves a finished turn done until it's seen, and idles one the user is watching", async () => {
    const a = monitor.spawn('pane-a', 'claude')
    const b = monitor.spawn('pane-b', 'claude')
    monitor.setFocused('pane-b')
    expect(await hook(a, 'Stop', { last_assistant_message: 'ok' })).toBe(204)
    expect(await hook(b, 'Stop', { last_assistant_message: 'ok' })).toBe(204)
    expect(monitor.status('pane-a')?.status).toBe('done')
    expect(monitor.status('pane-b')?.status).toBe('idle')
    monitor.setFocused('pane-a')
    expect(monitor.status('pane-a')?.status).toBe('idle')
  })

  it('refuses events from a token it no longer knows', async () => {
    const old = monitor.spawn('pane-a', 'claude')
    monitor.spawn('pane-a', 'claude')
    expect(await hook(old, 'Stop', {})).toBe(403)
  })

  it("logs a pane's hooks as activity, and forgets it with the pane", async () => {
    const env = monitor.spawn('pane-a', 'claude')
    monitor.setFocused('pane-a')
    await hook(env, 'PreToolUse', { tool_name: 'Bash', tool_input: { command: 'ls' } })
    await hook(env, 'SubagentStart', { agent_id: 'x', agent_type: 'Explore' })
    // Subagent hooks only feed the log; the turn is still running.
    expect(monitor.status('pane-a')?.status).toBe('working')
    const { entries, agents } = monitor.activity.snapshot('pane-a')
    expect(entries.map((e) => [e.kind, e.label, e.text])).toEqual([
      ['tool', 'Bash', 'ls'],
      ['agent', '▸ Explore', 'started']
    ])
    expect(agents.map((a) => a.status)).toEqual(['running'])
    monitor.killed('pane-a')
    expect(monitor.activity.snapshot('pane-a').entries).toEqual([])
  })

  it('reports a killed pane so counts can drop it', () => {
    monitor.spawn('pane-a', 'claude')
    changed = []
    monitor.killed('pane-a')
    expect(changed).toEqual(['pane-a'])
    expect(monitor.status('pane-a')).toBeNull()
  })
})
