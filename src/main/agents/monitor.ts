// Ties agent awareness together: the event socket, the files Claude Code's
// hooks use, terminal reports (Codex's, agy's, and Claude's in remote panes),
// each pane's status and activity, notifications, and transcript details.
import { randomUUID } from 'node:crypto'
import fs from 'node:fs'
import type { ActivityUpdate } from '@shared/activity'
import type { AgentKind } from '@shared/widgets'
import { claudeHome } from '../paths'
import { ActivityLog } from './activity'
import { CodexWatcher } from './codex'
import { parseClaudeHook, type AgentReport, type AgentSignal } from './events'
import { installAgentFiles, type AgentFiles } from './files'
import { agentEnv, agentLaunch, type AgentLaunch, type LaunchOptions } from './launch'
import { Notifier, type NotifierDeps } from './notifier'
import { ProgramStatusWatcher } from './programStatus'
import { remoteClaudeSettings, remoteCommand, remoteSocketPath } from './remote'
import { EventServer, socketPath, type IncomingEvent, type RunRequestHandler } from './server'
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
  /** Answers cockpit-run on the event socket. */
  runRequests?: RunRequestHandler
  /** Writes to a pane's input as its terminal would, to answer an agent's probe. */
  reply?: (paneId: string, data: string) => void
}

/** Reads an agent's reports out of its pane's output (Codex, agy, remote Claude). */
interface TerminalWatcher {
  feed(chunk: string): AgentReport[]
}

interface Watched {
  agent: AgentKind
  watcher: TerminalWatcher
  /** Claude's hooks got through, so they drive the status and its terminal reports don't. */
  hooked: boolean
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
  private watchers = new Map<string, Watched>()
  /** Panes whose agent runs on another machine; its files aren't on this one. */
  private remote = new Set<string>()
  private transcripts = new Map<string, Transcript>()
  private focused: string | null = null

  private readonly onChange: (paneId: string) => void
  private readonly reply: (paneId: string, data: string) => void

  constructor(opts: AgentMonitorOptions) {
    this.onChange = opts.onChange
    this.reply = opts.reply ?? (() => undefined)
    this.files = installAgentFiles(opts.home)
    this.activity = new ActivityLog(opts.onActivity)
    this.notifier = new Notifier({ ...opts, status: (id) => this.tracker.get(id) })
    this.tracker = new StatusTracker((paneId, prev, next) => {
      this.notifier.changed(paneId, prev, next)
      opts.onChange(paneId)
      // A turn that ends while the user is looking at it has been seen.
      if (next.status === 'done' && paneId === this.focused) this.tracker.seen(paneId)
    })
    this.server = new EventServer(socketPath(opts.home), (e) => this.onEvent(e), opts.runRequests)
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

  /**
   * The command to run for a preset, with whatever its agent needs to report
   * here. On a remote machine, Claude's hooks go inline, since the settings
   * file is on this one.
   */
  launch(command: string | undefined, opts: LaunchOptions = {}, remote = false): AgentLaunch {
    const files = remote ? { claudeSettings: remoteClaudeSettings() } : this.files
    return agentLaunch(command, files, opts)
  }

  /**
   * A pane's process is about to start. Returns the env vars that tie its
   * events to it, and any its agent needs to report at all.
   */
  spawn(paneId: string, agent: AgentKind | null, remote = false): Record<string, string> {
    const token = randomUUID()
    this.transcripts.delete(paneId)
    if (remote) this.remote.add(paneId)
    else this.remote.delete(paneId)
    const reply = (data: string): void => this.reply(paneId, data)
    const watcher =
      agent === 'codex'
        ? new CodexWatcher()
        : agent === 'agy' || (agent === 'claude' && remote)
          ? new ProgramStatusWatcher(agent, reply)
          : null
    if (agent && watcher) this.watchers.set(paneId, { agent, watcher, hooked: false })
    else this.watchers.delete(paneId)
    this.tracker.spawn(paneId, token, agent)
    this.activity.started(paneId, agent)
    // cockpit-run is in the agents folder. A login shell's path_helper moves
    // the folder behind the system ones, and it stays on PATH.
    const PATH = [this.files.dir, process.env.PATH].filter(Boolean).join(':')
    return { ...agentEnv(agent), COCKPIT_SESSION_ID: token, COCKPIT_SOCKET: this.server.path, PATH }
  }

  /**
   * The local command for a remote pane (see remote.ts). `env` is what spawn
   * returned; the remote machine gets its agent's own vars and, for Claude,
   * the session token and the forwarded socket.
   */
  remoteCommand(
    host: string,
    dir: string,
    launch: AgentLaunch,
    env: Record<string, string>
  ): string {
    const token = env.COCKPIT_SESSION_ID ?? ''
    // ssh -R splits its argument at ":", so a socket path holding one can't be forwarded.
    const forward =
      launch.agent === 'claude' && token && !this.server.path.includes(':')
        ? { local: this.server.path, remote: remoteSocketPath(token) }
        : null
    return remoteCommand({
      host,
      dir,
      command: launch.command,
      env: {
        ...agentEnv(launch.agent),
        ...(forward ? { COCKPIT_SESSION_ID: token, COCKPIT_SOCKET: forward.remote } : {})
      },
      forward
    })
  }

  status(paneId: string): PaneStatus | null {
    return this.tracker.get(paneId)
  }

  output(paneId: string, data: string): void {
    this.tracker.output(paneId)
    const watched = this.watchers.get(paneId)
    if (!watched) return
    const reports = watched.watcher.feed(data)
    if (watched.hooked) return
    for (const r of reports) {
      logReport(paneId, watched.agent, r.signal)
      this.tracker.reportPane(paneId, r)
      this.activity.terminal(paneId, r.signal)
    }
  }

  input(paneId: string, data: string): void {
    this.tracker.input(paneId, data)
  }

  resized(paneId: string): void {
    this.tracker.resized(paneId)
  }

  exited(paneId: string): void {
    this.watchers.delete(paneId)
    this.remote.delete(paneId)
    this.tracker.exit(paneId)
    this.activity.exited(paneId)
  }

  killed(paneId: string): void {
    this.watchers.delete(paneId)
    this.remote.delete(paneId)
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
    const watched = this.watchers.get(paneId)
    if (watched) watched.hooked = true
    this.activity.claude(paneId, e.event, e.payload)
    // A remote pane's transcript is on the remote disk.
    if (report.transcriptPath && !this.remote.has(paneId)) {
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
