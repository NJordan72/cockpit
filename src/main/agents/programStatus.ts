// Agents that report their state through the terminal with OSC 7501 Program
// Status reports. Antigravity CLI (agy) does so in every pane, since Cockpit
// sets AGY_CLI_OSC7501=on (see AGY_ENV); agy reads hooks only from files
// Cockpit doesn't edit, so these reports are all Cockpit hears from it.
// Codex reports in any terminal (see codex.ts). Claude Code reports too, but
// only to a terminal that answers its probe. Cockpit answers in remote panes,
// where the reports cross ssh and its hooks may not (see remote.ts).
import type { AgentKind } from '@shared/widgets'
import type { AgentReport, AgentSignal } from './events'
import {
  OscScanner,
  parseProgramStatus,
  PROGRAM_STATUS_OSC,
  type BlockedKind,
  type ProgramStatus
} from './osc'
import { agentName } from './tracker'

/**
 * The reply to a program's feature query (`OSC 7501 ; ?`). Without `states`
 * and `kinds`, it means every state and kind the spec has.
 */
export const PROGRAM_STATUS_REPLY = `\x1b]${PROGRAM_STATUS_OSC.toString()};?\x1b\\`

/** Said for a blocked report that carries no message of its own. */
function blockedMessage(agent: AgentKind, ask: BlockedKind | null): string {
  const name = agentName(agent)
  if (ask === 'question') return `${name} has a question`
  if (ask === 'auth') return `${name} needs you to sign in`
  if (ask === 'permission') return `${name} needs permission`
  return `${name} is waiting for you`
}

/** A report, turned into the signal it means. `last` is the state the agent reported before it. */
export function programSignal(
  agent: AgentKind,
  report: ProgramStatus,
  last: ProgramStatus | null
): AgentSignal {
  switch (report.state) {
    case 'idle':
    case 'clear':
      // Back at its prompt; a finished turn still hasn't been seen.
      return { kind: 'idle', keepDone: true }
    case 'working':
      // Carrying on after a request is part of the same turn.
      return { kind: 'working', clears: last?.state !== 'blocked' }
    case 'blocked': {
      // The spec gives no default kind: a bare report could be any request.
      const message = report.msg ?? blockedMessage(agent, report.kind)
      return report.kind
        ? { kind: 'waiting', key: null, ask: report.kind, message }
        : { kind: 'waiting', key: null, message }
    }
    case 'done':
      return { kind: 'done', message: report.msg }
    case 'error':
      return { kind: 'done', failed: true, message: report.msg ?? 'The turn ended with an error' }
  }
}

const same = (a: ProgramStatus, b: ProgramStatus | null): boolean =>
  b !== null && a.state === b.state && a.kind === b.kind && a.msg === b.msg

/**
 * Reads the reports about a program's own state out of its pane's output,
 * leaving out repeats.
 * `reply` writes to the pane's input, as the terminal would, to answer the
 * program's probe.
 */
export class ProgramStatusReader {
  private scanner = new OscScanner()
  private last: ProgramStatus | null = null

  constructor(private readonly reply: (data: string) => void = () => undefined) {}

  feed(chunk: string): ProgramStatus[] {
    const changes: ProgramStatus[] = []
    for (const osc of this.scanner.feed(chunk)) {
      if (osc.code !== PROGRAM_STATUS_OSC) continue
      if (osc.text.trimStart().startsWith('?')) {
        this.reply(PROGRAM_STATUS_REPLY)
        continue
      }
      const report = parseProgramStatus(osc.text)
      // Records with an id are parts of the program's work; the root record is its state.
      if (report?.id !== null) continue
      // Progress updates and repeats (Ctrl+C at the prompt says idle again) aren't news.
      if (same(report, this.last)) continue
      changes.push(report)
      this.last = report
    }
    return changes
  }
}

/** One pane's terminal output, turned into reports. */
export class ProgramStatusWatcher {
  private reader: ProgramStatusReader
  /** The last report passed on; a skipped one doesn't count. */
  private last: ProgramStatus | null = null

  constructor(
    private readonly agent: AgentKind,
    reply?: (data: string) => void
  ) {
    this.reader = new ProgramStatusReader(reply)
  }

  feed(chunk: string): AgentReport[] {
    const reports: AgentReport[] = []
    for (const report of this.reader.feed(chunk)) {
      // agy says it needs a sign-in for a moment at startup, before it has
      // loaded the saved one. A pane that truly needs one shows the sign-in
      // screen to the user who just opened it.
      if (this.last === null && report.state === 'blocked' && report.kind === 'auth') continue
      reports.push({
        signal: programSignal(this.agent, report, this.last),
        transcriptPath: null,
        title: null
      })
      this.last = report
    }
    return reports
  }
}
