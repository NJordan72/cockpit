import { describe, expect, it } from 'vitest'
import { defaultSidebar, type SidebarSettings } from '@shared/config'
import type { WidgetInfo } from '@shared/widgets'
import {
  activeWidgetId,
  dragPair,
  placeWidgets,
  updatePlacement,
  withPlacements
} from './sidebarModel'

const info = (id: string): WidgetInfo => ({
  id,
  dir: `~/.cockpit/widgets/${id}`,
  revision: 1,
  manifest: null,
  error: 'n/a'
})

const settings = (ids: string[]): SidebarSettings => ({
  ...defaultSidebar(),
  widgets: ids.map((id) => ({ id, collapsed: false, size: 1 }))
})

describe('placeWidgets', () => {
  it('keeps the configured order, skips uninstalled, appends new', () => {
    const placed = placeWidgets(settings(['b', 'gone', 'a']), [info('a'), info('b'), info('c')])
    expect(placed.map((p) => p.info.id)).toEqual(['b', 'a', 'c'])
    expect(placed[2]?.placement).toEqual({ id: 'c', collapsed: false, size: 1 })
  })
})

describe('withPlacements', () => {
  it('adds new widgets and keeps uninstalled ones', () => {
    const s = settings(['gone'])
    expect(withPlacements(s, [info('a')]).widgets.map((w) => w.id)).toEqual(['gone', 'a'])
  })

  it('returns the same object when nothing is missing', () => {
    const s = settings(['a'])
    expect(withPlacements(s, [info('a')])).toBe(s)
  })
})

describe('updatePlacement', () => {
  it('patches one widget, adding it if needed', () => {
    const s = updatePlacement(settings(['a', 'b']), 'b', { collapsed: true })
    expect(s.widgets).toEqual([
      { id: 'a', collapsed: false, size: 1 },
      { id: 'b', collapsed: true, size: 1 }
    ])
    expect(updatePlacement(s, 'c', { size: 2 }).widgets[2]).toEqual({
      id: 'c',
      collapsed: false,
      size: 2
    })
  })
})

describe('activeWidgetId', () => {
  it('falls back to the first widget', () => {
    const placed = placeWidgets(settings(['a', 'b']), [info('a'), info('b')])
    expect(activeWidgetId({ ...defaultSidebar(), activeWidget: 'b' }, placed)).toBe('b')
    expect(activeWidgetId({ ...defaultSidebar(), activeWidget: 'gone' }, placed)).toBe('a')
    expect(activeWidgetId(defaultSidebar(), [])).toBeNull()
  })
})

describe('dragPair', () => {
  it('moves the boundary and keeps the sum of sizes', () => {
    const [a, b] = dragPair([1, 1], [200, 200], 100, 40)
    expect(a + b).toBeCloseTo(2)
    expect(a / (a + b)).toBeCloseTo(300 / 400)
  })

  it('keeps both sides at least minPx tall', () => {
    const [a, b] = dragPair([2, 1], [300, 150], 1000, 50)
    expect(b / (a + b)).toBeCloseTo(50 / 450)
    const [c] = dragPair([2, 1], [300, 150], -1000, 50)
    expect(c / 3).toBeCloseTo(50 / 450)
  })
})
