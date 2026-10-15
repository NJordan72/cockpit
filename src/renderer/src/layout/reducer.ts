import type { Layout, PaneNode, Tab } from '@shared/config'
import {
  allPanes,
  arrange,
  findPane,
  findSplit,
  neighbor,
  newId,
  removePane,
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
  | { type: 'closeTab'; tabId: string }
  | { type: 'focusPane'; paneId: string }
  | { type: 'focusDirection'; direction: Direction }
  | { type: 'selectTab'; tabId: string }
  | { type: 'selectTabIndex'; index: number }
  | { type: 'cycleTab'; delta: number }
  | { type: 'resize'; splitId: string; sizes: number[] }
  | { type: 'setCwd'; paneId: string; cwd: string }

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

    case 'resize': {
      const tab = layout.tabs.find((t) => findSplit(t.root, action.splitId))
      if (!tab) return layout
      return mapTab(layout, tab.id, (t) => ({
        ...t,
        root: setSizes(t.root, action.splitId, action.sizes)
      }))
    }

    case 'setCwd': {
      const tab = tabOfPane(layout, action.paneId)
      if (!tab || findPane(tab.root, action.paneId)?.cwd === action.cwd) return layout
      return mapTab(layout, tab.id, (t) => ({
        ...t,
        root: updatePane(t.root, action.paneId, { cwd: action.cwd })
      }))
    }
  }
}
