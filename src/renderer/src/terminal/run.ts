// A command for a new shell pane to run once its shell is up, for "Run in a
// new terminal" in the Activity log. Kept out of the layout, so a relaunch
// can never run it again.
import type { IDisposable } from '@xterm/xterm'

export interface QueuedRun {
  text: string
  /** Fail to start rather than run it outside the pane's directory. */
  strictCwd: boolean
}

/** Commands waiting for their pane's first start, by pane id. */
const queued = new Map<string, QueuedRun>()

export function queueRun(paneId: string, run: QueuedRun): void {
  queued.set(paneId, run)
}

/** The pane's command, once. A restart after that starts a plain shell. */
export function takeRun(paneId: string): QueuedRun | undefined {
  const run = queued.get(paneId)
  queued.delete(paneId)
  return run
}

/** How long a shell that never turns on bracketed paste has to be quiet before the command goes in. */
export const QUIET_MS = 2000

/** The parts of an xterm Terminal this needs. */
export interface ShellTerminal {
  readonly modes: { readonly bracketedPasteMode: boolean }
  onWriteParsed: (cb: () => void) => IDisposable
  paste(data: string): void
}

/**
 * Pastes `command` into the shell once it's reading a line, then presses
 * Enter. zsh, bash 5.1+, and fish turn on bracketed paste when their line
 * editor starts, which is the cue; text sent before that sits in the
 * terminal's input queue and is echoed above the prompt. A shell that never
 * turns it on gets the command once it has printed something and gone quiet.
 */
export function runWhenReady(term: ShellTerminal, command: string, enter: () => void): IDisposable {
  let timer: ReturnType<typeof setTimeout> | undefined
  let sub: IDisposable | undefined
  const stop = (): void => {
    clearTimeout(timer)
    sub?.dispose()
    sub = undefined
  }
  const run = (): void => {
    if (!sub) return
    stop()
    term.paste(command)
    enter()
  }
  sub = term.onWriteParsed(() => {
    clearTimeout(timer)
    if (term.modes.bracketedPasteMode) run()
    else timer = setTimeout(run, QUIET_MS)
  })
  return { dispose: stop }
}
