import type { Layout, LayoutNode, PaneNode, Preset } from '@shared/config'
import type { PaneSession } from '@shared/ipc'
import type { SessionInfo } from '@shared/widgets'
import type { PaneStatus } from '../agents/tracker'

function panes(node: LayoutNode): PaneNode[] {
  return node.type === 'pane' ? [node] : node.children.flatMap(panes)
}

/** What widgets may see of a session. */
export function widgetSession({ message: _message, ...info }: PaneSession): SessionInfo {
  return info
}

/** One session per pane in the layout, in tab order. A pane with no process is exited. */
export function listSessions(
  layout: Layout,
  presets: readonly Preset[],
  status: (paneId: string) => PaneStatus | null
): PaneSession[] {
  return layout.tabs.flatMap((tab) =>
    panes(tab.root).map((p) => {
      const s = status(p.id)
      return {
        id: p.id,
        tabId: tab.id,
        presetId: p.presetId,
        name: presets.find((x) => x.id === p.presetId)?.name ?? p.presetId,
        cwd: p.cwd,
        status: s?.status ?? 'exited',
        since: s?.since ?? 0,
        agent: s?.agent ?? null,
        message: s?.message ?? null,
        title: s?.title ?? null,
        tokens: s?.tokens ?? null,
        focused: tab.id === layout.activeTabId && tab.activePaneId === p.id
      }
    })
  )
}
