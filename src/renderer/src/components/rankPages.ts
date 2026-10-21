import type { RecentPage } from '@shared/config'
import { pageLabel, toWebUrl } from '@shared/web'
import { fuzzyScore } from './rankDirs'

export interface PageItem {
  url: string
  label: string
  tag?: 'address'
}

/**
 * Candidate pages: the recent ones in their order (newest first). A query
 * filters them by title, then by URL, and a query that reads as an address
 * is offered first.
 */
export function rankPages(query: string, pages: readonly RecentPage[]): PageItem[] {
  const base = pages.map((p) => ({ url: p.url, label: p.title ?? pageLabel(p.url) }))
  const q = query.trim()
  if (!q) return base

  const scored = base
    .map((item, order) => {
      const byName = fuzzyScore(q, item.label)
      const byUrl = fuzzyScore(q, item.url)
      const score = byName ?? (byUrl === null ? null : byUrl + 1000)
      return { item, order, score }
    })
    .filter((s): s is { item: PageItem; order: number; score: number } => s.score !== null)
    .sort((a, b) => a.score - b.score || a.order - b.order)
    .map((s) => s.item)

  const typed = toWebUrl(q)
  if (typed && !base.some((p) => p.url === typed)) {
    return [{ url: typed, label: pageLabel(typed), tag: 'address' }, ...scored]
  }
  return scored
}
