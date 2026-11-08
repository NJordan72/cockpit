import { useMemo, useRef } from 'react'
import type { ITheme } from '@xterm/xterm'
import type { Layout, Preset, TerminalSettings } from '@shared/config'
import type { PaneLabel } from '@shared/widgets'
import { allPanes, arrange, dragSizes, findSplit, type Divider } from '../layout/model'
import type { LayoutAction } from '../layout/reducer'
import { TerminalPane } from '../terminal/TerminalPane'
import { WebPane } from '../web/WebPane'

interface Props {
  layout: Layout
  presets: Preset[]
  settings: TerminalSettings
  theme: ITheme
  /** Widgets' labels by pane id. */
  labels: ReadonlyMap<string, PaneLabel[]>
  dispatch: (a: LayoutAction) => void
}

const pct = (n: number): string => `${(n * 100).toFixed(4)}%`

/**
 * Every pane of every tab is rendered here as a flat, keyed list positioned
 * from the split tree. Splitting or closing a neighbour only moves a pane; it
 * never remounts it, so its terminal and PTY survive layout changes.
 */
export function Workspace({
  layout,
  presets,
  settings,
  theme,
  labels,
  dispatch
}: Props): React.JSX.Element {
  const ref = useRef<HTMLDivElement>(null)

  // Sorted by pane id so the order never follows the tabs. React moves keyed
  // siblings that change order, and moving a <webview> reloads its page, so
  // reordering tabs mustn't reorder the panes.
  const placed = useMemo(
    () =>
      layout.tabs
        .flatMap((tab) => {
          const { panes } = arrange(tab.root)
          return allPanes(tab.root).map((pane) => ({
            tab,
            pane,
            rect: panes.get(pane.id) ?? { x: 0, y: 0, w: 1, h: 1 }
          }))
        })
        .sort((a, b) => (a.pane.id < b.pane.id ? -1 : 1)),
    [layout.tabs]
  )

  const active = layout.tabs.find((t) => t.id === layout.activeTabId)
  const dividers = useMemo(() => (active ? arrange(active.root).dividers : []), [active])

  const startDrag = (d: Divider, e: React.PointerEvent<HTMLDivElement>): void => {
    const host = ref.current
    if (!host || !active) return
    e.preventDefault()
    const target = e.currentTarget
    target.setPointerCapture(e.pointerId)
    const box = host.getBoundingClientRect()
    const move = (ev: PointerEvent): void => {
      const split = findSplit(active.root, d.splitId)
      if (!split) return
      const pos =
        d.direction === 'row'
          ? (ev.clientX - box.left) / box.width
          : (ev.clientY - box.top) / box.height
      dispatch({
        type: 'resize',
        splitId: d.splitId,
        sizes: dragSizes(split, d.splitRect, d.index, pos)
      })
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

  return (
    <div className="workspace" ref={ref}>
      {placed.map(({ tab, pane, rect }) => {
        const visible = tab.id === layout.activeTabId
        const multi = tab.root.type === 'split'
        return (
          <div
            key={pane.id}
            className="pane-slot"
            style={{
              left: pct(rect.x),
              top: pct(rect.y),
              width: pct(rect.w),
              height: pct(rect.h),
              display: visible ? 'block' : 'none'
            }}
          >
            {pane.url ? (
              <WebPane
                pane={{ ...pane, url: pane.url }}
                focused={tab.activePaneId === pane.id && (multi || visible)}
                visible={visible}
                onFocus={() => dispatch({ type: 'focusPane', paneId: pane.id })}
                onPage={(url, title) => dispatch({ type: 'setPage', paneId: pane.id, url, title })}
              />
            ) : (
              <TerminalPane
                pane={pane}
                presetName={presets.find((p) => p.id === pane.presetId)?.name ?? pane.presetId}
                settings={settings}
                theme={theme}
                focused={tab.activePaneId === pane.id && (multi || visible)}
                visible={visible}
                labels={labels.get(pane.id)}
                onFocus={() => dispatch({ type: 'focusPane', paneId: pane.id })}
                onStarted={(cwd) => dispatch({ type: 'setCwd', paneId: pane.id, cwd })}
              />
            )}
          </div>
        )
      })}
      {dividers.map((d) => {
        const r = d.splitRect
        const style: React.CSSProperties =
          d.direction === 'row'
            ? { left: pct(d.at), top: pct(r.y), height: pct(r.h) }
            : { top: pct(d.at), left: pct(r.x), width: pct(r.w) }
        return (
          <div
            key={`${d.splitId}:${d.index}`}
            className={`divider ${d.direction}`}
            style={style}
            onPointerDown={(e) => startDrag(d, e)}
          />
        )
      })}
    </div>
  )
}
