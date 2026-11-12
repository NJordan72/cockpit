// Agents that report their state through the terminal with OSC 7501 Program
// Status reports. Antigravity CLI (agy) does so in every pane, since Cockpit
// sets AGY_CLI_OSC7501=on (see AGY_ENV); agy reads hooks only from files
// Cockpit doesn't edit, so these reports are all Cockpit hears from it.
// Claude Code reports too, but only to a terminal that answers its probe.
// Cockpit answers in remote panes, where the reports cross ssh and its hooks
// may not (see remote.ts).
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
function blockedMessage(agent: AgentKind, ask: BlockedKind): string {
  const name = agentName(agent)
  if (ask === 'question') return `${name} has a question`
  if (ask === 'auth') return `${name} needs you to sign in`
  return `${name} needs permission`
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
      const ask = report.kind ?? 'permission'
      return { kind: 'waiting', key: null, ask, message: report.msg ?? blockedMessage(agent, ask) }
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
 * One pane's terminal output, turned into reports. `reply` writes to the
 * pane's input, as the terminal would, to answer the agent's probe.
 */
export class ProgramStatusWatcher {
  private scanner = new OscScanner()
  private last: ProgramStatus | null = null

  constructor(
    private readonly agent: AgentKind,
    private readonly reply: (data: string) => void = () => undefined
  ) {}

  feed(chunk: string): AgentReport[] {
    const reports: AgentReport[] = []
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
