// Detects local dev-server URLs (localhost, 127.0.0.1, [::1]) in PTY output.
// Pure helpers plus a per-pane tracker that survives ANSI styling and chunk splits.
import type { LocalServer } from '@shared/ports'

// OSC (BEL or ST), CSI, DCS/SOS/PM/APC, and 2-byte ESC sequences.
const ANSI_ESCAPE =
  // eslint-disable-next-line no-control-regex
  /\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b\[[0-?]*[ -/]*[@-~]|\x1b[PX^_][^\x1b]*\x1b\\|\x1b[@-Z\\-_]/g

const LOCAL_URL =
  /\bhttps?:\/\/(?:localhost|127\.0\.0\.1|\[::1\]):(\d{1,5})(?:\/[^\s"'`<>)}\]]*)?/gi

/** Longest incomplete ANSI escape held across chunks. */
const MAX_PARTIAL_ESC = 128
/** Longest trailing token held across chunks to catch split URLs. */
const MAX_TAIL = 128
/** Cap per pane so a noisy test runner cannot grow session state without bound. */
const MAX_PORTS_PER_PANE = 16

/** Removes ANSI escape sequences (CSI, OSC, DCS, 2-byte ESC) from terminal output. */
export function stripAnsi(text: string): string {
  if (!text.includes('\x1b')) return text
  return text.replace(ANSI_ESCAPE, '')
}

/** Extracts normalized local server URLs from plain (or ANSI-styled) text. */
export function extractLocalServers(text: string): LocalServer[] {
  const clean = stripAnsi(text)
  if (!clean.includes('://')) return []
  const found: LocalServer[] = []
  LOCAL_URL.lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = LOCAL_URL.exec(clean)) !== null) {
    const raw = match[0]
    const portStr = match[1]
    if (!portStr || portStr.startsWith('0')) continue
    const port = Number(portStr)
    if (!Number.isInteger(port) || port < 1 || port > 65535) continue
    const trimmed = raw.replace(/[.,;:!?]+$/, '')
    let parsed: URL
    try {
      parsed = new URL(trimmed)
    } catch {
      continue
    }
    const url =
      parsed.pathname === '/' && !parsed.search && !parsed.hash ? parsed.origin : parsed.href
    found.push({ url, port })
  }
  return found
}

interface PanePorts {
  /** Keyed by port number, preserving detection order. */
  byPort: Map<number, LocalServer>
  /** Unclosed ESC sequence at the end of the previous chunk. */
  pendingEsc: string
  /** Non-whitespace tail of the previous clean chunk for split URLs. */
  tail: string
}

/**
 * Tracks detected local dev-server URLs per pane.
 * Deduplicates by port per pane (preferring `localhost` over numeric loopback
 * when the same port is advertised on both) and clears on pane exit or clear.
 */
export class PortTracker {
  private panes = new Map<string, PanePorts>()

  constructor(private readonly onChange: (paneId: string) => void) {}

  get(paneId: string): LocalServer[] {
    const entry = this.panes.get(paneId)
    return entry ? [...entry.byPort.values()] : []
  }

  output(paneId: string, chunk: string): void {
    let entry = this.panes.get(paneId)
    if (!entry) {
      entry = { byPort: new Map(), pendingEsc: '', tail: '' }
      this.panes.set(paneId, entry)
    }
    const combined = entry.pendingEsc + chunk
    entry.pendingEsc = ''
    let clean = stripAnsi(combined)
    const esc = clean.lastIndexOf('\x1b')
    if (esc !== -1 && clean.length - esc <= MAX_PARTIAL_ESC) {
      entry.pendingEsc = clean.slice(esc)
      clean = clean.slice(0, esc)
    }
    const scan = entry.tail + clean
    const ws = Math.max(
      scan.lastIndexOf('\n'),
      scan.lastIndexOf('\r'),
      scan.lastIndexOf(' '),
      scan.lastIndexOf('\t')
    )
    entry.tail = scan.slice(ws + 1).slice(-MAX_TAIL)

    if (!scan.includes('://')) return
    const servers = extractLocalServers(scan)
    if (servers.length === 0) return

    let changed = false
    for (const s of servers) {
      const existing = entry.byPort.get(s.port)
      if (!existing) {
        if (entry.byPort.size >= MAX_PORTS_PER_PANE) continue
        entry.byPort.set(s.port, s)
        changed = true
      } else if (!existing.url.includes('://localhost') && s.url.includes('://localhost')) {
        // Prefer localhost when a server advertises both 127.0.0.1/[::1] and localhost.
        entry.byPort.set(s.port, s)
        changed = true
      }
    }
    if (changed) this.onChange(paneId)
  }

  /** Clears detected ports for a pane (on exit, kill, or pane clear/restart). */
  clear(paneId: string): void {
    const entry = this.panes.get(paneId)
    if (!entry) return
    const hadPorts = entry.byPort.size > 0
    this.panes.delete(paneId)
    if (hadPorts) this.onChange(paneId)
  }
}
