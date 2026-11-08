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

/** What main knows about each pane beyond the layout. */
export interface PaneLookup {
  status: (paneId: string) => PaneStatus | null
  branch: (paneId: string) => string | null
}

/** The active tab's focused pane. */
function activePane(layout: Layout): string | null {
  return layout.tabs.find((t) => t.id === layout.activeTabId)?.activePaneId ?? null
}

/**
 * One session per terminal pane in the layout, in tab order. A pane with no
 * process is exited. Web panes run nothing, so they aren't sessions. With
 * several windows, `layout` holds all their tabs and `focused` names the pane
 * the user last worked in.
 */
export function listSessions(
  layout: Layout,
  presets: readonly Preset[],
  lookup: PaneLookup,
  focused: string | null = activePane(layout)
): PaneSession[] {
  return layout.tabs.flatMap((tab) =>
    panes(tab.root)
      .filter((p) => !p.url)
      .map((p) => {
        const s = lookup.status(p.id)
        return {
          id: p.id,
          tabId: tab.id,
          presetId: p.presetId,
          name: presets.find((x) => x.id === p.presetId)?.name ?? p.presetId,
          cwd: p.cwd,
          branch: lookup.branch(p.id),
          status: s?.status ?? 'exited',
          since: s?.since ?? 0,
          agent: s?.agent ?? null,
          message: s?.message ?? null,
          title: s?.title ?? null,
          tokens: s?.tokens ?? null,
          focused: p.id === focused
        }
      })
  )
}
