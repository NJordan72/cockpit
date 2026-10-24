// One PTY's output on its way to the chrome. Chunks are joined for a few
// milliseconds so a program that prints in small pieces (a spinner, a TUI
// redraw) costs one IPC message instead of dozens. And the PTY is paused when
// the chrome falls too far behind: xterm queues whatever it hasn't parsed
// yet, so a program printing faster than it can parse would otherwise grow
// the renderer's memory for as long as it kept going.
import { PTY_ACK_CHARS } from '@shared/ipc'

/** How long output is held to be sent with whatever follows it. */
export const BATCH_MS = 5
/** Characters sent and not yet acknowledged before the PTY is paused... */
export const HIGH_WATER = 100_000
/** ...and how few there have to be again before it resumes. */
export const LOW_WATER = 2 * PTY_ACK_CHARS

export interface PtyOutputIo {
  send(data: string): void
  pause(): void
  resume(): void
}

export class PtyOutput {
  private chunks: string[] = []
  private buffered = 0
  private timer: NodeJS.Timeout | null = null
  private unacked = 0
  private paused = false

  constructor(private readonly io: PtyOutputIo) {}

  push(data: string): void {
    this.chunks.push(data)
    this.buffered += data.length
    // A flood is sent at once; holding it would only delay the pause.
    if (this.buffered >= HIGH_WATER) this.flush()
    else this.timer ??= setTimeout(() => this.flush(), BATCH_MS)
  }

  /** Send what's held now. */
  flush(): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    if (this.chunks.length === 0) return
    const data = this.chunks.join('')
    this.chunks = []
    this.buffered = 0
    this.unacked += data.length
    this.io.send(data)
    if (!this.paused && this.unacked > HIGH_WATER) {
      this.paused = true
      this.io.pause()
    }
  }

  /** The chrome is done with `chars` more characters. */
  ack(chars: number): void {
    // A restarted pane's terminal can acknowledge output of the process before.
    this.unacked = Math.max(0, this.unacked - chars)
    if (this.paused && this.unacked < LOW_WATER) {
      this.paused = false
      this.io.resume()
    }
  }

  /** Drop what's held; the PTY is gone. */
  dispose(): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    this.chunks = []
    this.buffered = 0
  }
}
