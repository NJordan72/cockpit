import type { Layout, LayoutNode, PaneNode, Preset } from '@shared/config'
import type { SessionInfo } from '@shared/widgets'

function panes(node: LayoutNode): PaneNode[] {
  return node.type === 'pane' ? [node] : node.children.flatMap(panes)
}

/** One session per pane in the layout, in tab order. */
export function listSessions(
  layout: Layout,
  presets: readonly Preset[],
  livePanes: ReadonlySet<string>
): SessionInfo[] {
  return layout.tabs.flatMap((tab) =>
    panes(tab.root).map((p) => ({
      id: p.id,
      tabId: tab.id,
      presetId: p.presetId,
      name: presets.find((x) => x.id === p.presetId)?.name ?? p.presetId,
      cwd: p.cwd,
      status: livePanes.has(p.id) ? 'running' : 'exited',
      focused: tab.id === layout.activeTabId && tab.activePaneId === p.id
    }))
  )
}
