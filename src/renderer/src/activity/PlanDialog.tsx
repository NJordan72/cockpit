// The plan Claude Code proposed, at reading size over the window. The
// toolbar's Plan button, Cmd+Shift+P, and an ExitPlanMode row in the
// Activity log open it.
import { useCallback, useEffect, useLayoutEffect, useRef } from 'react'
import type { AgentPlan } from '@shared/activity'
import type { MenuItem } from '@shared/ipc'
import { Markdown } from './Markdown'
import { formatClock } from './model'
import { usePanePlans } from './useActivity'

/** Where each plan was scrolled to, so closing and opening it again keeps the place. */
const scrolled = new Map<string, number>()
const MAX_SCROLLED = 200

/** A plan's key among the pane's plans: its file, or '' for one without. */
export const planKey = (plan: AgentPlan): string => plan.file ?? ''

/** The plan to show: the chosen one while it's still there, otherwise the newest. */
export function pickPlan(plans: AgentPlan[], chosen: string | null): AgentPlan | undefined {
  return (chosen === null ? undefined : plans.find((p) => planKey(p) === chosen)) ?? plans[0]
}

/** "Approved", "14:05 · 2 rounds", and the longer form for a tooltip. */
export function planStatus(plan: AgentPlan): { label: string; when: string; title: string } {
  const label = plan.status === 'approved' ? 'Approved' : 'Proposed'
  const rounds = plan.rounds > 1 ? ` · ${String(plan.rounds)} rounds` : ''
  const proposed = new Date(plan.proposed).toLocaleString()
  const title =
    plan.status === 'approved'
      ? `Proposed ${proposed}\nApproved ${new Date(plan.at).toLocaleString()}`
      : `Proposed ${proposed}${plan.rounds > 1 ? `\nLast proposed ${new Date(plan.at).toLocaleString()}` : ''}\nNot approved (yet)`
  return { label, when: formatClock(plan.at) + rounds, title }
}

async function planMenu(plan: AgentPlan, selection: string): Promise<void> {
  const api = window.cockpit
  const { file } = plan
  const items: MenuItem[] = [
    ...(selection ? [{ id: 'selection', label: 'Copy' }, { type: 'separator' } as const] : []),
    { id: 'copy', label: 'Copy plan' },
    ...(file
      ? [
          { id: 'edit', label: 'Open in editor' },
          { id: 'path', label: 'Copy path' }
        ]
      : [])
  ]
  const chosen = await api.menu(items)
  if (chosen === 'selection') api.clipboard.writeText(selection)
  else if (chosen === 'copy') api.clipboard.writeText(plan.text)
  else if (chosen === 'edit' && file) api.editor.openFile(file)
  else if (chosen === 'path' && file) api.clipboard.writeText(file)
}

async function choosePlan(
  plans: AgentPlan[],
  current: AgentPlan,
  onChoose: (key: string) => void
): Promise<void> {
  const chosen = await window.cockpit.menu(
    plans.map((p, i) => ({
      id: String(i),
      label: `${p.title || 'Untitled plan'} · ${p.status === 'approved' ? 'approved' : 'proposed'} ${formatClock(p.at)}`,
      checked: p === current
    }))
  )
  const plan = chosen === null ? undefined : plans[Number(chosen)]
  if (plan) onChoose(planKey(plan))
}

interface Props {
  paneId: string
  /** The plan to show, by key; null for the newest. */
  chosen: string | null
  /** Which pane it's from, under the title. */
  label: string
  onChoose: (key: string) => void
  onClose: () => void
}

/**
 * A plan at reading size, over the window. It follows the pane's plans, so
 * an approval that arrives while it's open shows, and it closes when the
 * pane has none. Esc or a click outside closes it.
 */
export function PlanDialog({
  paneId,
  chosen,
  label,
  onChoose,
  onClose
}: Props): React.JSX.Element | null {
  const plans = usePanePlans(paneId)
  const plan = plans ? pickPlan(plans, chosen) : undefined
  const missing = plans !== null && !plan
  const scrollRef = useRef<HTMLDivElement>(null)
  // A new version of the plan starts at the top.
  const place = plan ? `${paneId}:${planKey(plan)}:${String(plan.at)}` : ''

  useEffect(() => {
    if (missing) onClose()
  }, [missing, onClose])

  useLayoutEffect(() => {
    const el = scrollRef.current
    if (!el) return
    el.scrollTop = scrolled.get(place) ?? 0
    // The text takes the keyboard, so arrows, Page Down, and Space scroll it.
    el.focus()
  }, [place])

  const onScroll = (): void => {
    const el = scrollRef.current
    if (!el || !place) return
    scrolled.delete(place)
    scrolled.set(place, el.scrollTop)
    if (scrolled.size > MAX_SCROLLED) {
      const oldest = scrolled.keys().next().value
      if (oldest !== undefined) scrolled.delete(oldest)
    }
  }

  const onLink = useCallback((href: string) => {
    window.cockpit.web.openExternal(href)
  }, [])

  if (!plans || !plan) return null
  const status = planStatus(plan)
  const { file } = plan
  return (
    <div
      className="picker-backdrop plan-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div
        className="plan-dialog"
        role="dialog"
        aria-label={`Plan: ${plan.title || 'untitled'}`}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.preventDefault()
            e.stopPropagation()
            onClose()
          }
        }}
      >
        <header className="plan-dialog-head">
          <span className="plan-dialog-title">{plan.title || 'Plan'}</span>
          <span className="plan-dialog-pane">{label}</span>
        </header>
        <div className="activity-toolbar plan-toolbar">
          <span className={`plan-status ${plan.status}`} title={status.title}>
            {status.label}
          </span>
          <span className="plan-when" title={status.title}>
            {status.when}
          </span>
          {plans.length > 1 && (
            <button
              type="button"
              tabIndex={-1}
              className="activity-chip"
              title="Show another plan from this session"
              onClick={() => void choosePlan(plans, plan, onChoose)}
            >
              {plans.indexOf(plan) + 1} of {plans.length} ▾
            </button>
          )}
          <span className="plan-actions">
            {file && (
              <button
                type="button"
                tabIndex={-1}
                className="activity-chip"
                title={`Open ${file} in the editor`}
                onClick={() => window.cockpit.editor.openFile(file)}
              >
                Open
              </button>
            )}
            <button
              type="button"
              tabIndex={-1}
              className="activity-chip"
              title="Copy the plan as Markdown"
              onClick={() => window.cockpit.clipboard.writeText(plan.text)}
            >
              Copy
            </button>
            <button
              type="button"
              tabIndex={-1}
              className="activity-chip"
              title="Close (Esc)"
              onClick={onClose}
            >
              Close
            </button>
          </span>
        </div>
        <div
          className="activity-scroll"
          ref={scrollRef}
          tabIndex={-1}
          onScroll={onScroll}
          onContextMenu={(e) => {
            e.preventDefault()
            void planMenu(plan, window.getSelection()?.toString() ?? '')
          }}
        >
          <article className="plan">
            <Markdown text={plan.text} onLink={onLink} />
          </article>
        </div>
      </div>
    </div>
  )
}
