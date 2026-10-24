// Tells main how much of a PTY's output the terminal is done with, so main
// can pause a PTY whose terminal falls behind (see PtyOutput). Output counts
// as done once xterm has parsed it. While the window is hidden, Chromium
// throttles the page's timers and xterm parses slowly; pausing then would
// stall an agent behind another window, so hidden output counts as done when
// it arrives, as everything did before there were acknowledgements.
import { PTY_ACK_CHARS } from '@shared/ipc'

export class OutputAcks {
  /** Received and not yet acknowledged, parsed or not. */
  private pending = 0
  /** Of those, the ones that are done, waiting to make up a full step. */
  private done = 0
  /** Bumped when everything pending is let go at once, so parse callbacks from before don't count twice. */
  private epoch = 0

  constructor(private readonly send: (chars: number) => void) {}

  /**
   * Output arrived. Returns the callback to run once it's parsed, or null when
   * it already counts as done.
   */
  received(chars: number, hidden: boolean): (() => void) | null {
    this.pending += chars
    if (hidden) {
      this.finish(chars)
      return null
    }
    const epoch = this.epoch
    return () => {
      if (epoch === this.epoch) this.finish(chars)
    }
  }

  /** The window was hidden: whatever is still being parsed counts as done. */
  releaseAll(): void {
    if (this.pending > 0) this.send(this.pending)
    this.pending = 0
    this.done = 0
    this.epoch++
  }

  private finish(chars: number): void {
    this.done += chars
    if (this.done < PTY_ACK_CHARS) return
    this.send(this.done)
    this.pending -= this.done
    this.done = 0
  }
}
