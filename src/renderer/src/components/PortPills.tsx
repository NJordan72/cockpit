import type { PaneSession } from '@shared/ipc'
import { portCollisions, type LocalServer } from '@shared/ports'

export interface PortItem {
  paneId: string
  server: LocalServer
}

interface Props {
  items: readonly PortItem[]
  sessions: readonly PaneSession[]
  className?: string
  onOpenPort: (paneId: string, url: string) => void
}

function sessionLabel(s: PaneSession): string {
  const where = s.branch ?? s.cwd.split('/').filter(Boolean).pop() ?? s.cwd
  return `${s.title ?? s.name} (${where})`
}

/**
 * Clickable `:port` pills for detected local dev servers. Highlights ports
 * shared with another pane/worktree with a warning style and tooltip.
 */
export function PortPills({
  items,
  sessions,
  className,
  onOpenPort
}: Props): React.JSX.Element | null {
  if (items.length === 0) return null
  const collisions = portCollisions(sessions)
  const byId = new Map(sessions.map((s) => [s.id, s]))

  return (
    <div className={className ? `port-pills ${className}` : 'port-pills'}>
      {items.map(({ paneId, server }) => {
        const peerIds = (collisions.get(server.port) ?? []).filter((id) => id !== paneId)
        const colliding = peerIds.length > 0
        const peers = peerIds
          .map((id) => byId.get(id))
          .filter((s): s is PaneSession => s !== undefined)
          .map(sessionLabel)
        const tip = colliding
          ? `${server.url}\nPort ${String(server.port)} is also used by ${peers.join(', ')}\nClick to open in split web pane`
          : `${server.url}\nClick to open in split web pane`
        return (
          <button
            key={`${paneId}:${String(server.port)}`}
            type="button"
            tabIndex={-1}
            className={colliding ? 'port-pill collision' : 'port-pill'}
            title={tip}
            onMouseDown={(e) => {
              e.preventDefault()
            }}
            onClick={(e) => {
              e.stopPropagation()
              onOpenPort(paneId, server.url)
            }}
          >
            {colliding && (
              <span className="port-pill-warn" aria-hidden>
                ⚠
              </span>
            )}
            :{server.port}
          </button>
        )
      })}
    </div>
  )
}
