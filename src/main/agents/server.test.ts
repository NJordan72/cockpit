import { execFile } from 'node:child_process'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { claudeSettings, HOOK_SCRIPT, RUN_SCRIPT } from './files'
import {
  EventServer,
  MAX_EVENT_BYTES,
  MAX_RUN_BYTES,
  socketPath,
  type IncomingEvent
} from './server'

let dir: string
let server: EventServer
let events: IncomingEvent[]

function post(
  url: string,
  body: string | Buffer,
  headers: Record<string, string> = { 'x-cockpit-session': 'tok' }
): Promise<number> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { socketPath: server.path, path: url, method: 'POST', headers },
      (res) => {
        res.resume()
        resolve(res.statusCode ?? 0)
      }
    )
    req.on('error', reject)
    req.end(body)
  })
}

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ck-'))
  events = []
  server = new EventServer(path.join(dir, 'run', 'cockpit-1.sock'), (e) => {
    events.push(e)
    return e.token === 'tok'
  })
  await server.start()
})

afterEach(() => {
  server.close()
  fs.rmSync(dir, { recursive: true, force: true })
})

describe('EventServer', () => {
  it('accepts a hook event for a known session', async () => {
    expect(await post('/v1/events/claude/Stop', '{"hook_event_name":"Stop"}')).toBe(204)
    expect(events).toEqual([
      { agent: 'claude', event: 'Stop', token: 'tok', payload: { hook_event_name: 'Stop' } }
    ])
  })

  it('answers 403 for a session it does not know', async () => {
    expect(await post('/v1/events/claude/Stop', '{}', { 'x-cockpit-session': 'stranger' })).toBe(
      403
    )
  })

  it('refuses other paths, methods, and requests without a session', async () => {
    expect(await post('/v1/events/claude/Stop', '{}', {})).toBe(404)
    expect(await post('/v1/events/emacs/Stop', '{}')).toBe(404)
    expect(await post('/v1/events/claude/../../x', '{}')).toBe(404)
    expect(events).toEqual([])
  })

  it('keeps the event name when the payload is too large or not JSON', async () => {
    expect(
      await post('/v1/events/claude/PostToolUse', Buffer.alloc(MAX_EVENT_BYTES + 1, 0x20))
    ).toBe(204)
    expect(await post('/v1/events/claude/Stop', 'not json')).toBe(204)
    expect(events.map((e) => [e.event, e.payload])).toEqual([
      ['PostToolUse', null],
      ['Stop', null]
    ])
  })

  it('makes the socket private to this user', () => {
    expect(fs.statSync(server.path).mode & 0o777).toBe(0o600)
    expect(fs.statSync(path.dirname(server.path)).mode & 0o777).toBe(0o700)
  })
})

describe('socketPath', () => {
  it('uses the run directory, or the temp directory when that path is too long', () => {
    expect(socketPath('/Users/me/.cockpit', 42)).toBe('/Users/me/.cockpit/run/cockpit-42.sock')
    expect(socketPath('/x'.repeat(60), 42)).toBe(path.join(os.tmpdir(), 'cockpit-42.sock'))
  })

  it('removes sockets left by Cockpit processes that are gone', async () => {
    const stale = path.join(dir, 'run', 'cockpit-999999.sock')
    fs.writeFileSync(stale, '')
    const other = new EventServer(path.join(dir, 'run', 'cockpit-2.sock'), () => true)
    await other.start()
    other.close()
    expect(fs.existsSync(stale)).toBe(false)
    expect(fs.existsSync(server.path)).toBe(true)
  })
})

describe('the hook script', () => {
  function runHook(
    env: Record<string, string>,
    stdin: string
  ): Promise<{ code: number; stdout: string }> {
    const script = path.join(dir, 'cockpit-hook')
    fs.writeFileSync(script, HOOK_SCRIPT, { mode: 0o755 })
    return new Promise((resolve) => {
      const child = execFile(script, ['claude', 'PermissionRequest'], { env }, (err, stdout) => {
        resolve({ code: err ? Number(err.code) : 0, stdout })
      })
      child.stdin?.end(stdin)
    })
  }

  it('forwards the payload and prints nothing', async () => {
    const payload = '{"hook_event_name":"PermissionRequest","tool_name":"Bash"}'
    const r = await runHook({ COCKPIT_SOCKET: server.path, COCKPIT_SESSION_ID: 'tok' }, payload)
    expect(r).toEqual({ code: 0, stdout: '' })
    expect(events).toEqual([
      {
        agent: 'claude',
        event: 'PermissionRequest',
        token: 'tok',
        payload: JSON.parse(payload) as unknown
      }
    ])
  })

  it('ignores ~/.curlrc, which could make curl print', async () => {
    const home = path.join(dir, 'home')
    fs.mkdirSync(home)
    fs.writeFileSync(path.join(home, '.curlrc'), 'write-out = "%{http_code}\\n"\n')
    const r = await runHook(
      { HOME: home, COCKPIT_SOCKET: server.path, COCKPIT_SESSION_ID: 'tok' },
      '{}'
    )
    expect(r).toEqual({ code: 0, stdout: '' })
    expect(events).toHaveLength(1)
  })

  it('exits 0 when Cockpit is not there to listen', async () => {
    expect(await runHook({}, '{}')).toEqual({ code: 0, stdout: '' })
    expect(
      await runHook({ COCKPIT_SOCKET: path.join(dir, 'gone.sock'), COCKPIT_SESSION_ID: 't' }, '{}')
    ).toEqual({ code: 0, stdout: '' })
  })

  it('is registered for every hook with a quoted path', () => {
    const settings = claudeSettings('/a b/cockpit-hook') as {
      hooks: Record<string, { hooks: { type: string; command: string; timeout: number }[] }[]>
    }
    expect(settings.hooks.Stop?.[0]?.hooks[0]).toEqual({
      type: 'command',
      command: `'/a b/cockpit-hook' claude Stop`,
      timeout: 5
    })
  })
})

describe('cockpit-run', () => {
  let home: string
  let runServer: EventServer
  let requests: { method: string; path: string; body: string }[]

  beforeEach(async () => {
    home = path.join(dir, 'home')
    requests = []
    runServer = new EventServer(
      path.join(home, 'run', 'cockpit-1.sock'),
      () => false,
      (req) => {
        requests.push(req)
        if (req.body.includes('bad')) return Promise.resolve({ status: 400, text: 'no good\n' })
        return Promise.resolve({ status: 200, text: `ok ${req.method} ${req.path}\n` })
      }
    )
    await runServer.start()
  })

  afterEach(() => {
    runServer.close()
  })

  function runScript(
    args: string[],
    env: Record<string, string>,
    stdin = ''
  ): Promise<{ code: number; stdout: string; stderr: string }> {
    const script = path.join(dir, 'cockpit-run')
    fs.writeFileSync(script, RUN_SCRIPT, { mode: 0o755 })
    return new Promise((resolve) => {
      const child = execFile(
        script,
        args,
        { env: { PATH: '/usr/bin:/bin', HOME: home, ...env } },
        (err, stdout, stderr) => {
          resolve({ code: err ? Number(err.code) : 0, stdout, stderr })
        }
      )
      child.stdin?.end(stdin)
    })
  }

  it('submits a run from stdin or a file, lists runs, and marks an item done', async () => {
    const env = { COCKPIT_SOCKET: runServer.path }
    expect(await runScript(['submit'], env, '{"title":"t"}')).toEqual({
      code: 0,
      stdout: 'ok POST /v1/runs\n',
      stderr: ''
    })
    const plan = path.join(dir, 'plan.json')
    fs.writeFileSync(plan, '{"title":"from a file"}')
    expect((await runScript(['submit', plan], env)).code).toBe(0)
    expect((await runScript(['list'], env)).stdout).toBe('ok GET /v1/runs\n')
    expect((await runScript(['done', 'r1', 'sc-101'], env)).stdout).toBe(
      'ok POST /v1/runs/r1/items/sc-101/done\n'
    )
    expect(requests.map((r) => r.body)).toEqual([
      '{"title":"t"}',
      '{"title":"from a file"}',
      '',
      ''
    ])
  })

  it("finds the one Cockpit's socket outside a pane, and says why it can't", async () => {
    expect((await runScript(['list'], { COCKPIT_HOME: home })).code).toBe(0)
    const none = await runScript(['list'], { COCKPIT_HOME: path.join(dir, 'nowhere') })
    expect(none).toMatchObject({ code: 1, stderr: 'cockpit-run: Cockpit is not running\n' })
  })

  it("prints Cockpit's answer and fails when the run is refused, and shows usage", async () => {
    const env = { COCKPIT_SOCKET: runServer.path }
    expect(await runScript(['submit'], env, '{"bad":1}')).toMatchObject({
      code: 1,
      stdout: 'no good\n'
    })
    expect(await runScript(['submit', path.join(dir, 'missing.json')], env)).toMatchObject({
      code: 1
    })
    expect((await runScript(['done', 'r1'], env)).code).toBe(2)
    expect((await runScript([], env)).code).toBe(2)
  })

  it('refuses a body over the limit, and leaves the event routes to the event handler', async () => {
    const big = await new Promise<number>((resolve, reject) => {
      const req = http.request(
        { socketPath: runServer.path, path: '/v1/runs', method: 'POST' },
        (res) => {
          res.resume()
          resolve(res.statusCode ?? 0)
        }
      )
      req.on('error', reject)
      req.end(Buffer.alloc(MAX_RUN_BYTES + 1, 'a'))
    })
    expect(big).toBe(413)
    expect(requests).toEqual([])
  })
})
