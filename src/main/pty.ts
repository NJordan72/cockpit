import * as pty from 'node-pty'
import type { WebContents } from 'electron'
import { IPC } from '@shared/ipc'
import { paneEnv } from './ptyEnv'
import { PtyOutput } from './ptyOutput'

export interface SpawnOptions {
  id: string
  cols: number
  rows: number
  /** Command to run inside the login shell. Omit for an interactive shell. */
  command?: string
  /** Absolute, existing directory. */
  cwd: string
  /** Set on top of the inherited environment. */
  env?: Record<string, string>
}

/** Told about everything that passes through a PTY, for status tracking. */
export interface PtyObserver {
  output(id: string, data: string): void
  input(id: string, data: string): void
  resized(id: string): void
  /** The process ended on its own. */
  exited(id: string): void
  /** Cockpit killed the process (pane closed, restarted, or the app quitting). */
  killed(id: string): void
}

interface Session {
  proc: pty.IPty
  owner: WebContents
  output: PtyOutput
}

/** Owns every PTY. Each PTY is tied to the WebContents that created it. */
export class PtyManager {
  private sessions = new Map<string, Session>()

  constructor(private readonly observer: PtyObserver) {}

  /** Starts a PTY under `id`, replacing any running one without reporting it as killed. */
  create(owner: WebContents, opts: SpawnOptions): { pid: number } {
    this.stop(opts.id)

    const shell = process.env.SHELL ?? '/bin/zsh'
    // -l gives the user's full login environment (PATH from mise, etc.).
    // A preset command runs through the same login shell so it sees that PATH.
    const args = opts.command ? ['-l', '-c', opts.command] : ['-l']
    const env = paneEnv(process.env)
    env.TERM = 'xterm-256color'
    env.COLORTERM = 'truecolor'
    env.TERM_PROGRAM = 'Cockpit'
    env.LANG = process.env.LANG ?? 'en_US.UTF-8'
    Object.assign(env, opts.env)

    const proc = pty.spawn(shell, args, {
      name: 'xterm-256color',
      cols: Math.max(opts.cols, 2),
      rows: Math.max(opts.rows, 1),
      cwd: opts.cwd,
      env
    })

    const output = new PtyOutput({
      send: (data) => {
        if (!owner.isDestroyed()) owner.send(IPC.ptyData, opts.id, data)
      },
      pause: () => proc.pause(),
      resume: () => proc.resume()
    })
    const session: Session = { proc, owner, output }
    this.sessions.set(opts.id, session)

    proc.onData((data) => {
      if (this.sessions.get(opts.id) !== session) return
      this.observer.output(opts.id, data)
      output.push(data)
    })
    proc.onExit(({ exitCode, signal }) => {
      // Only report if this PTY is still the one registered under the id.
      if (this.sessions.get(opts.id) !== session) return
      this.sessions.delete(opts.id)
      // The last of the output goes before the exit notice.
      output.flush()
      output.dispose()
      this.observer.exited(opts.id)
      if (!owner.isDestroyed()) owner.send(IPC.ptyExit, opts.id, { exitCode, signal })
    })

    return { pid: proc.pid }
  }

  pid(id: string): number | null {
    return this.sessions.get(id)?.proc.pid ?? null
  }

  /** Live PTY ids and their process ids. */
  pids(): Map<string, number> {
    return new Map([...this.sessions].map(([id, s]) => [id, s.proc.pid]))
  }

  write(id: string, data: string): void {
    const s = this.sessions.get(id)
    if (!s) return
    this.observer.input(id, data)
    s.proc.write(data)
  }

  /** The pane's terminal has parsed `chars` more characters of output. */
  ack(id: string, chars: number): void {
    this.sessions.get(id)?.output.ack(chars)
  }

  resize(id: string, cols: number, rows: number): void {
    const s = this.sessions.get(id)
    if (!s || cols < 2 || rows < 1) return
    try {
      if (cols !== s.proc.cols || rows !== s.proc.rows) this.observer.resized(id)
      s.proc.resize(cols, rows)
    } catch {
      // The process may have exited between the check and the call.
    }
  }

  kill(id: string): void {
    if (this.stop(id)) this.observer.killed(id)
  }

  private stop(id: string): boolean {
    const s = this.sessions.get(id)
    if (!s) return false
    this.sessions.delete(id)
    s.output.dispose()
    try {
      s.proc.kill()
    } catch {
      // already gone
    }
    return true
  }

  killAllFor(owner: WebContents): void {
    for (const [id, s] of this.sessions) if (s.owner === owner) this.kill(id)
  }

  killAll(): void {
    for (const id of [...this.sessions.keys()]) this.kill(id)
  }
}
