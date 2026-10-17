import { Fragment, useMemo, useRef, useState } from 'react'
import {
  ACTIVITY_MAX_HEIGHT,
  ACTIVITY_MIN_HEIGHT,
  SIDEBAR_MAX_WIDTH,
  SIDEBAR_MIN_WIDTH,
  type SidebarSettings
} from '@shared/config'
import type { PaneSession } from '@shared/ipc'
import type { WidgetInfo } from '@shared/widgets'
import { ActivityPanel } from '../activity/ActivityPanel'
import { SessionList } from '../components/SessionList'
import {
  activeWidgetId,
  dragPair,
  placeWidgets,
  updatePlacement,
  visibleWidgets,
  type PlacedWidget
} from './sidebarModel'
import { WidgetFrame } from './WidgetFrame'

interface Props {
  widgets: WidgetInfo[]
  sessions: PaneSession[]
  onSelectSession: (paneId: string) => void
  settings: SidebarSettings
  /** False while the window is minimized or hidden. */
  windowVisible: boolean
  onChange: (next: SidebarSettings) => void
}

/** Room the terminals keep when the sidebar is dragged wider. */
const MIN_WORKSPACE_WIDTH = 320
const MIN_WIDGET_HEIGHT = 48
/** Room the widgets keep when the Activity panel is dragged taller. */
const MIN_WIDGETS_HEIGHT = 120

function dragPointer(
  e: React.PointerEvent<HTMLElement>,
  onMove: (dx: number, dy: number) => void
): void {
  e.preventDefault()
  const target = e.currentTarget
  target.setPointerCapture(e.pointerId)
  const x0 = e.clientX
  const y0 = e.clientY
  const move = (ev: PointerEvent): void => {
    onMove(ev.clientX - x0, ev.clientY - y0)
  }
  const up = (): void => {
    target.removeEventListener('pointermove', move)
    target.removeEventListener('pointerup', up)
    target.removeEventListener('pointercancel', up)
  }
  target.addEventListener('pointermove', move)
  target.addEventListener('pointerup', up)
  target.addEventListener('pointercancel', up)
}

export function Sidebar({
  widgets,
  sessions,
  onSelectSession,
  settings,
  windowVisible,
  onChange
}: Props): React.JSX.Element {
  const placed = useMemo(() => placeWidgets(settings, widgets), [settings, widgets])
  const [reloads, setReloads] = useState<Record<string, number>>({})
  const bodyRef = useRef<HTMLDivElement>(null)
  const activityRef = useRef<HTMLElement>(null)
  const tabs = settings.mode === 'tabs'
  const active = activeWidgetId(settings, placed)
  const visibleIds = useMemo(
    () => visibleWidgets(settings, widgets, windowVisible),
    [settings, widgets, windowVisible]
  )

  const reload = (id: string): void => {
    setReloads((r) => ({ ...r, [id]: (r[id] ?? 0) + 1 }))
  }

  const startResize = (e: React.PointerEvent<HTMLDivElement>): void => {
    const start = settings.width
    const max = Math.min(SIDEBAR_MAX_WIDTH, window.innerWidth - MIN_WORKSPACE_WIDTH)
    dragPointer(e, (dx) => {
      const width = Math.round(Math.min(max, Math.max(SIDEBAR_MIN_WIDTH, start - dx)))
      onChange({ ...settings, width })
    })
  }

  const startPairDrag = (
    e: React.PointerEvent<HTMLDivElement>,
    a: PlacedWidget,
    b: PlacedWidget
  ): void => {
    const el = (id: string): HTMLElement | null | undefined =>
      bodyRef.current?.querySelector<HTMLElement>(`[data-widget="${CSS.escape(id)}"]`)
    const heights: [number, number] = [
      el(a.info.id)?.offsetHeight ?? 0,
      el(b.info.id)?.offsetHeight ?? 0
    ]
    const sizes: [number, number] = [a.placement.size, b.placement.size]
    dragPointer(e, (_dx, dy) => {
      const [sa, sb] = dragPair(sizes, heights, dy, MIN_WIDGET_HEIGHT)
      onChange(
        updatePlacement(updatePlacement(settings, a.info.id, { size: sa }), b.info.id, { size: sb })
      )
    })
  }

  const fills = (p: PlacedWidget | undefined): p is PlacedWidget =>
    !!p && !p.placement.collapsed && p.info.manifest?.sizing !== 'content'

  // The Activity panel follows the focused pane. It has a height of its own
  // while widgets share the sidebar, and takes all the room when none would.
  const focused = sessions.find((s) => s.focused) ?? null
  const activity = settings.activity
  const widgetsFill = placed.length > 0 && (tabs || placed.some(fills))
  const activityOpen = !!focused && !activity.collapsed
  const activitySized = activityOpen && widgetsFill
  const activityStyle: React.CSSProperties = !activityOpen
    ? { flex: 'none' }
    : activitySized
      ? { flex: `0 1 ${String(activity.height)}px`, minHeight: ACTIVITY_MIN_HEIGHT }
      : { flex: '1 1 0px', minHeight: 0 }

  const startActivityResize = (e: React.PointerEvent<HTMLDivElement>): void => {
    const start = activityRef.current?.offsetHeight ?? activity.height
    const room = start + (bodyRef.current?.offsetHeight ?? 0) - MIN_WIDGETS_HEIGHT
    dragPointer(e, (_dx, dy) => {
      const height = Math.round(
        Math.max(ACTIVITY_MIN_HEIGHT, Math.min(room, ACTIVITY_MAX_HEIGHT, start + dy))
      )
      onChange({ ...settings, activity: { ...activity, height } })
    })
  }

  return (
    <aside
      className={`sidebar ${tabs ? 'tabs' : 'stack'}${settings.visible ? '' : ' hidden'}`}
      style={{ width: settings.width }}
      aria-label="Widgets"
    >
      <div className="sidebar-resize" onPointerDown={startResize} />
      <SessionList
        sessions={sessions}
        collapsed={settings.sessionsCollapsed}
        onToggle={() => onChange({ ...settings, sessionsCollapsed: !settings.sessionsCollapsed })}
        onSelect={onSelectSession}
        onHideSidebar={() => onChange({ ...settings, visible: false })}
      />
      {focused && (
        <ActivityPanel
          session={focused}
          settings={activity}
          onChange={(next) => onChange({ ...settings, activity: next })}
          visible={windowVisible && settings.visible}
          style={activityStyle}
          sectionRef={activityRef}
        />
      )}
      {activitySized && <div className="widget-divider" onPointerDown={startActivityResize} />}
      {placed.length > 0 && (
        <div className="sidebar-head">
          {tabs ? (
            <div className="sidebar-tabs" role="tablist">
              {placed.map((p) => (
                <button
                  type="button"
                  tabIndex={-1}
                  role="tab"
                  key={p.info.id}
                  aria-selected={p.info.id === active}
                  className={p.info.id === active ? 'on' : ''}
                  onClick={() => onChange({ ...settings, activeWidget: p.info.id })}
                >
                  {p.info.manifest?.name ?? p.info.id}
                </button>
              ))}
            </div>
          ) : (
            <span className="sidebar-title">Widgets</span>
          )}
          {tabs && active && (
            <button
              type="button"
              tabIndex={-1}
              className="icon"
              title="Reload widget"
              onClick={() => reload(active)}
            >
              ↻
            </button>
          )}
          <button
            type="button"
            tabIndex={-1}
            className="icon"
            title={tabs ? 'Show widgets stacked' : 'Show widgets as tabs'}
            onClick={() => onChange({ ...settings, mode: tabs ? 'stack' : 'tabs' })}
          >
            {tabs ? '☰' : '⧉'}
          </button>
        </div>
      )}
      <div
        className="sidebar-body"
        ref={bodyRef}
        style={
          activitySized
            ? { minHeight: MIN_WIDGETS_HEIGHT }
            : activityOpen
              ? { flex: 'none' }
              : undefined
        }
      >
        {placed.map((p, i) => {
          const { info, placement } = p
          const { manifest } = info
          const collapsed = !tabs && placement.collapsed
          const shown = tabs ? info.id === active : true
          const visible = visibleIds.has(info.id)
          const content = manifest?.sizing === 'content'
          const style: React.CSSProperties = tabs
            ? { flex: '1 1 0px' }
            : collapsed || content
              ? { flex: 'none' }
              : { flex: `${placement.size} 1 0px`, minHeight: MIN_WIDGET_HEIGHT }
          const next = placed[i + 1]
          // Keyed by widget, so removing or reordering one doesn't remount
          // (and reload) the widgets after it.
          return (
            <Fragment key={info.id}>
              <section
                data-widget={info.id}
                className={`widget${collapsed ? ' collapsed' : ''}${shown ? '' : ' hidden'}`}
                style={style}
              >
                {!tabs && (
                  <header className="widget-head">
                    <button
                      type="button"
                      tabIndex={-1}
                      className="widget-toggle"
                      aria-expanded={!collapsed}
                      title={collapsed ? 'Expand' : 'Collapse'}
                      onClick={() =>
                        onChange(updatePlacement(settings, info.id, { collapsed: !collapsed }))
                      }
                    >
                      {collapsed ? '▸' : '▾'}
                    </button>
                    <span className="widget-name" title={info.dir}>
                      {manifest?.name ?? info.id}
                    </span>
                    <button
                      type="button"
                      tabIndex={-1}
                      className="icon"
                      title="Reload widget"
                      onClick={() => reload(info.id)}
                    >
                      ↻
                    </button>
                  </header>
                )}
                <div className="widget-body">
                  {manifest ? (
                    <WidgetFrame
                      key={`${info.revision}:${reloads[info.id] ?? 0}`}
                      id={info.id}
                      manifest={manifest}
                      visible={visible}
                    />
                  ) : (
                    <div className="widget-error">
                      <strong>{info.id} could not be loaded</strong>
                      <p>{info.error}</p>
                      <p className="widget-dir">{info.dir}</p>
                    </div>
                  )}
                </div>
              </section>
              {!tabs && fills(p) && fills(next) && (
                <div className="widget-divider" onPointerDown={(e) => startPairDrag(e, p, next)} />
              )}
            </Fragment>
          )
        })}
      </div>
    </aside>
  )
}
