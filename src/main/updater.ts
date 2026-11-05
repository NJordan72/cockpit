// Checks GitHub Releases for a newer Cockpit, downloads it in the background,
// and asks before restarting into it. electron-updater does the checking,
// downloading, and installing; Updates decides when to check and when to ask.
import { execFile } from 'node:child_process'
import path from 'node:path'
import type { SessionInfo } from '@shared/widgets'

export const FIRST_CHECK_MS = 60_000
export const CHECK_EVERY_MS = 4 * 60 * 60_000

export type UpdateState =
  | { kind: 'idle' }
  | { kind: 'checking' }
  | { kind: 'downloading'; version: string }
  | { kind: 'ready'; version: string }

export interface UpdatesOptions {
  currentVersion: string
  /** Starts a check. The outcome comes back through available, notAvailable, downloaded, and failed. */
  check: () => Promise<unknown>
  /** Quits, installs the downloaded update, and reopens Cockpit. */
  install: () => void
  /** Resolves true to restart into `version` now. */
  askToRestart: (version: string) => Promise<boolean>
  /** Reports the outcome of a check the user asked for. */
  tell: (message: string, detail?: string) => void
  /** Whether a dialog may open now. */
  canAsk: () => boolean
  /** The state changed. */
  onChange: () => void
}

export class Updates {
  private state: UpdateState = { kind: 'idle' }
  /** The check in progress was asked for from the menu, so its outcome gets a dialog. */
  private manual = false
  /** Versions the user has been asked about once already. Later means install on quit. */
  private readonly asked = new Set<string>()
  private readonly timers: ReturnType<typeof setTimeout>[] = []

  constructor(private readonly opts: UpdatesOptions) {}

  start(): void {
    this.timers.push(
      setTimeout(() => this.tick(), FIRST_CHECK_MS),
      setInterval(() => this.tick(), CHECK_EVERY_MS)
    )
  }

  close(): void {
    for (const t of this.timers) clearTimeout(t)
  }

  get current(): UpdateState {
    return this.state
  }

  /** The app menu's item for updates, which follows the state. */
  menuItem(): { label: string; enabled: boolean } {
    switch (this.state.kind) {
      case 'idle':
        return { label: 'Check for Updates…', enabled: true }
      case 'checking':
        return { label: 'Checking for Updates…', enabled: false }
      case 'downloading':
        return { label: `Downloading Cockpit ${this.state.version}…`, enabled: false }
      case 'ready':
        return { label: `Restart to Install Cockpit ${this.state.version}…`, enabled: true }
    }
  }

  /** The menu item: check now, or ask again about an update that's ready. */
  checkNow(): void {
    if (this.state.kind === 'ready') this.offer(true)
    else if (this.state.kind === 'idle') this.check(true)
  }

  available(version: string): void {
    this.set({ kind: 'downloading', version })
  }

  notAvailable(): void {
    this.set({ kind: 'idle' })
    if (this.manual) {
      this.opts.tell(
        "You're up to date",
        `Cockpit ${this.opts.currentVersion} is the newest version.`
      )
    }
    this.manual = false
  }

  downloaded(version: string): void {
    this.set({ kind: 'ready', version })
    this.offer(this.manual)
    this.manual = false
  }

  failed(err: Error): void {
    // An update that's already downloaded still installs on quit.
    if (this.state.kind !== 'ready') this.set({ kind: 'idle' })
    if (this.manual) this.opts.tell("Cockpit couldn't check for updates", err.message)
    else console.warn('update check failed:', err.message)
    this.manual = false
  }

  /** Once an update is ready there's nothing left to check for; ask if not asked yet. */
  private tick(): void {
    if (this.state.kind === 'ready') this.offer(false)
    else if (this.state.kind === 'idle') this.check(false)
  }

  private check(manual: boolean): void {
    this.manual = manual
    this.set({ kind: 'checking' })
    // A failure also arrives as an 'error' event, which failed() handles.
    this.opts.check().catch(() => undefined)
  }

  /** `again` asks even about a version the user already put off. */
  private offer(again: boolean): void {
    if (this.state.kind !== 'ready') return
    const { version } = this.state
    if (!again && this.asked.has(version)) return
    if (!this.opts.canAsk()) return
    this.asked.add(version)
    void this.opts.askToRestart(version).then((restart) => {
      if (restart) this.opts.install()
    })
  }

  private set(state: UpdateState): void {
    this.state = state
    this.opts.onChange()
  }
}

/** The dialog that offers a downloaded update. Restarting ends whatever runs in the panes. */
export function restartPrompt(
  version: string,
  sessions: readonly SessionInfo[]
): { message: string; detail: string; buttons: string[]; defaultId: number; cancelId: number } {
  const running = sessions.filter((s) => s.status !== 'exited').length
  const busy = sessions.filter(
    (s) => s.agent !== null && (s.status === 'working' || s.status === 'needs-input')
  ).length
  const later = 'Choose Later to install it the next time you quit Cockpit.'
  let detail: string
  if (running === 0) {
    detail = `Cockpit will close and reopen. ${later}`
  } else {
    const terminals = running === 1 ? '1 terminal' : `${running.toString()} terminals`
    const agents =
      busy === 0
        ? ''
        : `, including ${busy === 1 ? '1 agent that is' : `${busy.toString()} agents that are`} working or waiting for you`
    detail =
      `Restarting closes ${terminals} and ends what's running in ${running === 1 ? 'it' : 'them'}${agents}. ` +
      `Your tabs reopen with new sessions. ${later}`
  }
  return {
    message: `Cockpit ${version} is ready to install`,
    detail,
    buttons: ['Restart Now', 'Later'],
    // Enter shouldn't end an agent's work by accident.
    defaultId: busy > 0 ? 1 : 0,
    cancelId: 1
  }
}

/** Whether `codesign -dv` output describes a Developer ID signature, which updates need. */
export function isDeveloperIdSignature(codesignOutput: string): boolean {
  return /^Authority=Developer ID Application: /m.test(codesignOutput)
}

/**
 * macOS installs an update only when it's signed by the same Developer ID as
 * the running app, so ad-hoc and development builds don't check at all.
 */
export function signedWithDeveloperId(execPath: string): Promise<boolean> {
  // .../Cockpit.app/Contents/MacOS/Cockpit
  const bundle = path.resolve(execPath, '..', '..', '..')
  return new Promise((resolve) => {
    execFile('/usr/bin/codesign', ['-dv', '--verbose=2', bundle], (err, _stdout, stderr) => {
      resolve(!err && isDeveloperIdSignature(stderr))
    })
  })
}
