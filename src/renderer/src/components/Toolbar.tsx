import type { Action, Keybindings } from '@shared/config'
import type { PaneSession } from '@shared/ipc'
import { useGit } from '../activity/useActivity'
import { chordLabel } from '../keybindings'
import { STATUS_LABEL } from '../sessions'

interface Props {
  /** The focused pane of the active tab; null on the start screen. */
  focused: PaneSession | null
  keybindings: Keybindings
  layouts: { id: string; name: string }[]
  layout: string
  panelsHidden: boolean
  /** Whether git may be read (the window is on screen). */
  active: boolean
  onAction: (action: Action) => void
  onLayout: (id: string) => void
}

const BUTTONS: { action: Action; label: string; title: string; needsPane: boolean }[] = [
  { action: 'newTab', label: '+ Tab', title: 'New tab', needsPane: false },
  { action: 'newShell', label: '>_ Shell', title: 'New shell (no agent)', needsPane: false },
  { action: 'openUrl', label: '◍ Web', title: 'Open a web page', needsPane: false },
  { action: 'splitRight', label: '◫ Right', title: 'Split right', needsPane: true },
  { action: 'splitDown', label: '⊟ Down', title: 'Split down', needsPane: true },
  { action: 'clearPane', label: '⟲ Clear', title: 'Clear session', needsPane: true },
  { action: 'resumePane', label: '↺ Resume', title: 'Open an old session', needsPane: true }
]

/** The bar along the bottom of the window: the focused pane, and the actions most used on it. */
export function Toolbar({
  focused,
  keybindings,
  layouts,
  layout,
  panelsHidden,
  active,
  onAction,
  onLayout
}: Props): React.JSX.Element {
  const tip = (title: string, action: Action): string => {
    const keys = chordLabel(keybindings[action])
    return keys ? `${title} (${keys})` : title
  }
  // Buttons keep the keyboard where it was, in the terminal.
  const keepFocus = (e: React.MouseEvent): void => {
    e.preventDefault()
  }

  return (
    <div className="toolbar" role="toolbar" aria-label="Pane">
      <div className="toolbar-pane">
        {focused ? <FocusedPane session={focused} active={active} /> : <span>No pane</span>}
      </div>
      <div className="toolbar-actions">
        {BUTTONS.map((b) => (
          <button
            key={b.action}
            type="button"
            tabIndex={-1}
            disabled={b.needsPane && !focused}
            title={tip(b.title, b.action)}
            onMouseDown={keepFocus}
            onClick={() => onAction(b.action)}
          >
            {b.label}
          </button>
        ))}
        <button
          type="button"
          tabIndex={-1}
          className={panelsHidden ? undefined : 'on'}
          aria-pressed={!panelsHidden}
          title={tip(panelsHidden ? 'Show panels' : 'Hide panels', 'toggleSidebar')}
          onMouseDown={keepFocus}
          onClick={() => onAction('toggleSidebar')}
        >
          Panels
        </button>
        <select
          tabIndex={-1}
          aria-label="Layout"
          title="Layout"
          value={layout}
          onChange={(e) => onLayout(e.target.value)}
        >
          {layouts.map((l) => (
            <option key={l.id} value={l.id}>
              {l.name}
            </option>
          ))}
        </select>
      </div>
    </div>
  )
}

function FocusedPane({
  session,
  active
}: {
  session: PaneSession
  active: boolean
}): React.JSX.Element {
  // Read git again when the agent finishes something; it may have committed.
  const git = useGit(session.id, active, `${session.status}:${String(session.since)}`)
  const label = STATUS_LABEL[session.status]
  return (
    <>
      <span className="toolbar-status" title={session.message ?? label}>
        <span className={`status-dot ${session.status}`} aria-hidden />
        {label}
      </span>
      <span className="toolbar-name">{session.title ?? session.name}</span>
      <span className="toolbar-cwd" title={session.cwd}>
        <bdi dir="ltr">{session.cwd}</bdi>
      </span>
      {git && (
        <span className="toolbar-git" title={git.upstream ?? git.root}>
          {git.branch ?? git.head ?? 'detached'}
          {git.ahead > 0 && ` ↑${String(git.ahead)}`}
          {git.behind > 0 && ` ↓${String(git.behind)}`}
          {git.changed > 0 && <span className="toolbar-changed"> ±{git.changed}</span>}
        </span>
      )}
    </>
  )
}
