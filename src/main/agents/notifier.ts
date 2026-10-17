// macOS notifications for panes that need the user: when one goes to
// needs-input or done while the window isn't focused. Clicking one focuses
// that pane.
import { Notification } from 'electron'
import type { PaneStatus } from './tracker'

/**
 * A short wait before showing: the request's own text can arrive just after
 * the status changes (Codex's title, then its OSC 9), and a status that flips
 * straight back isn't worth a notification.
 */
const SETTLE_MS = 250
const MAX_BODY = 200

export interface NotifierDeps {
  windowFocused: () => boolean
  status: (paneId: string) => PaneStatus | null
  /** Preset name and directory, e.g. "Claude Code" and "cockpit". */
  describe: (paneId: string) => { name: string; place: string } | null
  onClick: (paneId: string) => void
  /** macOS refused to show one (an unsigned build may not be allowed to). */
  onFailed: (error: string) => void
}

function clip(text: string): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length > MAX_BODY ? flat.slice(0, MAX_BODY - 1) + '…' : flat
}

export class Notifier {
  private timers = new Map<string, NodeJS.Timeout>()
  /** Shown notifications, kept so their click handlers stay alive. */
  private shown = new Map<string, Notification>()

  constructor(private readonly deps: NotifierDeps) {}

  changed(paneId: string, prev: PaneStatus | null, next: PaneStatus): void {
    if (prev?.status === next.status) return
    const timer = this.timers.get(paneId)
    if (timer) clearTimeout(timer)
    this.timers.delete(paneId)
    if (next.status !== 'needs-input' && next.status !== 'done') return
    const status = next.status
    this.timers.set(
      paneId,
      setTimeout(() => {
        this.timers.delete(paneId)
        const now = this.deps.status(paneId)
        if (now?.status === status && !this.deps.windowFocused()) this.show(paneId, now)
      }, SETTLE_MS)
    )
  }

  /** The user is looking at the pane; its notification has nothing left to say. */
  dismiss(paneId: string): void {
    this.shown.get(paneId)?.close()
    this.shown.delete(paneId)
  }

  close(): void {
    for (const t of this.timers.values()) clearTimeout(t)
    this.timers.clear()
    for (const n of this.shown.values()) n.close()
    this.shown.clear()
  }

  private show(paneId: string, s: PaneStatus): void {
    if (!Notification.isSupported()) return
    const pane = this.deps.describe(paneId)
    if (!pane) return
    const waiting = s.status === 'needs-input'
    const body = waiting
      ? (s.message ?? 'Waiting for you')
      : s.doneMessage
        ? clip(s.doneMessage)
        : 'Finished its turn'
    const n = new Notification({
      title: `${pane.name} ${waiting ? 'needs input' : 'is done'}`,
      subtitle: s.title ? `${pane.place} · ${s.title}` : pane.place,
      body
    })
    n.on('click', () => {
      this.shown.delete(paneId)
      this.deps.onClick(paneId)
    })
    n.on('close', () => {
      if (this.shown.get(paneId) === n) this.shown.delete(paneId)
    })
    n.on('failed', (_e, error) => {
      if (this.shown.get(paneId) === n) this.shown.delete(paneId)
      this.deps.onFailed(error)
    })
    this.dismiss(paneId)
    this.shown.set(paneId, n)
    n.show()
  }
}
