import { MAX_TAB_NAME, type Layout, type PaneNode, type Tab, type TabColor } from '@shared/config'
import {
  allPanes,
  arrange,
  findPane,
  findSplit,
  neighbor,
  newId,
  removePane,
  renamePane,
  setSizes,
  splitPane,
  updatePane,
  type Direction
} from './model'

/**
 * `shown` lists the ids of the tabs the tab bar shows, in the bar's order.
 * Without `shown`, every tab counts as shown.
 */
export type LayoutAction =
  | { type: 'replace'; layout: Layout }
  | { type: 'newTab'; pane: PaneNode; background?: boolean }
  | { type: 'split'; paneId: string; direction: 'row' | 'column'; pane: PaneNode }
  | { type: 'closePane'; paneId: string; shown?: readonly string[] }
  | { type: 'clearPane'; paneId: string; resume?: boolean }
  | { type: 'closeTab'; tabId: string; shown?: readonly string[] }
  | { type: 'focusPane'; paneId: string }
  | { type: 'focusDirection'; direction: Direction }
  | { type: 'selectTab'; tabId: string }
  | { type: 'selectTabIndex'; index: number; shown?: readonly string[] }
  | { type: 'cycleTab'; delta: number; shown?: readonly string[] }
  | { type: 'moveTab'; tabId: string; index: number }
  | { type: 'renameTab'; tabId: string; name: string }
  | { type: 'colorTab'; tabId: string; color: TabColor | null }
  | { type: 'pinTab'; tabId: string; pinned: boolean }
  | { type: 'resize'; splitId: string; sizes: number[] }
  | { type: 'setCwd'; paneId: string; cwd: string }
  | { type: 'setPage'; paneId: string; url: string; title?: string }
  | { type: 'setPrTitle'; paneId: string; title: string }

export function activeTab(layout: Layout): Tab | null {
  return layout.tabs.find((t) => t.id === layout.activeTabId) ?? null
}

export function tabOfPane(layout: Layout, paneId: string): Tab | null {
  return layout.tabs.find((t) => findPane(t.root, paneId)) ?? null
}

function mapTab(layout: Layout, tabId: string, fn: (t: Tab) => Tab): Layout {
  return { ...layout, tabs: layout.tabs.map((t) => (t.id === tabId ? fn(t) : t)) }
}

/** How many tabs come before the pinned ones. */
const unpinnedCount = (tabs: readonly Tab[]): number => tabs.filter((t) => !t.pinned).length

/** Pinned tabs after the others, each group in the order it was in. */
const pinnedLast = (tabs: Tab[]): Tab[] =>
  tabs.sort((a, b) => Number(a.pinned === true) - Number(b.pinned === true))

export function layoutReducer(layout: Layout, action: LayoutAction): Layout {
  switch (action.type) {
    case 'replace':
      return action.layout

    case 'newTab': {
      // After the active tab, or after the last tab that isn't pinned.
      const tab: Tab = { id: newId('tab'), root: action.pane, activePaneId: action.pane.id }
      const idx = layout.tabs.findIndex((t) => t.id === layout.activeTabId && !t.pinned)
      const tabs = [...layout.tabs]
      tabs.splice(idx === -1 ? unpinnedCount(tabs) : idx + 1, 0, tab)
      return { ...layout, tabs, activeTabId: action.background ? layout.activeTabId : tab.id }
    }

    case 'split': {
      const tab = tabOfPane(layout, action.paneId)
      if (!tab) return layout
      return mapTab(layout, tab.id, (t) => ({
        ...t,
        root: splitPane(t.root, action.paneId, action.direction, action.pane),
        activePaneId: action.pane.id
      }))
    }

    case 'closePane': {
      const tab = tabOfPane(layout, action.paneId)
      if (!tab) return layout
      const root = removePane(tab.root, action.paneId)
      if (!root)
        return layoutReducer(layout, { type: 'closeTab', tabId: tab.id, shown: action.shown })
      let activePaneId = tab.activePaneId
      if (activePaneId === action.paneId) {
        // Move focus to the pane that took the closed one's space.
        const before = arrange(tab.root).panes
        const remaining = new Set(allPanes(root).map((p) => p.id))
        const near = (['left', 'up', 'right', 'down'] as const)
          .map((d) => neighbor(before, action.paneId, d))
          .find((id): id is string => id !== null && remaining.has(id))
        activePaneId = near ?? allPanes(root)[0]?.id ?? activePaneId
      }
      return mapTab(layout, tab.id, (t) => ({ ...t, root, activePaneId }))
    }

    case 'clearPane': {
      // A new id remounts the terminal: the old process is killed, everything
      // main kept about it is dropped, and the preset starts again.
      const tab = tabOfPane(layout, action.paneId)
      if (!tab) return layout
      const id = newId('pane')
      const root = renamePane(tab.root, action.paneId, id)
      return mapTab(layout, tab.id, (t) => ({
        ...t,
        root: action.resume ? updatePane(root, id, { resume: true }) : root,
        activePaneId: t.activePaneId === action.paneId ? id : t.activePaneId
      }))
    }

    case 'closeTab': {
      const idx = layout.tabs.findIndex((t) => t.id === action.tabId)
      if (idx === -1) return layout
      const tabs = layout.tabs.filter((t) => t.id !== action.tabId)
      if (layout.activeTabId !== action.tabId) return { ...layout, tabs }
      // The shown tab that takes its place, or the one before it at the end.
      const shown = action.shown ? new Set(action.shown) : null
      const isShown = (t: Tab): boolean => !shown || shown.has(t.id)
      const next =
        tabs.slice(idx).find(isShown) ??
        tabs.slice(0, idx).findLast(isShown) ??
        tabs[Math.min(idx, tabs.length - 1)]
      return { ...layout, tabs, activeTabId: next?.id ?? null }
    }

    case 'focusPane': {
      const tab = tabOfPane(layout, action.paneId)
      if (!tab) return layout
      if (tab.activePaneId === action.paneId && layout.activeTabId === tab.id) return layout
      return {
        ...mapTab(layout, tab.id, (t) => ({ ...t, activePaneId: action.paneId })),
        activeTabId: tab.id
      }
    }

    case 'focusDirection': {
      const tab = activeTab(layout)
      if (!tab) return layout
      const next = neighbor(arrange(tab.root).panes, tab.activePaneId, action.direction)
      return next ? mapTab(layout, tab.id, (t) => ({ ...t, activePaneId: next })) : layout
    }

    case 'selectTab':
      return layout.tabs.some((t) => t.id === action.tabId)
        ? { ...layout, activeTabId: action.tabId }
        : layout

    case 'selectTabIndex': {
      const id = action.shown ? action.shown[action.index] : layout.tabs[action.index]?.id
      return id !== undefined && layout.tabs.some((t) => t.id === id)
        ? { ...layout, activeTabId: id }
        : layout
    }

    case 'cycleTab': {
      const ids = action.shown ?? layout.tabs.map((t) => t.id)
      const n = ids.length
      if (n === 0) return layout
      const idx = ids.indexOf(layout.activeTabId ?? '')
      const next =
        idx === -1 ? ids[action.delta > 0 ? 0 : n - 1] : ids[(((idx + action.delta) % n) + n) % n]
      return next !== undefined && layout.tabs.some((t) => t.id === next)
        ? { ...layout, activeTabId: next }
        : layout
    }

    case 'moveTab': {
      // `index` is the tab's position once it has moved.
      const tab = layout.tabs.find((t) => t.id === action.tabId)
      if (!tab) return layout
      // A tab stays with the pinned tabs or with the others.
      const tabs = layout.tabs.filter((t) => t !== tab)
      tabs.splice(Math.max(0, Math.min(action.index, tabs.length)), 0, tab)
      pinnedLast(tabs)
      return tabs.every((t, i) => t === layout.tabs[i]) ? layout : { ...layout, tabs }
    }

    case 'renameTab': {
      // An empty name goes back to the preset and folder.
      const name = action.name.trim().slice(0, MAX_TAB_NAME)
      return mapTab(layout, action.tabId, (t) => {
        const next: Tab = { ...t, name }
        if (!name) delete next.name
        return next
      })
    }

    case 'colorTab':
      return mapTab(layout, action.tabId, (t) => {
        const next: Tab = { ...t }
        if (action.color) next.color = action.color
        else delete next.color
        return next
      })

    case 'pinTab': {
      // Pinning puts a tab at the right end; unpinning puts it just before the pinned tabs.
      const tab = layout.tabs.find((t) => t.id === action.tabId)
      if (!tab || (tab.pinned === true) === action.pinned) return layout
      const moved: Tab = { ...tab, pinned: true }
      if (!action.pinned) delete moved.pinned
      const tabs = layout.tabs.filter((t) => t !== tab)
      tabs.splice(action.pinned ? tabs.length : unpinnedCount(tabs), 0, moved)
      return { ...layout, tabs }
    }

    case 'resize': {
      const tab = layout.tabs.find((t) => findSplit(t.root, action.splitId))
      if (!tab) return layout
      return mapTab(layout, tab.id, (t) => ({
        ...t,
        root: setSizes(t.root, action.splitId, action.sizes)
      }))
    }

    case 'setCwd': {
      // The pane has started, so a restart from here opens a new session.
      const tab = tabOfPane(layout, action.paneId)
      const pane = tab && findPane(tab.root, action.paneId)
      if (!tab || !pane || (pane.cwd === action.cwd && !pane.resume && !pane.prompt)) return layout
      return mapTab(layout, tab.id, (t) => ({
        ...t,
        root: updatePane(t.root, action.paneId, {
          cwd: action.cwd,
          resume: undefined,
          prompt: undefined
        })
      }))
    }

    case 'setPage': {
      // A web pane went to another page; a relaunch reopens it there.
      const tab = tabOfPane(layout, action.paneId)
      const pane = tab && findPane(tab.root, action.paneId)
      if (!tab || !pane?.url) return layout
      if (pane.url === action.url && pane.title === action.title) return layout
      return mapTab(layout, tab.id, (t) => ({
        ...t,
        root: updatePane(t.root, action.paneId, { url: action.url, title: action.title })
      }))
    }

    case 'setPrTitle': {
      // Kept so the tab is named before the pull request is read again after a relaunch.
      const tab = tabOfPane(layout, action.paneId)
      const pane = tab && findPane(tab.root, action.paneId)
      if (!tab || !pane?.pr || pane.title === action.title) return layout
      return mapTab(layout, tab.id, (t) => ({
        ...t,
        root: updatePane(t.root, action.paneId, { title: action.title })
      }))
    }
  }
}
