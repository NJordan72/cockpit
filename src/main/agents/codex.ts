// Codex reports its state through the terminal (see CODEX_SETTINGS): OSC 0
// titles carry its run state, and OSC 9 notifications say when a turn is
// complete or it wants approval. This reads both out of the PTY stream.
import type { AgentReport, AgentSignal } from './events'

export interface Osc {
  code: number
  text: string
}

/** Longer than any title or notification Codex sends; past it, a sequence is dropped. */
const MAX_OSC = 8192

/** Finds OSC sequences in terminal output, including ones split across chunks. */
export class OscScanner {
  private partial = ''

  feed(chunk: string): Osc[] {
    // Most output has no escape sequences at all.
    if (!this.partial && !chunk.includes('\x1b')) return []
    const data = this.partial + chunk
    this.partial = ''
    const found: Osc[] = []
    let i = 0
    for (;;) {
      const start = data.indexOf('\x1b]', i)
      if (start === -1) {
        if (data.endsWith('\x1b')) this.partial = '\x1b'
        return found
      }
      // Terminated by BEL or by ST (ESC \). Any other ESC aborts the sequence.
      let end = -1
      let next = -1
      for (let j = start + 2; j < data.length; j++) {
        const c = data.charCodeAt(j)
        if (c === 0x07) {
          end = j
          next = j + 1
          break
        }
        if (c === 0x1b) {
          if (j + 1 === data.length) break
          end = data[j + 1] === '\\' ? j : -2
          next = data[j + 1] === '\\' ? j + 2 : j
          break
        }
      }
      if (next === -1) {
        const rest = data.slice(start)
        if (rest.length <= MAX_OSC) this.partial = rest
        return found
      }
      if (end >= 0) {
        const body = data.slice(start + 2, end)
        const semi = body.indexOf(';')
        const code = Number(semi === -1 ? body : body.slice(0, semi))
        if (Number.isInteger(code))
          found.push({ code, text: semi === -1 ? '' : body.slice(semi + 1) })
      }
      i = next
    }
  }
}

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
