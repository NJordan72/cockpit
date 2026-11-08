// The local event server that agent hooks report to. It's HTTP over a Unix
// socket, so the hook script can be a one-line curl call. Only processes
// running as this user can reach the socket, and an event counts only when
// it names a session token that Cockpit handed to a live PTY. cockpit-run
// uses the same socket under /v1/runs, and needs no token, since a run it
// submits starts nothing until the user confirms it in Cockpit.
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import type { AgentKind } from '@shared/widgets'

/** Hook payloads can carry whole files (a Write's content); past this, only the event name counts. */
export const MAX_EVENT_BYTES = 4 * 1024 * 1024
/** sun_path is 104 bytes on macOS, including the terminating NUL. */
const MAX_SOCKET_PATH = 103
const SOCKET_RE = /^cockpit-(\d+)\.sock$/

export interface IncomingEvent {
  agent: AgentKind
  /** Hook event name from the URL (Claude Code); null for Codex's notify. */
  event: string | null
  /** COCKPIT_SESSION_ID of the PTY the hook ran in. */
  token: string
  /** The parsed JSON body, or null when it was missing, too large, or not JSON. */
  payload: unknown
}

/** Returns false when the token belongs to no live PTY. */
export type EventHandler = (e: IncomingEvent) => boolean

/** The most a request to /v1/runs can carry: a run's graph. */
export const MAX_RUN_BYTES = 1024 * 1024

/** Answers a cockpit-run request with a status and plain text for the terminal. */
export type RunRequestHandler = (req: {
  method: string
  path: string
  body: string
}) => Promise<{ status: number; text: string }>

/**
 * Where the socket goes: <home>/run/cockpit-<pid>.sock, one per Cockpit
 * process so a second instance (a dev build next to the installed app)
 * doesn't take over the first one's socket. A home too long for a socket
 * path falls back to the per-user temp directory.
 */
export function socketPath(home: string, pid = process.pid): string {
  const name = `cockpit-${pid.toString()}.sock`
  const preferred = path.join(home, 'run', name)
  return Buffer.byteLength(preferred) <= MAX_SOCKET_PATH ? preferred : path.join(os.tmpdir(), name)
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (err) {
    // EPERM: it exists but belongs to someone else.
    return (err as NodeJS.ErrnoException).code === 'EPERM'
  }
}

/** Remove sockets left behind by Cockpit processes that are gone. */
function removeStale(dir: string): void {
  let names: string[]
  try {
    names = fs.readdirSync(dir)
  } catch {
    return
  }
  for (const name of names) {
    const pid = Number(SOCKET_RE.exec(name)?.[1])
    if (pid && pid !== process.pid && !alive(pid)) fs.rmSync(path.join(dir, name), { force: true })
  }
}

const EVENT_PATH = /^\/v1\/events\/(claude|codex)(?:\/([A-Za-z]{1,64}))?$/

export class EventServer {
  private server: http.Server | null = null

  constructor(
    readonly path: string,
    private readonly handler: EventHandler,
    private readonly runs?: RunRequestHandler
  ) {}

  async start(): Promise<void> {
    const dir = path.dirname(this.path)
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 })
    removeStale(dir)
    fs.rmSync(this.path, { force: true })
    const server = http.createServer((req, res) => {
      this.handle(req, res)
    })
    server.requestTimeout = 10_000
    server.headersTimeout = 5_000
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(this.path, () => {
        server.off('error', reject)
        resolve()
      })
    })
    fs.chmodSync(this.path, 0o600)
    this.server = server
  }

  close(): void {
    this.server?.close()
    this.server = null
    fs.rmSync(this.path, { force: true })
  }

  private handle(req: http.IncomingMessage, res: http.ServerResponse): void {
    const reply = (status: number): void => {
      res.writeHead(status, { 'content-length': '0', connection: 'close' }).end()
    }
    if (this.runs && /^\/v1\/runs(?:\/|$)/.test(req.url ?? '')) {
      this.handleRun(req, res, this.runs)
      return
    }
    const match = EVENT_PATH.exec(req.url ?? '')
    const token = req.headers['x-cockpit-session']
    if (req.method !== 'POST' || !match || typeof token !== 'string' || !token) {
      req.resume()
      reply(404)
      return
    }
    const agent = match[1] as AgentKind
    const event = match[2] ?? null
    const chunks: Buffer[] = []
    let size = 0
    req.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size <= MAX_EVENT_BYTES) chunks.push(chunk)
    })
    req.on('end', () => {
      let payload: unknown = null
      if (size > 0 && size <= MAX_EVENT_BYTES) {
        try {
          payload = JSON.parse(Buffer.concat(chunks).toString('utf8'))
        } catch {
          // Not JSON; the event name alone may still say enough.
        }
      }
      // Answer after handling, so hooks that run one after another arrive in order.
      reply(this.handler({ agent, event, token, payload }) ? 204 : 403)
    })
    req.on('error', () => {
      res.destroy()
    })
  }

  private handleRun(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    runs: RunRequestHandler
  ): void {
    const reply = (status: number, text: string): void => {
      res
        .writeHead(status, {
          'content-type': 'text/plain; charset=utf-8',
          'content-length': Buffer.byteLength(text),
          connection: 'close'
        })
        .end(text)
    }
    const chunks: Buffer[] = []
    let size = 0
    req.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size <= MAX_RUN_BYTES) chunks.push(chunk)
    })
    req.on('end', () => {
      if (size > MAX_RUN_BYTES) {
        reply(413, 'cockpit-run: the run is over 1 MB\n')
        return
      }
      const body = Buffer.concat(chunks).toString('utf8')
      runs({ method: req.method ?? 'GET', path: req.url ?? '', body }).then(
        (r) => reply(r.status, r.text),
        (err: unknown) => reply(500, `cockpit-run: ${String(err)}\n`)
      )
    })
    req.on('error', () => {
      res.destroy()
    })
  }
}
