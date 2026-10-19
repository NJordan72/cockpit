// Ties agent awareness together: the event socket, the files Claude Code's
// hooks use, Codex's terminal reports, each pane's status and activity,
// notifications, and transcript details.
import { randomUUID } from 'node:crypto'
import fs from 'node:fs'
import type { ActivityUpdate } from '@shared/activity'
import type { AgentKind } from '@shared/widgets'
import { claudeHome } from '../paths'
import { ActivityLog } from './activity'
import { CodexWatcher } from './codex'
import { parseClaudeHook, type AgentSignal } from './events'
import { installAgentFiles, type AgentFiles } from './files'
import { agentLaunch, type AgentLaunch } from './launch'
import { Notifier, type NotifierDeps } from './notifier'
import { EventServer, socketPath, type IncomingEvent } from './server'
import { StatusTracker, type PaneStatus } from './tracker'
import { readTranscript } from './transcript'

/** How often a running Claude session's transcript is read for its title and tokens. */
const TRANSCRIPT_EVERY_MS = 10_000

/**
 * COCKPIT_AGENT_LOG=<file> appends one line per agent report: the pane, the
 * event, and what it did to the status. Payloads aren't logged.
 */
function logReport(paneId: string | null, source: string, signal: AgentSignal): void {
  const file = process.env.COCKPIT_AGENT_LOG
  if (!file) return
  // Messages can quote the conversation or a command; leave them out.
  const fields = Object.entries(signal).filter(([k]) => k !== 'message')
  const line = JSON.stringify({
    t: new Date().toISOString(),
    pane: paneId,
    source,
    ...Object.fromEntries(fields)
  })
  fs.appendFile(file, line + '\n', { mode: 0o600 }, () => undefined)
}

export interface AgentMonitorOptions extends Omit<NotifierDeps, 'status'> {
  home: string
  /** A pane's status, title, or token count changed. */
  onChange: (paneId: string) => void
  /** A pane's activity log, files, or subagents changed. */
  onActivity: (update: ActivityUpdate) => void
}

interface Transcript {
  path: string
  lastRead: number
  reading: boolean
  /** A turn ended during a read; read once more when it finishes. */
  again: boolean
}

export class AgentMonitor {
  readonly files: AgentFiles
  readonly activity: ActivityLog
  private readonly server: EventServer
  private readonly tracker: StatusTracker
  private readonly notifier: Notifier
  private codex = new Map<string, CodexWatcher>()
  private transcripts = new Map<string, Transcript>()
  private focused: string | null = null

  private readonly onChange: (paneId: string) => void

  constructor(opts: AgentMonitorOptions) {
    this.onChange = opts.onChange
    this.files = installAgentFiles(opts.home)
    this.activity = new ActivityLog(opts.onActivity)
    this.notifier = new Notifier({ ...opts, status: (id) => this.tracker.get(id) })
    this.tracker = new StatusTracker((paneId, prev, next) => {
      this.notifier.changed(paneId, prev, next)
      opts.onChange(paneId)
      // A turn that ends while the user is looking at it has been seen.
      if (next.status === 'done' && paneId === this.focused) this.tracker.seen(paneId)
    })
    this.server = new EventServer(socketPath(opts.home), (e) => this.onEvent(e))
  }

  async start(): Promise<void> {
    await this.server.start()
  }

  close(): void {
    this.server.close()
    this.notifier.close()
    this.tracker.close()
    this.activity.close()
  }

  /** The command to run for a preset, with whatever its agent needs to report here. */
  launch(command: string | undefined, resume = false): AgentLaunch {
    return agentLaunch(command, this.files, resume)
  }

  /** A pane's process is about to start. Returns the env vars that tie its events to it. */
  spawn(paneId: string, agent: AgentKind | null): Record<string, string> {
    const token = randomUUID()
    this.transcripts.delete(paneId)
    if (agent === 'codex') this.codex.set(paneId, new CodexWatcher())
    else this.codex.delete(paneId)
    this.tracker.spawn(paneId, token, agent)
    this.activity.started(paneId, agent)
    return { COCKPIT_SESSION_ID: token, COCKPIT_SOCKET: this.server.path }
  }

  status(paneId: string): PaneStatus | null {
    return this.tracker.get(paneId)
  }

  output(paneId: string, data: string): void {
    this.tracker.output(paneId)
    const watcher = this.codex.get(paneId)
    if (!watcher) return
    for (const r of watcher.feed(data)) {
      logReport(paneId, 'codex', r.signal)
      this.tracker.reportPane(paneId, r)
      this.activity.codex(paneId, r.signal)
    }
  }

  input(paneId: string, data: string): void {
    this.tracker.input(paneId, data)
  }

  resized(paneId: string): void {
    this.tracker.resized(paneId)
  }

  exited(paneId: string): void {
    this.codex.delete(paneId)
    this.tracker.exit(paneId)
    this.activity.exited(paneId)
  }

  killed(paneId: string): void {
    this.codex.delete(paneId)
    this.transcripts.delete(paneId)
    this.notifier.dismiss(paneId)
    this.tracker.remove(paneId)
    this.activity.remove(paneId)
    this.onChange(paneId)
  }

  /** The pane the user is looking at (null when the window isn't focused). */
  setFocused(paneId: string | null): void {
    if (paneId === this.focused) return
    this.focused = paneId
    if (paneId) {
      this.tracker.seen(paneId)
      this.notifier.dismiss(paneId)
    }
  }

  private onEvent(e: IncomingEvent): boolean {
    if (e.agent !== 'claude' || !e.event) return false
    const report = parseClaudeHook(e.event, e.payload)
    const paneId = this.tracker.paneFor(e.token)
    logReport(paneId, `claude:${e.event}`, report.signal)
    if (!paneId || !this.tracker.report(e.token, report)) return false
    this.activity.claude(paneId, e.event, e.payload)
    if (report.transcriptPath) {
      const kind = report.signal.kind
      this.readTranscript(paneId, report.transcriptPath, kind === 'done' || kind === 'idle')
    }
    return true
  }

  private readTranscript(paneId: string, file: string, now: boolean): void {
    let t = this.transcripts.get(paneId)
    if (t?.path !== file) {
      t = { path: file, lastRead: 0, reading: false, again: false }
      this.transcripts.set(paneId, t)
    }
    if (t.reading) {
      t.again ||= now
      return
    }
    if (!now && Date.now() - t.lastRead < TRANSCRIPT_EVERY_MS) return
    t.reading = true
    t.lastRead = Date.now()
    const entry = t
    void readTranscript(file, claudeHome()).then((info) => {
      entry.reading = false
      if (this.transcripts.get(paneId) !== entry) return
      if (info) this.tracker.annotate(paneId, info)
      if (entry.again) {
        entry.again = false
        this.readTranscript(paneId, file, true)
      }
    })
  }
}
