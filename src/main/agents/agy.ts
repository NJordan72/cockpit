// Antigravity CLI (agy) reports its state through the terminal with OSC 7501
// Program Status reports, which Cockpit turns on for its panes with
// AGY_CLI_OSC7501=on (see AGY_ENV). agy reads hooks only from files Cockpit
// doesn't edit, so these reports are all Cockpit hears from it.
import type { AgentReport, AgentSignal } from './events'
import {
  OscScanner,
  parseProgramStatus,
  PROGRAM_STATUS_OSC,
  type BlockedKind,
  type ProgramStatus
} from './osc'

/** Said for a blocked report that carries no message of its own. */
const BLOCKED_MESSAGE: Record<BlockedKind, string> = {
  permission: 'Antigravity needs permission',
  question: 'Antigravity has a question',
  auth: 'Antigravity needs you to sign in'
}

/** A report, turned into the signal it means. `last` is the state agy reported before it. */
export function agySignal(report: ProgramStatus, last: ProgramStatus | null): AgentSignal {
  switch (report.state) {
    case 'idle':
    case 'clear':
      // Back at its prompt; a finished turn still hasn't been seen.
      return { kind: 'idle', keepDone: true }
    case 'working':
      // Carrying on after a request is part of the same turn.
      return { kind: 'working', clears: last?.state !== 'blocked' }
    case 'blocked': {
      const ask = report.kind ?? 'permission'
      return { kind: 'waiting', key: null, ask, message: report.msg ?? BLOCKED_MESSAGE[ask] }
    }
    case 'done':
      return { kind: 'done', message: report.msg }
    case 'error':
      return { kind: 'done', failed: true, message: report.msg ?? 'The turn ended with an error' }
  }
}

const same = (a: ProgramStatus, b: ProgramStatus | null): boolean =>
  b !== null && a.state === b.state && a.kind === b.kind && a.msg === b.msg

/** One agy pane's terminal output, turned into reports. */
export class AgyWatcher {
  private scanner = new OscScanner()
  private last: ProgramStatus | null = null

  feed(chunk: string): AgentReport[] {
    const reports: AgentReport[] = []
    for (const osc of this.scanner.feed(chunk)) {
      if (osc.code !== PROGRAM_STATUS_OSC) continue
      const report = parseProgramStatus(osc.text)
      // Records with an id are parts of the program's work; the root record is its state.
      if (report?.id !== null) continue
      // Progress updates and repeats (Ctrl+C at the prompt says idle again) aren't news.
      if (same(report, this.last)) continue
      // agy says it needs a sign-in for a moment at startup, before it has
      // loaded the saved one. A pane that truly needs one shows the sign-in
      // screen to the user who just opened it.
      if (this.last === null && report.state === 'blocked' && report.kind === 'auth') continue
      reports.push({ signal: agySignal(report, this.last), transcriptPath: null, title: null })
      this.last = report
    }
    return reports
  }
}
