import type { IBufferLine, ILink, ILinkProvider, Terminal } from '@xterm/xterm'
import { findPathCandidates } from './paths'

interface Cell {
  x: number
  y: number
}

/**
 * The logical line that buffer row `y` (1-based) is part of, with the cell
 * each character came from. Soft-wrapped rows join, so a path that wraps is
 * still one link.
 */
function logicalLine(term: Terminal, y: number): { text: string; cells: Cell[] } {
  const buf = term.buffer.active
  let first = y - 1
  while (first > 0 && buf.getLine(first)?.isWrapped) first--
  let last = y - 1
  while (buf.getLine(last + 1)?.isWrapped) last++

  let text = ''
  const cells: Cell[] = []
  for (let row = first; row <= last; row++) {
    const line: IBufferLine | undefined = buf.getLine(row)
    if (!line) break
    for (let x = 0; x < line.length; x++) {
      const cell = line.getCell(x)
      if (!cell || cell.getWidth() === 0) continue // right half of a wide character
      const chars = cell.getChars() || ' '
      text += chars
      // One entry per UTF-16 unit, so string offsets index straight into cells.
      cells.push(...Array<Cell>(chars.length).fill({ x: x + 1, y: row + 1 }))
    }
  }
  return { text, cells }
}

/**
 * Underlines paths in the terminal that exist on disk, resolved against the
 * pane's directory, and opens them in their default app when clicked.
 */
export function pathLinkProvider(term: Terminal, paneId: string): ILinkProvider {
  const api = window.cockpit
  return {
    provideLinks(y, callback) {
      const { text, cells } = logicalLine(term, y)
      // Only the candidates that cross row y; the other rows ask for their own.
      const candidates = findPathCandidates(text).flatMap((c) => {
        const start = cells[c.start]
        const end = cells[c.end - 1]
        return start && end && start.y <= y && end.y >= y ? [{ path: c.path, start, end }] : []
      })
      if (candidates.length === 0) {
        callback(undefined)
        return
      }
      api.files
        .existing(
          paneId,
          candidates.map((c) => c.path)
        )
        .then((found) => {
          const real = new Set(found)
          const links: ILink[] = candidates
            .filter((c) => real.has(c.path))
            .map((c) => ({
              text: c.path,
              range: { start: c.start, end: c.end },
              activate: () => api.files.open(paneId, c.path)
            }))
          callback(links.length ? links : undefined)
        })
        .catch(() => callback(undefined))
    }
  }
}

/** Opens an OSC 8 hyperlink: file:// in its default app, http(s) in the browser. */
export function openHyperlink(paneId: string, uri: string): void {
  let url: URL
  try {
    url = new URL(uri)
  } catch {
    return
  }
  if (url.protocol === 'file:') {
    window.cockpit.files.open(paneId, decodeURIComponent(url.pathname))
  } else if (url.protocol === 'http:' || url.protocol === 'https:') {
    // The main process routes http(s) window.open calls to the browser.
    window.open(url.href, '_blank')
  }
}
