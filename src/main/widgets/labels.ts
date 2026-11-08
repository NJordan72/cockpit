// Labels widgets put on sessions, which the chrome draws in a strip above
// the pane. They're kept in memory only: a widget that starts again sets
// them again.
import type { PaneLabel } from '@shared/widgets'
import { WidgetCallError } from './errors'

/** Longest of each part, in characters, and how many facts a label may have. */
export const LABEL_LIMITS = { key: 24, title: 200, facts: 6, fact: 40, detail: 1000, url: 2000 }

export type LabelContent = Omit<PaneLabel, 'widgetId' | 'widgetName'>

type Obj = Record<string, unknown>
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v)

const invalid = (message: string): WidgetCallError =>
  new WidgetCallError('invalid_argument', message)

const graphemes = new Intl.Segmenter(undefined, { granularity: 'grapheme' })

/**
 * Cuts text to `max` characters, ending it with an ellipsis when it was
 * longer. A character is what's seen as one, so an emoji isn't split.
 */
function cut(text: string, max: number): string {
  if (text.length <= max) return text
  const chars = Array.from(graphemes.segment(text), (s) => s.segment)
  return chars.length <= max ? text : chars.slice(0, max - 1).join('') + '…'
}

/** The strip is one line, so line breaks and other control characters become spaces. */
const oneLine = (text: string, max: number): string =>
  cut(text.replace(/[\s\p{Cc}]+/gu, ' ').trim(), max)

/** The tooltip keeps line breaks and tabs. */
const multiLine = (text: string, max: number): string =>
  cut(
    text
      .replace(/\r\n?/g, '\n')
      .replace(/[^\P{Cc}\n\t]/gu, '')
      .trim(),
    max
  )

function optional(raw: Obj, key: string): string | null {
  const v = raw[key]
  if (v === undefined || v === null) return null
  if (typeof v !== 'string') throw invalid(`label "${key}" must be a string`)
  return v
}

/**
 * Checks a label from a widget and cuts it to length. `openable` checks the
 * URL against the widget's openExternal patterns and returns the form the
 * browser would get.
 */
export function parseLabel(raw: unknown, openable: (url: string) => string): LabelContent {
  if (!isObj(raw)) throw invalid('the label must be an object, or null to remove it')
  if (typeof raw.key !== 'string' || typeof raw.title !== 'string') {
    throw invalid('label "key" and "title" must be strings')
  }
  const key = oneLine(raw.key, LABEL_LIMITS.key)
  if (key === '') throw invalid('label "key" must not be empty')

  let facts: string[] = []
  if (raw.facts !== undefined && raw.facts !== null) {
    if (!Array.isArray(raw.facts) || !raw.facts.every((f): f is string => typeof f === 'string')) {
      throw invalid('label "facts" must be a list of strings')
    }
    if (raw.facts.length > LABEL_LIMITS.facts) {
      throw invalid(`a label has at most ${LABEL_LIMITS.facts} facts`)
    }
    facts = raw.facts.map((f) => oneLine(f, LABEL_LIMITS.fact)).filter((f) => f !== '')
  }

  const detail = optional(raw, 'detail')
  const url = optional(raw, 'url')
  if (url !== null && url.length > LABEL_LIMITS.url) {
    throw invalid(`label "url" must be at most ${LABEL_LIMITS.url} characters`)
  }
  return {
    key,
    title: oneLine(raw.title, LABEL_LIMITS.title),
    facts,
    detail: detail === null ? null : multiLine(detail, LABEL_LIMITS.detail) || null,
    url: url === null ? null : openable(url)
  }
}

export class SessionLabels {
  /** Pane id, then widget id. */
  private panes = new Map<string, Map<string, PaneLabel>>()

  get(paneId: string, widgetId: string): PaneLabel | null {
    return this.panes.get(paneId)?.get(widgetId) ?? null
  }

  /** The pane's labels, ordered by widget id. */
  of(paneId: string): PaneLabel[] {
    const mine = this.panes.get(paneId)
    if (!mine) return []
    return [...mine.values()].sort((a, b) => (a.widgetId < b.widgetId ? -1 : 1))
  }

  /** Sets one widget's label on a pane, or removes it. Returns whether anything changed. */
  set(paneId: string, widgetId: string, label: PaneLabel | null): boolean {
    const mine = this.panes.get(paneId)
    const old = mine?.get(widgetId) ?? null
    if (JSON.stringify(old) === JSON.stringify(label)) return false
    if (label) {
      if (mine) mine.set(widgetId, label)
      else this.panes.set(paneId, new Map([[widgetId, label]]))
    } else if (mine) {
      mine.delete(widgetId)
      if (mine.size === 0) this.panes.delete(paneId)
    }
    return true
  }

  /** Drops the labels of widgets not in `widgetIds`. Returns whether any went. */
  retainWidgets(widgetIds: ReadonlySet<string>): boolean {
    let changed = false
    for (const [paneId, mine] of this.panes) {
      for (const widgetId of mine.keys()) {
        if (widgetIds.has(widgetId)) continue
        mine.delete(widgetId)
        changed = true
      }
      if (mine.size === 0) this.panes.delete(paneId)
    }
    return changed
  }

  /** Drops every label one widget set. Returns whether any went. */
  dropWidget(widgetId: string): boolean {
    let changed = false
    for (const [paneId, mine] of this.panes) {
      if (!mine.delete(widgetId)) continue
      changed = true
      if (mine.size === 0) this.panes.delete(paneId)
    }
    return changed
  }

  /** Drops the labels of panes not in `paneIds`. */
  retainPanes(paneIds: ReadonlySet<string>): void {
    for (const paneId of this.panes.keys()) if (!paneIds.has(paneId)) this.panes.delete(paneId)
  }
}
