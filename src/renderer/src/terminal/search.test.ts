import { describe, expect, it } from 'bun:test'
import type { KeyLike } from './keys'
import {
  classifyFindKey,
  formatMatchCount,
  initialSearchTerm,
  isValidRegex,
  searchDecorations
} from './search'

const key = (k: string, mods: Partial<KeyLike> = {}, type = 'keydown'): KeyLike => ({
  type,
  key: k,
  shiftKey: false,
  altKey: false,
  ctrlKey: false,
  metaKey: false,
  ...mods
})

describe('classifyFindKey', () => {
  it('maps Enter / Shift+Enter and Cmd+G / Cmd+Shift+G to next / prev', () => {
    expect(classifyFindKey(key('Enter'))).toBe('next')
    expect(classifyFindKey(key('Enter', { shiftKey: true }))).toBe('prev')
    expect(classifyFindKey(key('g', { metaKey: true }))).toBe('next')
    expect(classifyFindKey(key('G', { metaKey: true, shiftKey: true }))).toBe('prev')
  })

  it('maps Escape to close and ignores non-keydown or unrelated keys', () => {
    expect(classifyFindKey(key('Escape'))).toBe('close')
    expect(classifyFindKey(key('Escape', { metaKey: true }))).toBeNull()
    expect(classifyFindKey(key('Enter', {}, 'keyup'))).toBeNull()
    expect(classifyFindKey(key('a'))).toBeNull()
    expect(classifyFindKey(key('g', { ctrlKey: true }))).toBeNull()
  })
})

describe('isValidRegex', () => {
  it('accepts valid patterns and rejects malformed ones', () => {
    expect(isValidRegex('error:\\s+\\d+')).toBe(true)
    expect(isValidRegex('plain text')).toBe(true)
    expect(isValidRegex('[unclosed')).toBe(false)
    expect(isValidRegex('(unmatched')).toBe(false)
  })
})

describe('formatMatchCount', () => {
  it('formats empty, invalid regex, zero, indexed, and unknown-index states', () => {
    expect(formatMatchCount('', null, false)).toBe('')
    expect(formatMatchCount('[bad', null, true)).toBe('Invalid regex')
    expect(formatMatchCount('foo', null, false)).toBe('No results')
    expect(formatMatchCount('foo', { resultIndex: -1, resultCount: 0 }, false)).toBe('No results')
    expect(formatMatchCount('foo', { resultIndex: 0, resultCount: 5 }, false)).toBe('1/5')
    expect(formatMatchCount('foo', { resultIndex: 2, resultCount: 12 }, false)).toBe('3/12')
    expect(formatMatchCount('foo', { resultIndex: -1, resultCount: 1000 }, false)).toBe('?/1000')
  })
})

describe('searchDecorations', () => {
  it('produces valid #RRGGBB colors from the theme and falls back for non-hex values', () => {
    const d = searchDecorations({ background: '#1e1f24', yellow: '#e0af68', blue: '#7aa2f7' })
    expect(d.matchBackground).toMatch(/^#[0-9a-f]{6}$/i)
    expect(d.activeMatchBackground).toMatch(/^#[0-9a-f]{6}$/i)
    expect(d.matchOverviewRuler).toBe('#e0af68')
    expect(d.activeMatchColorOverviewRuler).toBe('#7aa2f7')

    const fallback = searchDecorations({ background: 'rgb(0,0,0)', yellow: undefined, blue: 'red' })
    expect(fallback.matchBackground).toMatch(/^#[0-9a-f]{6}$/i)
    expect(fallback.activeMatchBackground).toMatch(/^#[0-9a-f]{6}$/i)
    expect(fallback.matchOverviewRuler).toBe('#e0af68')
    expect(fallback.activeMatchColorOverviewRuler).toBe('#7aa2f7')
  })
})

describe('initialSearchTerm', () => {
  it('uses short single-line selections and ignores empty, blank, multiline, or huge ones', () => {
    expect(initialSearchTerm('ECONNREFUSED')).toBe('ECONNREFUSED')
    expect(initialSearchTerm('')).toBeNull()
    expect(initialSearchTerm('   ')).toBeNull()
    expect(initialSearchTerm('line 1\nline 2')).toBeNull()
    expect(initialSearchTerm('line 1\rline 2')).toBeNull()
    expect(initialSearchTerm('a'.repeat(201))).toBeNull()
  })
})
