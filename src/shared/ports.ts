/** A local dev server URL detected in a terminal pane's output. */
export interface LocalServer {
  /** Normalized URL, e.g. "http://localhost:5173" or "http://127.0.0.1:3000/app". */
  url: string
  /** TCP port number (1–65535). */
  port: number
}

/**
 * Finds ports advertised by more than one pane.
 * Returns a map from port number to the distinct pane ids advertising it.
 */
export function portCollisions(
  sessions: readonly { id: string; ports: readonly LocalServer[] }[]
): Map<number, string[]> {
  const byPort = new Map<number, string[]>()
  for (const s of sessions) {
    const seen = new Set<number>()
    for (const p of s.ports) {
      if (seen.has(p.port)) continue
      seen.add(p.port)
      const list = byPort.get(p.port)
      if (list) list.push(s.id)
      else byPort.set(p.port, [s.id])
    }
  }
  for (const [port, ids] of byPort) {
    if (ids.length < 2) byPort.delete(port)
  }
  return byPort
}
