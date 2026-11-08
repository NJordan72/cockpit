import { MAX_WINDOWS, type Action, type Keybindings } from '@shared/config'
import type { PaneSession } from '@shared/ipc'
import { planStatus } from '../activity/PlanDialog'
import { useGit, usePanePlans } from '../activity/useActivity'
import { chordLabel } from '../keybindings'
import { STATUS_LABEL } from '../sessions'

interface Props {
  /**
   * The focused pane of the active tab; null on the start screen. In a window
   * without terminals, the one the user last worked in.
   */
  focused: PaneSession | null
  keybindings: Keybindings
  layouts: { id: string; name: string }[]
  layout: string
  panelsHidden: boolean
  /** Whether git may be read (the window is on screen). */
  active: boolean
  onAction: (action: Action) => void
  onLayout: (id: string) => void
  /** Windows open now, and displays to put them on. */
  windows: number
  displays: number
  /** Open or close windows to make `count`, and arrange them on the displays. */
  onWindows: (count: number) => void
  /** Open the plan dialog on the focused pane's newest plan. */
  onShowPlan: () => void
}

const COUNTS = Array.from({ length: MAX_WINDOWS }, (_, i) => i + 1)

function windowsTitle(count: number, open: number, displays: number): string {
  const what = count === 1 ? '1 window' : `${String(count)} windows`
  const where =
    displays >= count
      ? count === 1
        ? ''
        : ', one per display'
      : displays === 1
        ? ', side by side'
        : `, on ${String(displays)} displays`
  return count === open
    ? `Arrange ${what}${where}`
    : `${what[0]?.toUpperCase() ?? ''}${what.slice(1)}${where}`
}

const BUTTONS: { action: Action; label: string; title: string; needsPane: boolean }[] = [
  { action: 'newTab', label: '+ Tab', title: 'New tab', needsPane: false },
  { action: 'newShell', label: '>_ Shell', title: 'New shell (no agent)', needsPane: false },
  {
    action: 'newTask',
    label: '⎇ Task',
    title: 'New task: a branch in a worktree of its own',
    needsPane: false
  },
  { action: 'openUrl', label: '◍ Web', title: 'Open a web page', needsPane: false },
  { action: 'splitRight', label: '◫ Right', title: 'Split right', needsPane: true },
  { action: 'splitDown', label: '⊟ Down', title: 'Split down', needsPane: true },
  { action: 'clearPane', label: '⟲ Clear', title: 'Clear session', needsPane: true },
  { action: 'resumePane', label: '↺ Resume', title: 'Open an old session', needsPane: true },
  {
    action: 'openEditor',
    label: '✎ Editor',
    title: "Open the pane's project in your editor",
    needsPane: true
  }
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
  onLayout,
  windows,
  displays,
  onWindows,
  onShowPlan
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
        {focused ? (
          <FocusedPane
            session={focused}
            active={active}
            planTip={tip('Click to read it', 'showPlan')}
            onShowPlan={onShowPlan}
          />
        ) : (
          <span>No pane</span>
        )}
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
        <div className="toolbar-windows" role="group" aria-label="Windows">
          <span aria-hidden>▭</span>
          {COUNTS.map((n) => (
            <button
              key={n}
              type="button"
              tabIndex={-1}
              className={n === windows ? 'on' : undefined}
              aria-pressed={n === windows}
              title={windowsTitle(n, windows, displays)}
              onMouseDown={keepFocus}
              onClick={() => onWindows(n)}
            >
              {n}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

function FocusedPane({
  session,
  active,
  planTip,
  onShowPlan
}: {
  session: PaneSession
  active: boolean
  /** The last line of the Plan button's tooltip, with its shortcut. */
  planTip: string
  onShowPlan: () => void
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
      <PlanButton paneId={session.id} tip={planTip} onShow={onShowPlan} />
    </>
  )
}

/**
 * Appears once the pane's agent has proposed a plan, and opens it. Its mark
 * is yellow while the newest plan waits for approval (or was turned down,
 * which Claude Code doesn't report) and green once it's approved.
 */
function PlanButton({
  paneId,
  tip,
  onShow
}: {
  paneId: string
  tip: string
  onShow: () => void
}): React.JSX.Element | null {
  const plans = usePanePlans(paneId)
  const plan = plans?.[0]
  if (!plans || !plan) return null
  const status = planStatus(plan)
  const others = plans.length > 1 ? `\n${String(plans.length)} plans in this session` : ''
  return (
    <button
      type="button"
      tabIndex={-1}
      className={`toolbar-plan ${plan.status}`}
      title={`${plan.title || 'Plan'}\n${status.label} ${status.when}${others}\n${tip}`}
      // Keeps the keyboard where it is until the dialog takes it.
      onMouseDown={(e) => {
        e.preventDefault()
      }}
      onClick={onShow}
    >
      <span className="toolbar-plan-mark" aria-hidden>
        ▤
      </span>
      Plan
      {plans.length > 1 && <span className="toolbar-plan-count">{plans.length}</span>}
    </button>
  )
}
