import type { DirListing } from '@shared/ipc'

export interface DirItem {
  path: string
  label: string
  tag?: 'current' | 'recent' | 'path'
}

const basename = (p: string): string =>
  p === '~' ? '~' : (p.split('/').filter(Boolean).pop() ?? p)

/** Case-insensitive subsequence match; lower score is better, null is no match. */
export function fuzzyScore(query: string, text: string): number | null {
  const q = query.toLowerCase()
  const t = text.toLowerCase()
  if (!q) return 0
  const sub = t.indexOf(q)
  if (sub !== -1) return sub
  let ti = 0
  let gaps = 0
  for (const ch of q) {
    const found = t.indexOf(ch, ti)
    if (found === -1) return null
    gaps += found - ti
    ti = found + 1
  }
  return 100 + gaps
}

/**
 * Candidate directories for the picker: the current one, then recent ones,
 * then projects by modification time. A query filters them, and a query that
 * looks like a path is offered as-is.
 */
export function rankDirs(
  query: string,
  currentDir: string | null,
  listing: DirListing | null
): DirItem[] {
  const seen = new Set<string>()
  const base: DirItem[] = []
  const add = (path: string, tag?: DirItem['tag']): void => {
    if (seen.has(path)) return
    seen.add(path)
    base.push(tag ? { path, label: basename(path), tag } : { path, label: basename(path) })
  }
  if (currentDir) add(currentDir, 'current')
  for (const d of listing?.recent ?? []) add(d, 'recent')
  for (const p of listing?.projects ?? []) add(p.path)

  const q = query.trim()
  if (!q) return base

  const scored = base
    .map((item, order) => {
      const byName = fuzzyScore(q, item.label)
      const byPath = fuzzyScore(q, item.path)
      const score = byName ?? (byPath === null ? null : byPath + 1000)
      return { item, order, score }
    })
    .filter((s): s is { item: DirItem; order: number; score: number } => s.score !== null)
    .sort((a, b) => a.score - b.score || a.order - b.order)
    .map((s) => s.item)

  if ((q.startsWith('/') || q.startsWith('~')) && !seen.has(q)) {
    return [{ path: q, label: basename(q), tag: 'path' }, ...scored]
  }
  return scored
}
