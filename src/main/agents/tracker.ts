// Each pane's status. Agents that report through hooks drive it directly;
// everything else gets an output heuristic: a pane that keeps printing is
// working, and one that goes quiet again is idle.
import type { AgentKind, SessionStatus } from '@shared/widgets'
import type { AgentReport, ToolCall } from './events'

export interface PaneStatus {
  status: SessionStatus
  /** When status last changed (ms since the epoch). */
  since: number
  agent: AgentKind | null
  /** What the agent is waiting for, while needs-input. */
  message: string | null
  title: string | null
  tokens: number | null
  /** The last thing the agent said it finished with; not shared with widgets. */
  doneMessage: string | null
}

export interface TrackerTimings {
  /** Output this soon after input or a resize is an echo or a redraw, not work. */
  echoMs: number
  /** Without hooks, output has to keep coming this long to count as work... */
  streakMs: number
  /** ...with no gap longer than this. */
  gapMs: number
  /** Without hooks, this much quiet after work means idle. */
  quietMs: number
  /**
   * With hooks, a turn the user interrupts sends no event. Agents animate a
   * spinner for as long as a turn runs, so this much quiet ends it.
   */
  hookedQuietMs: number
}

export const DEFAULT_TIMINGS: TrackerTimings = {
  echoMs: 250,
  streakMs: 1000,
  gapMs: 750,
  quietMs: 2500,
  hookedQuietMs: 10_000
}

interface Pane {
  id: string
  token: string
  state: PaneStatus
  /** The agent has reported at least once; output stops driving the status then. */
  hooked: boolean
  /** Requests the agent is blocked on: each one's scope, by key (see AgentSignal). */
  pending: Map<string, string | null>
  /** Tool calls that started this turn and haven't finished: each one's scope, by id. */
  running: Map<string, string>
  /** The user answered a dialog since the agent last asked for something. */
  answered: boolean
  lastInput: number
  lastOutput: number
  streakStart: number
  quiet: NodeJS.Timeout | null
}

export function agentName(agent: AgentKind | null): string {
  return agent === 'codex' ? 'Codex' : agent === 'claude' ? 'Claude' : 'The program'
}

export type StatusListener = (paneId: string, prev: PaneStatus | null, next: PaneStatus) => void

/** Terminal focus reports (CSI I / CSI O) are written to the PTY but aren't typing. */
const isFocusReport = (data: string): boolean =>
  data.length > 0 && data.replaceAll('\x1b[I', '').replaceAll('\x1b[O', '') === ''
/**
 * Keys that close an agent's dialog either way: Enter, a bare Esc, or a
 * number on its own, which picks that option in Claude Code's dialogs.
 */
const ANSWERS_DIALOG = (data: string): boolean =>
  data.includes('\r') || data === '\x1b' || /^[1-9]$/.test(data)

export class StatusTracker {
  private panes = new Map<string, Pane>()
  private byToken = new Map<string, Pane>()

  constructor(
    private readonly onChange: StatusListener,
    private readonly t: TrackerTimings = DEFAULT_TIMINGS
  ) {}

  get(paneId: string): PaneStatus | null {
    return this.panes.get(paneId)?.state ?? null
  }

  /** A pane's process started (again). `token` is its COCKPIT_SESSION_ID. */
  spawn(paneId: string, token: string, agent: AgentKind | null): void {
    const old = this.panes.get(paneId)
    if (old) this.drop(old)
    const pane: Pane = {
      id: paneId,
      token,
      state: {
        status: 'idle',
        since: Date.now(),
        agent,
        message: null,
        title: null,
        tokens: null,
        doneMessage: null
      },
      hooked: false,
      pending: new Map(),
      running: new Map(),
      answered: false,
      lastInput: 0,
      lastOutput: 0,
      streakStart: 0,
      quiet: null
    }
    this.panes.set(paneId, pane)
    this.byToken.set(token, pane)
    this.onChange(paneId, old?.state ?? null, pane.state)
  }

  exit(paneId: string): void {
    const pane = this.panes.get(paneId)
    if (!pane) return
    this.byToken.delete(pane.token)
    this.set(pane, 'exited')
  }

  /** The pane is gone; forget it without reporting a change. */
  remove(paneId: string): void {
    const pane = this.panes.get(paneId)
    if (pane) this.drop(pane)
  }

  input(paneId: string, data: string): void {
    const pane = this.panes.get(paneId)
    if (!pane || pane.state.status === 'exited') return
    pane.lastInput = Date.now()
    if (isFocusReport(data)) return
    const { status } = pane.state
    if (status === 'done') {
      this.set(pane, 'idle')
    } else if (status === 'needs-input' && ANSWERS_DIALOG(data)) {
      // The user answered. If they allowed it, the agent carries on and its
      // next event confirms; if they refused, it goes quiet and times out.
      pane.pending.clear()
      pane.answered = true
      this.set(pane, 'working')
    }
  }

  /** A resize makes full-screen programs redraw; that isn't work either. */
  resized(paneId: string): void {
    const pane = this.panes.get(paneId)
    if (pane) pane.lastInput = Date.now()
  }

  output(paneId: string): void {
    const pane = this.panes.get(paneId)
    if (!pane || pane.state.status === 'exited') return
    const { status } = pane.state
    // With hooks, output only keeps a turn alive, and any output will do:
    // typing ahead during a long tool call mustn't let the turn time out.
    if (pane.hooked) {
      if (status === 'working') pane.quiet?.refresh()
      return
    }
    const now = Date.now()
    if (now - pane.lastInput < this.t.echoMs) return
    if (now - pane.lastOutput > this.t.gapMs) pane.streakStart = now
    pane.lastOutput = now
    if (status === 'working') pane.quiet?.refresh()
    else if (now - pane.streakStart >= this.t.streakMs) this.set(pane, 'working')
  }

  /** The user looked at the pane, so a finished turn has been seen. */
  seen(paneId: string): void {
    const pane = this.panes.get(paneId)
    if (pane?.state.status === 'done') this.set(pane, 'idle')
  }

  /** A hook reported. Returns false if the token belongs to no live pane. */
  report(token: string, report: AgentReport): boolean {
    const pane = this.byToken.get(token)
    if (!pane) return false
    this.apply(pane, report)
    return true
  }

  /** The agent reported through the pane's own output (Codex). */
  reportPane(paneId: string, report: AgentReport): void {
    const pane = this.panes.get(paneId)
    if (pane && pane.state.status !== 'exited') this.apply(pane, report)
  }

  private apply(pane: Pane, report: AgentReport): void {
    pane.hooked = true
    const extra: Partial<PaneStatus> = {}
    if (report.title) extra.title = report.title
    const { signal } = report
    switch (signal.kind) {
      case 'idle':
        this.endTurn(pane)
        if (signal.keepDone && pane.state.status === 'done') this.update(pane, extra)
        else this.set(pane, 'idle', extra)
        break
      case 'working':
        if (signal.clears) this.endTurn(pane)
        if (signal.starts) pane.running.set(signal.starts.id, signal.starts.scope)
        if (signal.resolves) pane.pending.delete(signal.resolves)
        if (signal.ends) this.ended(pane, signal.ends)
        // Another tool finishing doesn't close a dialog that is still open.
        if (pane.pending.size === 0) this.set(pane, 'working', extra)
        else this.update(pane, extra)
        break
      case 'waiting': {
        if (signal.starts) pane.running.set(signal.starts.id, signal.starts.scope)
        // A reminder that arrives after the user answered is about that
        // answered request, not a new one.
        if (signal.reminder && pane.answered) {
          this.update(pane, extra)
          break
        }
        if (!signal.reminder) pane.answered = false
        if (signal.key) pane.pending.set(signal.key, signal.scope ?? null)
        const shown = pane.state.status === 'needs-input' ? pane.state.message : null
        const message =
          (signal.reminder ? shown : null) ??
          signal.message ??
          shown ??
          `${agentName(pane.state.agent)} is waiting for you`
        this.set(pane, 'needs-input', { ...extra, message })
        break
      }
      case 'done':
        this.endTurn(pane)
        this.set(pane, 'done', { ...extra, doneMessage: signal.message })
        break
      case 'none':
        this.update(pane, extra)
        break
    }
  }

  /**
   * A tool call finished. Its input can differ from what the dialog was shown
   * (AskUserQuestion's answers are added to it), so its key may not match the
   * request. Once no call in its scope is still running, though, nothing in
   * that scope can still be asking.
   */
  private ended(pane: Pane, call: ToolCall): void {
    pane.running.delete(call.id)
    for (const scope of pane.running.values()) if (scope === call.scope) return
    for (const [key, scope] of pane.pending) if (scope === call.scope) pane.pending.delete(key)
  }

  /**
   * No dialog is open at a turn's edge. A call the user refused never
   * finishes, so forget running calls too.
   */
  private endTurn(pane: Pane): void {
    pane.pending.clear()
    pane.running.clear()
  }

  /** Title and token counts read from the agent's transcript. */
  annotate(paneId: string, info: { title?: string | null; tokens?: number | null }): void {
    const pane = this.panes.get(paneId)
    if (!pane) return
    const extra: Partial<PaneStatus> = {}
    if (info.title) extra.title = info.title
    if (info.tokens !== undefined && info.tokens !== null) extra.tokens = info.tokens
    this.update(pane, extra)
  }

  /** The pane a token belongs to. */
  paneFor(token: string): string | null {
    return this.byToken.get(token)?.id ?? null
  }

  close(): void {
    for (const pane of this.panes.values()) this.drop(pane)
  }

  private drop(pane: Pane): void {
    if (pane.quiet) clearTimeout(pane.quiet)
    this.panes.delete(pane.id)
    if (this.byToken.get(pane.token) === pane) this.byToken.delete(pane.token)
  }

  private set(pane: Pane, status: SessionStatus, extra: Partial<PaneStatus> = {}): void {
    if (pane.quiet) clearTimeout(pane.quiet)
    pane.quiet = null
    if (status === 'working') {
      const ms = pane.hooked ? this.t.hookedQuietMs : this.t.quietMs
      pane.quiet = setTimeout(() => {
        pane.quiet = null
        if (pane.state.status === 'working') this.set(pane, 'idle')
      }, ms)
    }
    const prev = pane.state
    const next: PaneStatus = {
      ...prev,
      ...extra,
      status,
      since: status === prev.status ? prev.since : Date.now(),
      message: status === 'needs-input' ? (extra.message ?? prev.message) : null
    }
    if (status !== 'done') next.doneMessage = status === prev.status ? prev.doneMessage : null
    this.commit(pane, next)
  }

  private update(pane: Pane, extra: Partial<PaneStatus>): void {
    if (Object.keys(extra).length > 0) this.commit(pane, { ...pane.state, ...extra })
  }

  private commit(pane: Pane, next: PaneStatus): void {
    const prev = pane.state
    const changed = (Object.keys(next) as (keyof PaneStatus)[]).some((k) => next[k] !== prev[k])
    if (!changed) return
    pane.state = next
    this.onChange(pane.id, prev, next)
  }
}
