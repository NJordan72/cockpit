import { describe, expect, it } from 'vitest'
import { panel, type FrameSplit } from '@shared/frame'
import { formatBytes, formatShare, formatUptime, meterLevel } from './format'
import { cellSize, cellStyle, slotName } from './layout'

const ctx = {
  contentWidgets: new Set(['tiny']),
  state: { absent: new Set<string>(), panelsHidden: false }
}

const split = (direction: 'row' | 'column', children: FrameSplit['children']): FrameSplit => ({
  type: 'split',
  id: 's',
  direction,
  children
})

describe('cellStyle', () => {
  it('gives fixed sizes a basis, flexible ones a share, and keeps the terminals wide enough', () => {
    const s = split('row', [panel('workspace'), panel('clock', { size: 300 })])
    expect(cellStyle(panel('clock', { size: 300 }), s, s.children, ctx)).toEqual({
      flex: '0 1 300px',
      minWidth: 48
    })
    expect(cellStyle(panel('workspace'), s, s.children, ctx)).toEqual({
      flex: '1 1 0px',
      minWidth: 320
    })
  })

  it('lets fixed panels grow when nothing in the split flexes', () => {
    const s = split('column', [panel('sessions'), panel('activity', { size: 320 })])
    expect(cellStyle(panel('activity', { size: 320 }), s, s.children, ctx).flex).toBe('1 1 320px')
  })

  it('fits auto panels and content widgets to their content, up to max', () => {
    const s = split('column', [panel('sessions', { max: 0.45 })])
    expect(cellStyle(panel('sessions', { max: 0.45 }), s, s.children, ctx)).toEqual({
      flex: 'none',
      maxHeight: '45%'
    })
    expect(cellSize(panel('widget', { widget: 'tiny' }), ctx)).toBe('auto')
    expect(cellSize(panel('widget', { widget: 'tiny', size: 200 }), ctx)).toBe(200)
    expect(cellSize(panel('widget', { widget: 'big' }), ctx)).toBe('flex')
  })

  it('folds collapsed panels to their title row in a column only', () => {
    const p = panel('monitor', { collapsed: true, size: 200 })
    expect(cellStyle(p, split('column', [p]), [p], ctx)).toEqual({ flex: 'none' })
    expect(cellStyle(p, split('row', [p]), [p], ctx).flex).toBe('1 1 200px')
  })
})

describe('cellSize of a group', () => {
  it('fits its content when every child in it does', () => {
    const group = split('column', [
      panel('widget', { widget: 'tiny' }),
      panel('widget', { widget: 'big', collapsed: true })
    ])
    expect(cellSize(group, ctx, 'column')).toBe('auto')
    const open = split('column', [panel('widget', { widget: 'big' })])
    expect(cellSize(open, ctx, 'column')).toBe('flex')
    // Across a row, a column's width doesn't follow its children's heights.
    expect(cellSize(group, ctx, 'row')).toBe('flex')
  })
})

describe('slotName', () => {
  it('makes a CSS dashed ident', () => {
    expect(slotName('w-shortcut-stories')).toBe('--slot-w-shortcut-stories')
    expect(slotName('a b:c')).toBe('--slot-a-b-c')
  })
})

describe('format', () => {
  it('formats the System panel numbers', () => {
    expect(formatBytes(51539607552)).toBe('48.0 GB')
    expect(formatBytes(300 * 1024 ** 2)).toBe('300 MB')
    expect(formatUptime(2 * 86400 + 8 * 3600 + 59)).toBe('2d 8h')
    expect(formatUptime(5 * 3600 + 12 * 60)).toBe('5h 12m')
    expect(formatUptime(600)).toBe('10m')
    expect(formatShare(0.1234)).toBe('12.3%')
    expect([0.5, 0.85, 0.95].map(meterLevel)).toEqual(['ok', 'high', 'full'])
  })
})
