// Where windows go on the displays. Pure: plain rectangles in and out, so it
// can be tested without Electron's screen module.
import type { WindowBounds, WindowDisplay } from '@shared/config'

export type Rect = WindowBounds

export interface DisplayInfo {
  id: number
  label: string
  /** The display minus the menu bar and the Dock, in screen points. */
  workArea: Rect
}

/** Left to right, then top to bottom: how the displays sit on the desk. */
export function byPosition<D extends DisplayInfo>(displays: readonly D[]): D[] {
  return [...displays].sort((a, b) => a.workArea.x - b.workArea.x || a.workArea.y - b.workArea.y)
}

/**
 * The display a saved window belongs on: the one with its id, or else the only
 * one with its name (ids can change when a display is plugged back in).
 */
export function findDisplay<D extends DisplayInfo>(
  displays: readonly D[],
  saved: WindowDisplay | undefined
): D | null {
  if (!saved) return null
  const byId = displays.find((d) => d.id === saved.id)
  if (byId) return byId
  const named = saved.label ? displays.filter((d) => d.label === saved.label) : []
  return named.length === 1 ? (named[0] ?? null) : null
}

/** `bounds` shrunk to fit inside `area` if it must, then moved until it's all inside. */
export function fitInto(bounds: Rect, area: Rect): Rect {
  const width = Math.min(bounds.width, area.width)
  const height = Math.min(bounds.height, area.height)
  const x = Math.min(Math.max(bounds.x, area.x), area.x + area.width - width)
  const y = Math.min(Math.max(bounds.y, area.y), area.y + area.height - height)
  return { x, y, width, height }
}

/** Whether most of `bounds` is on `area`. */
export function mostlyOn(bounds: Rect, area: Rect): boolean {
  const w = Math.min(bounds.x + bounds.width, area.x + area.width) - Math.max(bounds.x, area.x)
  const h = Math.min(bounds.y + bounds.height, area.y + area.height) - Math.max(bounds.y, area.y)
  return w > 0 && h > 0 && w * h * 2 >= bounds.width * bounds.height
}

/** `area` cut into `n` columns of equal width, left to right. */
function columns(area: Rect, n: number): Rect[] {
  return Array.from({ length: n }, (_, i) => {
    const x = area.x + Math.round((area.width * i) / n)
    const next = area.x + Math.round((area.width * (i + 1)) / n)
    return { x, y: area.y, width: next - x, height: area.height }
  })
}

/**
 * Where `count` windows go. Each gets a display of its own, filling its work
 * area, while there are enough displays; past that, windows share displays
 * side by side, the biggest display taking the extra ones. `current` is the
 * display id each open window is on, in window order: a window keeps its
 * display when it can, so going from two windows to three leaves the first
 * two where they are. Returns one rectangle per window.
 */
export function arrange(
  displays: readonly DisplayInfo[],
  count: number,
  current: readonly (number | null)[]
): Rect[] {
  const all = byPosition(displays)
  const [first] = all
  if (!first || count <= 0) return []
  // The displays to use: the ones the first windows are on, then the rest by position.
  let chosen = all
  if (count < all.length) {
    const ids: number[] = []
    for (const id of current.slice(0, count)) {
      if (id !== null && !ids.includes(id) && all.some((d) => d.id === id)) ids.push(id)
    }
    for (const d of all) if (ids.length < count && !ids.includes(d.id)) ids.push(d.id)
    chosen = all.filter((d) => ids.includes(d.id))
  }
  // How many windows each display holds.
  const per = new Map(chosen.map((d) => [d.id, Math.floor(count / chosen.length)]))
  const biggest = [...chosen].sort(
    (a, b) => b.workArea.width * b.workArea.height - a.workArea.width * a.workArea.height
  )
  for (const d of biggest.slice(0, count % chosen.length)) per.set(d.id, (per.get(d.id) ?? 0) + 1)
  const slots = new Map(chosen.map((d) => [d.id, columns(d.workArea, per.get(d.id) ?? 0)]))

  const out: (Rect | null)[] = Array.from({ length: count }, () => null)
  // Windows on a display in use take its free columns first, in order.
  for (let i = 0; i < count; i++) {
    const id = current[i]
    const free = id === null || id === undefined ? undefined : slots.get(id)
    const slot = free?.shift()
    if (slot) out[i] = slot
  }
  // Then the rest, left to right.
  const left = chosen.flatMap((d) => slots.get(d.id) ?? [])
  return out.map((r) => r ?? left.shift() ?? first.workArea)
}
