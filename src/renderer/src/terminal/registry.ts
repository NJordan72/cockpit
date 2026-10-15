import type { Terminal } from '@xterm/xterm'

/**
 * Live terminals by pane id. Used by the chrome (focus, search) and exposed on
 * window.__cockpitDebug so the e2e driver can read what a pane is showing.
 */
export const terminals = new Map<string, Terminal>()

function screenText(id: string): string | null {
  const term = terminals.get(id)
  if (!term) return null
  const buf = term.buffer.active
  const lines: string[] = []
  for (let y = 0; y < term.rows; y++) {
    lines.push(buf.getLine(buf.viewportY + y)?.translateToString(true) ?? '')
  }
  return lines.join('\n')
}

declare global {
  interface Window {
    __cockpitDebug?: {
      ids: () => string[]
      screen: (id: string) => string | null
      size: (id: string) => { cols: number; rows: number } | null
      selectAll: (id: string) => void
    }
  }
}

window.__cockpitDebug = {
  ids: () => [...terminals.keys()],
  screen: screenText,
  size: (id) => {
    const t = terminals.get(id)
    return t ? { cols: t.cols, rows: t.rows } : null
  },
  selectAll: (id) => terminals.get(id)?.selectAll()
}
