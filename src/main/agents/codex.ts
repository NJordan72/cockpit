// Codex reports its state through the terminal (see CODEX_SETTINGS): OSC 0
// titles carry its run state, and OSC 9 notifications say when a turn is
// complete or it wants approval. This reads both out of the PTY stream.
import type { AgentReport, AgentSignal } from './events'
import { OscScanner } from './osc'

export type CodexTitleState = 'working' | 'waiting' | 'ready'

/** The run state in a title built from ["activity", "run-state"]. */
export function codexTitleState(title: string): CodexTitleState | null {
  if (title.includes('Action Required')) return 'waiting'
  if (/\b(Working|Thinking|Waiting)\b/.test(title)) return 'working'
  if (/\b(Ready|Starting)\b/.test(title)) return 'ready'
  return null
}

const WAITING_NOTIFICATION = /^(Approval requested|Codex wants to edit|Plan mode prompt:|Question:)/

/** An OSC 9 notification: either a request for the user, or the end of a turn. */
export function parseCodexNotification(text: string): AgentSignal {
  if (WAITING_NOTIFICATION.test(text)) return { kind: 'waiting', key: null, message: text }
  return { kind: 'done', message: text === 'Agent turn complete' ? null : text }
}

/** One Codex pane's terminal output, turned into reports. */
export class CodexWatcher {
  private scanner = new OscScanner()
  private titleState: CodexTitleState | null = null

  feed(chunk: string): AgentReport[] {
    const reports: AgentReport[] = []
    const add = (signal: AgentSignal): void => {
      reports.push({ signal, transcriptPath: null, title: null })
    }
    for (const osc of this.scanner.feed(chunk)) {
      if (osc.code === 9) {
        // OSC 9 with a numeric first field is ConEmu's progress report, not a notification.
        if (!/^\d+;/.test(osc.text)) add(parseCodexNotification(osc.text))
      } else if (osc.code === 0 || osc.code === 2) {
        // The title is redrawn with every spinner frame; only a change of state counts.
        // A notification can arrive before the title catches up, so a stale
        // frame of the old state mustn't undo it.
        const state = codexTitleState(osc.text)
        if (!state || state === this.titleState) continue
        this.titleState = state
        if (state === 'working') add({ kind: 'working', clears: true })
        // The approval's own text comes in the OSC 9 notification.
        else if (state === 'waiting') add({ kind: 'waiting', key: null, message: null })
        else add({ kind: 'idle', keepDone: true })
      }
    }
    return reports
  }
}
