import type { Layout, PaneNode, Tab } from '@shared/config'
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

export type LayoutAction =
  | { type: 'replace'; layout: Layout }
  | { type: 'newTab'; pane: PaneNode }
  | { type: 'split'; paneId: string; direction: 'row' | 'column'; pane: PaneNode }
  | { type: 'closePane'; paneId: string }
  | { type: 'clearPane'; paneId: string; resume?: boolean }
  | { type: 'closeTab'; tabId: string }
  | { type: 'focusPane'; paneId: string }
  | { type: 'focusDirection'; direction: Direction }
  | { type: 'selectTab'; tabId: string }
  | { type: 'selectTabIndex'; index: number }
  | { type: 'cycleTab'; delta: number }
  | { type: 'moveTab'; tabId: string; index: number }
  | { type: 'resize'; splitId: string; sizes: number[] }
  | { type: 'setCwd'; paneId: string; cwd: string }
  | { type: 'setPage'; paneId: string; url: string; title?: string }

export function activeTab(layout: Layout): Tab | null {
  return layout.tabs.find((t) => t.id === layout.activeTabId) ?? null
}

export function tabOfPane(layout: Layout, paneId: string): Tab | null {
  return layout.tabs.find((t) => findPane(t.root, paneId)) ?? null
}

function mapTab(layout: Layout, tabId: string, fn: (t: Tab) => Tab): Layout {
  return { ...layout, tabs: layout.tabs.map((t) => (t.id === tabId ? fn(t) : t)) }
}

export function layoutReducer(layout: Layout, action: LayoutAction): Layout {
  switch (action.type) {
    case 'replace':
      return action.layout

    case 'newTab': {
      const tab: Tab = { id: newId('tab'), root: action.pane, activePaneId: action.pane.id }
      const idx = layout.tabs.findIndex((t) => t.id === layout.activeTabId)
      const tabs = [...layout.tabs]
      tabs.splice(idx === -1 ? tabs.length : idx + 1, 0, tab)
      return { tabs, activeTabId: tab.id }
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
      if (!root) return layoutReducer(layout, { type: 'closeTab', tabId: tab.id })
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
      const activeTabId =
        layout.activeTabId === action.tabId
          ? (tabs[Math.min(idx, tabs.length - 1)]?.id ?? null)
          : layout.activeTabId
      return { tabs, activeTabId }
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
      const tab = layout.tabs[action.index]
      return tab ? { ...layout, activeTabId: tab.id } : layout
    }

    case 'cycleTab': {
      const n = layout.tabs.length
      if (n === 0) return layout
      const idx = layout.tabs.findIndex((t) => t.id === layout.activeTabId)
      const next = layout.tabs[(((idx + action.delta) % n) + n) % n]
      return next ? { ...layout, activeTabId: next.id } : layout
    }

    case 'moveTab': {
      // `index` is the tab's position once it has moved.
      const tab = layout.tabs.find((t) => t.id === action.tabId)
      if (!tab) return layout
      const tabs = layout.tabs.filter((t) => t !== tab)
      tabs.splice(Math.max(0, Math.min(action.index, tabs.length)), 0, tab)
      return tabs.every((t, i) => t === layout.tabs[i]) ? layout : { ...layout, tabs }
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
  }
}
