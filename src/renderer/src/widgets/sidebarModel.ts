import type { SidebarSettings, WidgetPlacement } from '@shared/config'
import type { WidgetInfo } from '@shared/widgets'

export interface PlacedWidget {
  info: WidgetInfo
  placement: WidgetPlacement
}

const newPlacement = (id: string): WidgetPlacement => ({ id, collapsed: false, size: 1 })

/** Installed widgets in sidebar order: placed ones first, then any new ones. */
export function placeWidgets(settings: SidebarSettings, installed: WidgetInfo[]): PlacedWidget[] {
  const byId = new Map(installed.map((w) => [w.id, w]))
  const placed: PlacedWidget[] = []
  for (const placement of settings.widgets) {
    const info = byId.get(placement.id)
    if (!info) continue
    placed.push({ info, placement })
    byId.delete(placement.id)
  }
  for (const info of byId.values()) placed.push({ info, placement: newPlacement(info.id) })
  return placed
}

/**
 * Settings with a placement for every installed widget, so new widgets show
 * up in config.json. Placements of uninstalled widgets are kept in case they
 * come back. Returns the same object when nothing was missing.
 */
export function withPlacements(
  settings: SidebarSettings,
  installed: WidgetInfo[]
): SidebarSettings {
  const known = new Set(settings.widgets.map((w) => w.id))
  const missing = installed.filter((w) => !known.has(w.id))
  if (missing.length === 0) return settings
  return { ...settings, widgets: [...settings.widgets, ...missing.map((w) => newPlacement(w.id))] }
}

export function updatePlacement(
  settings: SidebarSettings,
  id: string,
  patch: Partial<Omit<WidgetPlacement, 'id'>>
): SidebarSettings {
  const has = settings.widgets.some((w) => w.id === id)
  const widgets = has
    ? settings.widgets.map((w) => (w.id === id ? { ...w, ...patch } : w))
    : [...settings.widgets, { ...newPlacement(id), ...patch }]
  return { ...settings, widgets }
}

/** The widget shown in tabs mode. */
export function activeWidgetId(settings: SidebarSettings, placed: PlacedWidget[]): string | null {
  const wanted = settings.activeWidget
  if (wanted && placed.some((p) => p.info.id === wanted)) return wanted
  return placed[0]?.info.id ?? null
}

/**
 * Two neighbouring widgets share `heights` pixels in proportion to `sizes`.
 * Moving the divider between them by dy gives these new sizes, keeping each
 * at least minPx tall and their sum unchanged.
 */
export function dragPair(
  sizes: [number, number],
  heights: [number, number],
  dy: number,
  minPx: number
): [number, number] {
  const total = heights[0] + heights[1]
  const sum = sizes[0] + sizes[1]
  if (total <= 0) return sizes
  const lo = Math.min(minPx, total / 2)
  const first = Math.min(total - lo, Math.max(lo, heights[0] + dy))
  const a = (sum * first) / total
  return [a, sum - a]
}
