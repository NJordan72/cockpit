import os from 'node:os'
import * as pty from 'node-pty'
import type { WebContents } from 'electron'
import { IPC, type PtyCreateOptions } from '@shared/ipc'

interface Session {
  proc: pty.IPty
  owner: WebContents
}

/** Owns every PTY. Each PTY is tied to the WebContents that created it. */
export class PtyManager {
  private sessions = new Map<string, Session>()

  create(owner: WebContents, opts: PtyCreateOptions): { pid: number } {
    this.kill(opts.id)

    const shell = process.env.SHELL ?? '/bin/zsh'
    // -l gives the user's full login environment (PATH from mise, etc.).
    // A preset command runs through the same login shell so it sees that PATH.
    const args = opts.command ? ['-l', '-c', opts.command] : ['-l']
    const env: Record<string, string> = {}
    for (const [k, v] of Object.entries(process.env)) if (v !== undefined) env[k] = v
    env.TERM = 'xterm-256color'
    env.COLORTERM = 'truecolor'
    env.TERM_PROGRAM = 'Cockpit'
    env.LANG = process.env.LANG ?? 'en_US.UTF-8'
    // Electron sets these for its own process; children shouldn't inherit them.
    delete env.ELECTRON_RUN_AS_NODE
    delete env.ELECTRON_NO_ATTACH_CONSOLE

    const proc = pty.spawn(shell, args, {
      name: 'xterm-256color',
      cols: Math.max(opts.cols, 2),
      rows: Math.max(opts.rows, 1),
      cwd: opts.cwd ?? os.homedir(),
      env
    })

    const session: Session = { proc, owner }
    this.sessions.set(opts.id, session)

    proc.onData((data) => {
      if (!owner.isDestroyed()) owner.send(IPC.ptyData, opts.id, data)
    })
    proc.onExit(({ exitCode, signal }) => {
      // Only report if this PTY is still the one registered under the id.
      if (this.sessions.get(opts.id) !== session) return
      this.sessions.delete(opts.id)
      if (!owner.isDestroyed()) owner.send(IPC.ptyExit, opts.id, { exitCode, signal })
    })

    return { pid: proc.pid }
  }

  write(id: string, data: string): void {
    this.sessions.get(id)?.proc.write(data)
  }

  resize(id: string, cols: number, rows: number): void {
    const s = this.sessions.get(id)
    if (!s || cols < 2 || rows < 1) return
    try {
      s.proc.resize(cols, rows)
    } catch {
      // The process may have exited between the check and the call.
    }
  }

  kill(id: string): void {
    const s = this.sessions.get(id)
    if (!s) return
    this.sessions.delete(id)
    try {
      s.proc.kill()
    } catch {
      // already gone
    }
  }

  killAllFor(owner: WebContents): void {
    for (const [id, s] of this.sessions) if (s.owner === owner) this.kill(id)
  }

  killAll(): void {
    for (const id of [...this.sessions.keys()]) this.kill(id)
  }
}
