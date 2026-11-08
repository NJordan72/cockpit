// The right-click menu entries for config.json's itemActions on one item,
// and where the chosen entry sends its prompt. Pure.
import type { MenuItem, PaneSession } from '@shared/ipc'
import {
  itemPrompt,
  WORKTREE_KINDS,
  type ActionTarget,
  type ItemAction,
  type ItemFields,
  type ItemKind
} from '@shared/itemActions'

/** Where App sends an item action's prompt. */
export type PromptTarget =
  | { kind: 'pane'; paneId: string }
  | { kind: 'new' }
  | { kind: 'worktree'; path: string; presetId?: string }

export interface PromptRequest {
  prompt: string
  target: PromptTarget
}

/** The pane runs an agent that can take a prompt. */
export const takesPrompts = (s: PaneSession | null | undefined): s is PaneSession =>
  !!s?.agent && s.status !== 'exited'

export interface ActionPlaces {
  /** The pane "In this session" types into. */
  here: PaneSession | null
  /** The item's worktree, with ~ for home, or null when it has none yet. */
  worktree?: string | null
  /** The agent to start in the worktree when none is running there. */
  presetId?: string
}

export interface ActionMenu {
  /** A separator and one entry per action, or nothing when no action applies to the item. */
  items: MenuItem[]
  /** What a chosen menu id asks for, or null when the id isn't one of `items`. */
  pick: (id: string | null) => PromptRequest | null
}

const PLACE_LABEL: Record<ActionTarget, string> = {
  worktree: 'In its worktree',
  new: 'In a new session',
  here: 'In this session'
}

const CHOSEN = /^action:(\d+):(here|new|worktree)$/

/**
 * An action with a target is one entry; one without opens a submenu of the
 * places it can go. Actions whose command uses a field the item lacks are
 * left out, and a place with nothing to take the prompt is disabled.
 */
export function actionMenu<K extends ItemKind>(
  kind: K,
  actions: readonly ItemAction[],
  fields: ItemFields<K>,
  places: ActionPlaces
): ActionMenu {
  const usable: Record<ActionTarget, boolean> = {
    here: takesPrompts(places.here),
    new: true,
    worktree: !!places.worktree
  }
  const submenu: ActionTarget[] = WORKTREE_KINDS.includes(kind)
    ? ['worktree', 'new', 'here']
    : ['new', 'here']
  const prompts = new Map<number, string>()
  const entries: MenuItem[] = []
  for (const [i, action] of actions.entries()) {
    const prompt = itemPrompt(kind, action.command, fields)
    if (prompt === null) continue
    prompts.set(i, prompt)
    const entry = (target: ActionTarget, label: string): MenuItem => ({
      id: `action:${String(i)}:${target}`,
      label,
      enabled: usable[target]
    })
    entries.push(
      action.target
        ? entry(action.target, action.label)
        : { label: action.label, submenu: submenu.map((t) => entry(t, PLACE_LABEL[t])) }
    )
  }

  const pick = (id: string | null): PromptRequest | null => {
    const m = CHOSEN.exec(id ?? '')
    const prompt = m ? prompts.get(Number(m[1])) : undefined
    const target = m?.[2] as ActionTarget | undefined
    if (prompt === undefined || !target || !usable[target]) return null
    if (target === 'here') {
      return places.here ? { prompt, target: { kind: 'pane', paneId: places.here.id } } : null
    }
    if (target === 'worktree') {
      if (!places.worktree) return null
      const t: PromptTarget = { kind: 'worktree', path: places.worktree }
      if (places.presetId) t.presetId = places.presetId
      return { prompt, target: t }
    }
    return { prompt, target: { kind: 'new' } }
  }

  return { items: entries.length > 0 ? [{ type: 'separator' }, ...entries] : [], pick }
}
