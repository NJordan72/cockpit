// Pure helpers for the terminal pane's floating find bar.
import type { ITheme } from '@xterm/xterm'
import type { ISearchOptions } from '@xterm/addon-search'
import { mixHex } from '@shared/theme'
import type { KeyLike } from './keys'

export interface SearchResults {
  resultIndex: number
  resultCount: number
}

export type FindBarAction = 'next' | 'prev' | 'close' | null

/** Keyboard shortcuts inside the floating find bar. */
export function classifyFindKey(e: KeyLike): FindBarAction {
  if (e.type !== 'keydown') return null
  if (e.key === 'Escape' && !e.metaKey && !e.ctrlKey && !e.altKey) return 'close'
  if (e.key === 'Enter' && !e.metaKey && !e.ctrlKey && !e.altKey) {
    return e.shiftKey ? 'prev' : 'next'
  }
  if (e.metaKey && !e.ctrlKey && !e.altKey && e.key.toLowerCase() === 'g') {
    return e.shiftKey ? 'prev' : 'next'
  }
  return null
}

/** Whether `pattern` compiles as a JavaScript regular expression. */
export function isValidRegex(pattern: string): boolean {
  try {
    new RegExp(pattern)
    return true
  } catch {
    return false
  }
}

/** Label for the find bar's match counter ("3/12", "No results", or "Invalid regex"). */
export function formatMatchCount(
  query: string,
  results: SearchResults | null,
  invalidRegex: boolean
): string {
  if (!query) return ''
  if (invalidRegex) return 'Invalid regex'
  if (!results || results.resultCount === 0) return 'No results'
  if (results.resultIndex < 0) return `?/${String(results.resultCount)}`
  return `${String(results.resultIndex + 1)}/${String(results.resultCount)}`
}

const HEX6 = /^#[0-9a-f]{6}$/i
const asHex = (color: string | undefined, fallback: string): string =>
  color && HEX6.test(color.trim()) ? color.trim() : fallback

/**
 * Search highlight colors derived from the terminal theme.
 * `@xterm/addon-search` requires `#RRGGBB` values for match backgrounds and
 * only fires `onDidChangeResults` when `decorations` is set.
 */
export function searchDecorations(
  theme: Pick<ITheme, 'background' | 'yellow' | 'blue'>
): NonNullable<ISearchOptions['decorations']> {
  const bg = asHex(theme.background, '#1e1f24')
  const yellow = asHex(theme.yellow, '#e0af68')
  const blue = asHex(theme.blue, '#7aa2f7')
  return {
    matchBackground: mixHex(yellow, bg, 0.3),
    matchBorder: mixHex(yellow, bg, 0.55),
    matchOverviewRuler: yellow,
    activeMatchBackground: mixHex(blue, bg, 0.65),
    activeMatchBorder: blue,
    activeMatchColorOverviewRuler: blue
  }
}

const MAX_PREFILL = 200

/**
 * Use a short single-line selection to pre-fill the find bar when opening it,
 * or null to keep whatever was already typed.
 */
export function initialSearchTerm(selection: string): string | null {
  if (!selection || selection.length > MAX_PREFILL) return null
  if (selection.includes('\n') || selection.includes('\r')) return null
  return selection.trim().length > 0 ? selection : null
}
