import * as pty from 'node-pty'
import type { WebContents } from 'electron'
import { IPC } from '@shared/ipc'

export interface SpawnOptions {
  id: string
  cols: number
  rows: number
  /** Command to run inside the login shell. Omit for an interactive shell. */
  command?: string
  /** Absolute, existing directory. */
  cwd: string
}

/**
 * Variables that describe where Cockpit itself was launched from: the parent
 * terminal (tmux, iTerm, ...) when started with `bun run dev`, a Claude Code
 * session it was started from, and Electron's own. Passing them on makes
 * programs think they run inside that parent. Claude Code warns about tmux
 * focus events when it sees TMUX, and turns off transcript saving when it
 * sees it's a child of another Claude Code session. User settings such as API
 * keys or CLAUDE_CODE_USE_BEDROCK are left alone.
 */
const INHERITED_TERMINAL_VARS = new RegExp(
  '^(' +
    [
      'TMUX',
      'TMUX_PANE',
      'STY',
      'TERM_SESSION_ID',
      'TERM_PROGRAM_VERSION',
      'LC_TERMINAL',
      'LC_TERMINAL_VERSION',
      'ITERM_.*',
      'KITTY_.*',
      'GHOSTTY_.*',
      'WEZTERM_.*',
      'ALACRITTY_.*',
      'VSCODE_.*',
      'WT_SESSION',
      'ELECTRON_.*',
      'CLAUDECODE',
      'CLAUDE_PID',
      'CLAUDE_CODE_ENTRYPOINT',
      'CLAUDE_CODE_EXECPATH',
      'CLAUDE_CODE_CHILD_SESSION',
      'CLAUDE_CODE_SESSION_.*',
      'CLAUDE_CODE_MESSAGING_.*'
    ].join('|') +
    ')$'
)

interface Session {
  proc: pty.IPty
  owner: WebContents
}

/** Owns every PTY. Each PTY is tied to the WebContents that created it. */
export class PtyManager {
  private sessions = new Map<string, Session>()

  /** onExit runs after a PTY's process ends on its own (not when killed). */
  constructor(private readonly onExit: (id: string) => void = () => undefined) {}

  create(owner: WebContents, opts: SpawnOptions): { pid: number } {
    this.kill(opts.id)

    const shell = process.env.SHELL ?? '/bin/zsh'
    // -l gives the user's full login environment (PATH from mise, etc.).
    // A preset command runs through the same login shell so it sees that PATH.
    const args = opts.command ? ['-l', '-c', opts.command] : ['-l']
    const env: Record<string, string> = {}
    for (const [k, v] of Object.entries(process.env)) {
      if (v !== undefined && !INHERITED_TERMINAL_VARS.test(k)) env[k] = v
    }
    env.TERM = 'xterm-256color'
    env.COLORTERM = 'truecolor'
    env.TERM_PROGRAM = 'Cockpit'
    env.LANG = process.env.LANG ?? 'en_US.UTF-8'

    const proc = pty.spawn(shell, args, {
      name: 'xterm-256color',
      cols: Math.max(opts.cols, 2),
      rows: Math.max(opts.rows, 1),
      cwd: opts.cwd,
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
      this.onExit(opts.id)
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
