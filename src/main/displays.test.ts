import { describe, expect, it } from 'bun:test'
import { arrange, findDisplay, fitInto, mostlyOn, type DisplayInfo } from './displays'

const area = (x: number, width = 1000, height = 800, y = 0): DisplayInfo['workArea'] => ({
  x,
  y,
  width,
  height
})
const laptop: DisplayInfo = {
  id: 1,
  label: 'Built-in Retina Display',
  workArea: area(0, 1500, 900)
}
const left: DisplayInfo = { id: 2, label: 'DELL U2720Q', workArea: area(-2000, 2000, 1100) }
const right: DisplayInfo = { id: 3, label: 'LG UltraFine', workArea: area(1500, 1000, 800) }

describe('arrange', () => {
  it('gives each window a display of its own, left to right', () => {
    expect(arrange([laptop, right, left], 3, [null, null, null])).toEqual([
      left.workArea,
      laptop.workArea,
      right.workArea
    ])
  })

  it('keeps windows on the displays they are on', () => {
    expect(arrange([laptop, left, right], 2, [3, 1])).toEqual([right.workArea, laptop.workArea])
    // The first window stays put when a second one opens.
    expect(arrange([laptop, left, right], 2, [1, null])).toEqual([laptop.workArea, left.workArea])
  })

  it('tiles windows side by side when there are fewer displays', () => {
    expect(arrange([laptop], 3, [1, 1, null])).toEqual([
      { x: 0, y: 0, width: 500, height: 900 },
      { x: 500, y: 0, width: 500, height: 900 },
      { x: 1000, y: 0, width: 500, height: 900 }
    ])
  })

  it('puts the extra window on the biggest display', () => {
    expect(arrange([laptop, left], 3, [1, null, null])).toEqual([
      laptop.workArea,
      { x: -2000, y: 0, width: 1000, height: 1100 },
      { x: -1000, y: 0, width: 1000, height: 1100 }
    ])
  })

  it('ignores displays that are gone', () => {
    expect(arrange([laptop], 1, [7])).toEqual([laptop.workArea])
    expect(arrange([], 2, [1, 2])).toEqual([])
  })
})

describe('findDisplay', () => {
  it('matches by id, then by a name only one display has', () => {
    expect(findDisplay([laptop, left], { id: 2, label: 'whatever' })).toBe(left)
    expect(findDisplay([laptop, left], { id: 9, label: 'DELL U2720Q' })).toBe(left)
    const twin = { ...left, id: 4 }
    expect(findDisplay([left, twin], { id: 9, label: 'DELL U2720Q' })).toBeNull()
    expect(findDisplay([laptop], undefined)).toBeNull()
  })
})

describe('fitInto', () => {
  it('moves a window back onto the area, shrinking it when it is too big', () => {
    expect(fitInto({ x: 3000, y: 50, width: 800, height: 600 }, laptop.workArea)).toEqual({
      x: 700,
      y: 50,
      width: 800,
      height: 600
    })
    expect(fitInto({ x: -50, y: -50, width: 4000, height: 600 }, laptop.workArea)).toEqual({
      x: 0,
      y: 0,
      width: 1500,
      height: 600
    })
  })
})

describe('mostlyOn', () => {
  it('needs half the window on the area', () => {
    expect(mostlyOn({ x: 1000, y: 0, width: 800, height: 600 }, laptop.workArea)).toBe(true)
    expect(mostlyOn({ x: 1200, y: 0, width: 800, height: 600 }, laptop.workArea)).toBe(false)
  })
})
