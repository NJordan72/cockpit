// Codex reports its state with OSC 7501 Program Status reports (see
// programStatus.ts) in any terminal, without a probe or a flag. As of 0.163.0
// it sends idle, working, blocked, and clear (on exit), and never done: a
// finished turn goes from working straight back to idle, as does one the
// user stops. Its blocked reports carry no kind and no message, so an
// approval looks the same as a question.
//
// Codex also reports a few seconds of working right after it starts, while it
// loads, before anything was asked. So a stretch of work is a turn only when
// a prompt went in since Codex was last idle: typed and sent with Enter, or
// given on the command line. Going idle after a turn means it ended.
import type { AgentReport, AgentSignal } from './events'
import { programSignal, ProgramStatusReader } from './programStatus'

/** What Cockpit's terminal sends for Shift+Enter, which starts a new line in Codex's prompt. */
const NEWLINE = '\x1b\r'
// eslint-disable-next-line no-control-regex
const PASTE = /\x1b\[200~[\s\S]*?(\x1b\[201~|$)/g

/** Whether typing this sends Codex's prompt: an Enter, not Shift+Enter or a line break in a paste. */
export function sendsPrompt(data: string): boolean {
  return data.replace(PASTE, '').replaceAll(NEWLINE, '').includes('\r')
}

/** One Codex pane's terminal output, turned into reports. */
export class CodexWatcher {
  private reader: ProgramStatusReader
  /** The user sent a prompt since Codex was last idle. */
  private sent = false
  /** The command line gave Codex its first prompt, and that turn hasn't started. */
  private queued: boolean
  /** Codex is on a turn: working on a prompt, or asking for something. */
  private turn = false
  /** Codex is working on something that isn't a turn, like loading at startup. */
  private loading = false

  /** `prompted`: the command line gives Codex its first prompt. */
  constructor(prompted = false, reply?: (data: string) => void) {
    this.queued = prompted
    this.reader = new ProgramStatusReader(reply)
  }

  /** What the user typed into the pane. */
  input(data: string): void {
    if (sendsPrompt(data)) this.sent = true
  }

  feed(chunk: string): AgentReport[] {
    const reports: AgentReport[] = []
    const add = (signal: AgentSignal): void => {
      reports.push({ signal, transcriptPath: null, title: null })
    }
    for (const report of this.reader.feed(chunk)) {
      const wasTurn = this.turn
      switch (report.state) {
        case 'working':
          if (!wasTurn && !this.sent && !this.queued) {
            this.loading = true
            continue
          }
          this.turn = true
          this.queued = false
          // Carrying on after a request is part of the same turn.
          add({ kind: 'working', clears: !wasTurn })
          break
        case 'blocked':
          // A request reaches the user even outside a turn they started.
          this.turn = true
          add(programSignal('codex', report, null))
          break
        default: {
          // Back at its prompt, or gone. Loading ends quietly, and a prompt
          // sent during it runs next, as a turn of its own.
          const loaded = this.loading && !wasTurn
          this.turn = false
          this.loading = false
          if (!loaded) this.sent = false
          if (report.state === 'done' || report.state === 'error') {
            add(programSignal('codex', report, null))
          } else if (wasTurn && report.state === 'idle') {
            add({ kind: 'done', message: null })
          } else if (!loaded) {
            add({ kind: 'idle', keepDone: true })
          }
        }
      }
    }
    return reports
  }
}
