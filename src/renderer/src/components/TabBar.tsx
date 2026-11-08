import { useRef, useState } from 'react'
import {
  MAX_TAB_NAME,
  paneIds,
  TAB_COLORS,
  type Layout,
  type Preset,
  type Tab,
  type TabColor
} from '@shared/config'
import type { MenuItem } from '@shared/ipc'
import { pageLabel } from '@shared/web'
import type { SessionStatus } from '@shared/widgets'
import { dragPointer } from '../drag'
import type { KidsStatus } from '../kids/KidsMode'
import { findPane } from '../layout/model'
import type { LayoutAction } from '../layout/reducer'
import { dropIndex, folderHidden, type RepoOf, type TabFolder } from '../layout/tabs'
import { mostUrgent, STATUS_LABEL } from '../sessions'

/** Kids mode's pretend terminal, shown as the active tab while kids mode is on. */
export interface KidsTab {
  label: string
  status: KidsStatus
  exitWord: string
}

interface Props {
  layout: Layout
  /** The tabs to show, in order. */
  shown: readonly Tab[]
  /** The folders the filter can hide, and the ones it hides. */
  folders: readonly TabFolder[]
  hiddenDirs: readonly string[]
  projectsDir: string
  /** A task's worktree is in its repository's folder. */
  repoOf: RepoOf
  presets: Preset[]
  statuses: ReadonlyMap<string, SessionStatus>
  kids: KidsTab | null
  dispatch: (a: LayoutAction) => void
  onNewTab: () => void
  onCloseTab: (tabId: string) => void
  onHiddenDirs: (dirs: string[]) => void
  /** Give the keyboard back to the active pane. */
  onDone: () => void
}

const COLOR_NAMES: Record<TabColor, string> = {
  red: 'Red',
  yellow: 'Yellow',
  green: 'Green',
  cyan: 'Cyan',
  blue: 'Blue',
  magenta: 'Purple'
}

const basename = (p: string): string =>
  p === '~' ? '~' : (p.split('/').filter(Boolean).pop() ?? p)

/** A tab being dragged along its group, and the position it would drop into. */
interface TabDrag {
  pinned: boolean
  from: number
  to: number
  /** How far the tab has moved, kept inside its group. */
  dx: number
  width: number
}

/** How far a press must move before it's a drag, so a slightly shaky click stays a click. */
const DRAG_THRESHOLD_PX = 4

function FilterIcon(): React.JSX.Element {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
      <path d="M1 2h10L7 6.5V10L5 11V6.5z" fill="none" stroke="currentColor" strokeWidth="1.2" />
    </svg>
  )
}

/** The tab's name being edited in place. Enter or leaving it saves; Escape doesn't. */
function NameInput({
  initial,
  onDone
}: {
  initial: string
  onDone: (name: string | null) => void
}): React.JSX.Element {
  const done = useRef(false)
  const finish = (name: string | null): void => {
    if (done.current) return
    done.current = true
    onDone(name)
  }
  return (
    <input
      className="tab-name-input"
      defaultValue={initial}
      maxLength={MAX_TAB_NAME}
      aria-label="Tab name"
      autoFocus
      spellCheck={false}
      onFocus={(e) => e.currentTarget.select()}
      onPointerDown={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        if (e.key === 'Enter') finish(e.currentTarget.value)
        else if (e.key === 'Escape') finish(null)
      }}
      onBlur={(e) => finish(e.currentTarget.value)}
    />
  )
}

export function TabBar({
  layout,
  shown,
  folders,
  hiddenDirs,
  projectsDir,
  repoOf,
  presets,
  statuses,
  kids,
  dispatch,
  onNewTab,
  onCloseTab,
  onHiddenDirs,
  onDone
}: Props): React.JSX.Element {
  const listRef = useRef<HTMLDivElement>(null)
  const pinnedRef = useRef<HTMLDivElement>(null)
  const [drag, setDrag] = useState<TabDrag | null>(null)
  const [editing, setEditing] = useState<string | null>(null)

  const others = shown.filter((t) => !t.pinned)
  const pinned = shown.filter((t) => t.pinned)
  const hiddenCount = layout.tabs.length - shown.length

  // Pressing a tab selects it; dragging it along its group moves it. The other
  // tabs slide aside to show where it will land, and the layout changes once,
  // on release. Pinned tabs and the others are dragged within their own group.
  const press = (e: React.PointerEvent<HTMLDivElement>, tab: Tab, from: number): void => {
    dispatch({ type: 'selectTab', tabId: tab.id })
    const group = tab.pinned ? pinned : others
    const list = (tab.pinned ? pinnedRef : listRef).current
    const tabs = list?.querySelectorAll<HTMLElement>(':scope > .tab:not(.kids-tab)')
    if (e.button !== 0 || !tabs || editing === tab.id) return
    const rects = [...tabs].map((el) => el.getBoundingClientRect())
    const self = rects[from]
    const first = rects[0]
    const last = rects[rects.length - 1]
    if (!self || !first || !last) return
    const middles = rects.map((r) => r.left + r.width / 2)
    let current: TabDrag | null = null
    dragPointer(
      e,
      (dx) => {
        if (!current && Math.abs(dx) < DRAG_THRESHOLD_PX) return
        const left = Math.min(Math.max(self.left + dx, first.left), last.right - self.width)
        // Another tab swaps sides once the dragged tab's leading edge crosses
        // that tab's middle. Comparing middles would stop a wide tab from ever
        // passing a narrower tab at the end of the row.
        const right = left + self.width
        const to = middles.filter((m, i) => i !== from && (i < from ? m < left : m < right)).length
        current = { pinned: tab.pinned === true, from, to, dx: left - self.left, width: self.width }
        setDrag(current)
      },
      () => {
        setDrag(null)
        if (!current || current.to === from) return
        const ids = group.map((t) => t.id)
        dispatch({
          type: 'moveTab',
          tabId: tab.id,
          index: dropIndex(layout.tabs, ids, tab.id, current.to)
        })
      }
    )
  }

  const offset = (pinnedGroup: boolean, i: number): number => {
    if (drag?.pinned !== pinnedGroup) return 0
    if (i === drag.from) return drag.dx
    if (drag.from < i && i <= drag.to) return -drag.width
    if (drag.to <= i && i < drag.from) return drag.width
    return 0
  }

  const openTabMenu = async (e: React.MouseEvent, tab: Tab): Promise<void> => {
    e.preventDefault()
    const items: MenuItem[] = [
      { id: 'rename', label: 'Rename tab…' },
      ...(tab.name ? [{ id: 'unname', label: 'Use the automatic name' }] : []),
      {
        label: 'Color',
        submenu: [
          { id: 'color:', label: 'None', checked: !tab.color },
          { type: 'separator' },
          ...TAB_COLORS.map((c) => ({
            id: `color:${c}`,
            label: COLOR_NAMES[c],
            checked: tab.color === c
          }))
        ]
      },
      { id: 'pin', label: tab.pinned ? 'Unpin' : 'Pin to the right' },
      { type: 'separator' },
      { id: 'close', label: 'Close tab' }
    ]
    const chosen = await window.cockpit.menu(items)
    if (chosen === 'rename') {
      setEditing(tab.id)
      return
    }
    if (chosen === 'unname') dispatch({ type: 'renameTab', tabId: tab.id, name: '' })
    else if (chosen === 'pin') dispatch({ type: 'pinTab', tabId: tab.id, pinned: !tab.pinned })
    else if (chosen === 'close') {
      // The terminal of the tab that becomes active takes the keyboard by itself.
      onCloseTab(tab.id)
      return
    } else if (chosen?.startsWith('color:')) {
      const color = TAB_COLORS.find((c) => c === chosen.slice('color:'.length)) ?? null
      dispatch({ type: 'colorTab', tabId: tab.id, color })
    }
    onDone()
  }

  const openFilter = async (): Promise<void> => {
    const hidden = new Set(hiddenDirs)
    const showing = folders.filter((f) => !hidden.has(f.dir)).length
    const items: MenuItem[] = [
      { id: 'all', label: 'Show all tabs', enabled: hidden.size > 0 },
      { type: 'separator' },
      // Unchecking the last folder that shows would leave the bar empty.
      ...folders.map((f, i) => ({
        id: `toggle:${i}`,
        label: `${f.dir} — ${f.tabs} ${f.tabs === 1 ? 'tab' : 'tabs'}`,
        checked: !hidden.has(f.dir),
        enabled: hidden.has(f.dir) || showing > 1
      })),
      { type: 'separator' },
      {
        label: 'Show only',
        submenu: folders.map((f, i) => ({ id: `only:${i}`, label: f.dir }))
      }
    ]
    const chosen = await window.cockpit.menu(items)
    const [kind, n] = chosen?.split(':') ?? []
    const folder = folders[Number(n)]
    // onHiddenDirs gives the keyboard back itself, since it may change the active tab.
    if (chosen === 'all') onHiddenDirs([])
    else if (kind === 'toggle' && folder) {
      onHiddenDirs(
        hidden.has(folder.dir)
          ? hiddenDirs.filter((d) => d !== folder.dir)
          : [...hiddenDirs, folder.dir]
      )
    } else if (kind === 'only' && folder) {
      onHiddenDirs(folders.filter((f) => f !== folder).map((f) => f.dir))
    } else onDone()
  }

  const renderTab = (tab: Tab, i: number): React.JSX.Element => {
    const pane = findPane(tab.root, tab.activePaneId)
    const preset = presets.find((p) => p.id === pane?.presetId)
    const auto = !pane
      ? 'Tab'
      : pane.url
        ? (pane.title ?? pageLabel(pane.url))
        : pane.pr
          ? `#${String(pane.pr.number)}${pane.title ? ` ${pane.title}` : ''}`
          : `${preset?.name ?? pane.presetId} · ${basename(pane.cwd)}`
    const active = !kids && tab.id === layout.activeTabId
    const index = shown.indexOf(tab)
    const dx = offset(tab.pinned === true, i)
    // The most urgent status among the tab's panes. Idle is the normal
    // state and gets no badge.
    const status = mostUrgent(
      paneIds(tab.root).flatMap((id) => {
        const s = statuses.get(id)
        return s ? [s] : []
      })
    )
    // The active tab shows even when the filter hides its folder.
    const filtered = folderHidden(tab, hiddenDirs, projectsDir, repoOf)
    const title = [
      tab.name ? auto : null,
      status ? (pane?.cwd ?? '') : (pane?.url ?? (pane?.pr ? pane.pr.repo : (pane?.cwd ?? ''))),
      status ? STATUS_LABEL[status] : null,
      filtered ? 'its folder is hidden' : null
    ]
      .filter(Boolean)
      .join(' · ')
    const dragging = drag?.pinned === (tab.pinned === true) && drag.from === i
    const style: Record<string, string> = {}
    if (dx) style.transform = `translateX(${dx}px)`
    if (tab.color) style['--tab-color'] = `var(--${tab.color})`
    return (
      <div
        key={tab.id}
        role="tab"
        aria-selected={active}
        className={`tab${active ? ' active' : ''}${dragging ? ' dragging' : ''}${tab.pinned ? ' pinned' : ''}${filtered ? ' filtered' : ''}`}
        style={style}
        title={title}
        data-status={status ?? undefined}
        data-color={tab.color}
        onPointerDown={(e) => press(e, tab, i)}
        onDoubleClick={() => setEditing(tab.id)}
        onContextMenu={(e) => void openTabMenu(e, tab)}
      >
        <span className="tab-index">{index < 9 ? index + 1 : ''}</span>
        {status && status !== 'idle' && (
          <span className={`status-dot ${status}`} aria-label={STATUS_LABEL[status]} />
        )}
        {editing === tab.id ? (
          <NameInput
            initial={tab.name ?? auto}
            onDone={(name) => {
              setEditing(null)
              // Saving the automatic label unchanged doesn't set a name.
              if (name !== null && name.trim() !== (tab.name ?? auto)) {
                dispatch({ type: 'renameTab', tabId: tab.id, name })
              }
              onDone()
            }}
          />
        ) : (
          <span className="tab-label">{tab.name ?? auto}</span>
        )}
        {!tab.pinned && (
          <button
            type="button"
            tabIndex={-1}
            className="tab-close"
            aria-label="Close tab"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={() => onCloseTab(tab.id)}
          >
            ×
          </button>
        )}
      </div>
    )
  }

  return (
    <div className="titlebar">
      <div
        className={`tabs${drag && !drag.pinned ? ' reordering' : ''}`}
        role="tablist"
        ref={listRef}
      >
        {others.map(renderTab)}
        {kids ? (
          <div role="tab" aria-selected className="tab active kids-tab">
            <span className="tab-index">{shown.length < 9 ? shown.length + 1 : ''}</span>
            {kids.status !== 'idle' && <span className={`status-dot ${kids.status}`} />}
            <span className="tab-label">{kids.label}</span>
          </div>
        ) : (
          <button
            type="button"
            tabIndex={-1}
            className="tab-new"
            aria-label="New tab"
            onClick={onNewTab}
          >
            +
          </button>
        )}
      </div>
      {(folders.length > 1 || hiddenDirs.length > 0) && (
        <button
          type="button"
          tabIndex={-1}
          className={`tab-filter${hiddenCount > 0 ? ' on' : ''}`}
          aria-label="Filter tabs by folder"
          title={
            hiddenCount > 0
              ? `${hiddenCount} ${hiddenCount === 1 ? 'tab' : 'tabs'} hidden by folder`
              : 'Show or hide tabs by folder'
          }
          onClick={() => void openFilter()}
        >
          <FilterIcon />
          {hiddenCount > 0 && <span>{hiddenCount} hidden</span>}
        </button>
      )}
      <div className="titlebar-space" />
      {kids && (
        <span className="kids-hint">
          type <b>{kids.exitWord}</b> to leave
        </span>
      )}
      {pinned.length > 0 && (
        <div
          className={`tabs tabs-pinned${drag?.pinned ? ' reordering' : ''}`}
          role="tablist"
          aria-label="Pinned tabs"
          ref={pinnedRef}
        >
          {pinned.map(renderTab)}
        </div>
      )}
    </div>
  )
}
