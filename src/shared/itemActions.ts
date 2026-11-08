// The entries config.json's `itemActions` adds to the right-click menus of
// the panels' items, and the prompt each entry sends to an agent. Pure, so it
// can be unit tested.
import { prRefFromUrl, type PullRequest } from './prs'
import type { RunItemView } from './runs'
import type { TaskInfo } from './tasks'

/**
 * pr: a row of the Pull requests panel. task: a row of the Tasks panel.
 * runItem: an item in the Runs panel. file: a row of the Activity panel's
 * Files tab.
 */
export const ITEM_KINDS = ['pr', 'task', 'runItem', 'file'] as const
export type ItemKind = (typeof ITEM_KINDS)[number]

/**
 * here: the focused pane's agent. new: a new agent session. worktree: the
 * agent open in the item's worktree, or a new one there if none is.
 */
export const ACTION_TARGETS = ['here', 'new', 'worktree'] as const
export type ActionTarget = (typeof ACTION_TARGETS)[number]

export interface ItemAction {
  label: string
  /** The prompt, with placeholders for the item's fields: `/propose-ship {number}`. */
  command: string
  /** Where the prompt goes. Without one, the entry opens a submenu of places. */
  target?: ActionTarget
}

export type ItemActions = Record<ItemKind, ItemAction[]>

/** The placeholders each kind of item can fill in. */
export const ITEM_FIELDS = {
  pr: ['number', 'url', 'title', 'branch', 'author', 'repo'],
  task: ['path', 'repo', 'branch', 'pr.number', 'pr.url'],
  runItem: ['id', 'title', 'branch', 'url', 'pr.number', 'pr.url'],
  file: ['path']
} as const satisfies Record<ItemKind, readonly string[]>

/** One item's values for its kind's placeholders; null where the item has none. */
export type ItemFields<K extends ItemKind> = Record<(typeof ITEM_FIELDS)[K][number], string | null>

/** The field added at the end of a command that has no placeholders. */
const SUBJECT: { [K in ItemKind]: (typeof ITEM_FIELDS)[K][number] } = {
  pr: 'url',
  task: 'path',
  runItem: 'url',
  file: 'path'
}

/** Kinds whose items can have a worktree, where `worktree` can send a prompt. */
export const WORKTREE_KINDS: readonly ItemKind[] = ['task', 'runItem']

export const MAX_ITEM_ACTIONS = 20
const MAX_LABEL = 40

/** config.json's `itemActions` replaces these, one kind at a time. */
export function defaultItemActions(): ItemActions {
  return {
    pr: [{ label: 'Review', command: '/code-review' }],
    task: [],
    runItem: [],
    file: []
  }
}

const PLACEHOLDER = /\{([A-Za-z]+(?:\.[A-Za-z]+)*)\}/g

/**
 * The prompt `command` sends about an item. Each placeholder of the item's
 * kind is replaced by the item's value, so "/propose-ship {number}" on pull
 * request 123 is "/propose-ship 123". Braces around any other word stay as
 * they are. A command with no placeholders of its kind gets the item's URL
 * (a pull request or run item) or path (a task or file) added at its end.
 * Null when the item has no value for a field the command uses.
 */
export function itemPrompt<K extends ItemKind>(
  kind: K,
  command: string,
  fields: ItemFields<K>
): string | null {
  const known: readonly string[] = ITEM_FIELDS[kind]
  const values: Readonly<Record<string, string | null>> = fields
  const used = [...command.matchAll(PLACEHOLDER)]
    .map((m) => m[1] ?? '')
    .filter((name) => known.includes(name))
  if (used.length === 0) {
    const subject = values[SUBJECT[kind]]
    return subject ? `${command} ${subject}` : null
  }
  if (used.some((name) => !values[name])) return null
  return command.replace(PLACEHOLDER, (whole, name: string) =>
    known.includes(name) ? (values[name] ?? whole) : whole
  )
}

/** `repo` is `owner/name`, from the pull request's URL. */
export const prFields = (
  pr: Pick<PullRequest, 'number' | 'url' | 'title' | 'branch' | 'author'>
): ItemFields<'pr'> => ({
  number: String(pr.number),
  url: pr.url,
  title: pr.title,
  branch: pr.branch,
  author: pr.author,
  repo: prRefFromUrl(pr.url)?.repo ?? null
})

export const taskFields = (
  task: Pick<TaskInfo, 'path' | 'repo' | 'branch' | 'pr'>
): ItemFields<'task'> => ({
  path: task.path,
  repo: task.repo,
  branch: task.branch,
  'pr.number': task.pr ? String(task.pr.number) : null,
  'pr.url': task.pr?.url ?? null
})

/** An external item's pull request is the URL it was submitted with. */
export function runItemFields(item: RunItemView): ItemFields<'runItem'> {
  const url = item.state.pr?.url ?? (item.external ? item.pr : undefined) ?? null
  const ref = url ? prRefFromUrl(url) : null
  return {
    id: item.id,
    title: item.title,
    branch: item.external ? null : item.branch,
    url: item.url ?? null,
    'pr.number': ref ? String(ref.number) : null,
    'pr.url': url
  }
}

export const fileFields = (path: string): ItemFields<'file'> => ({ path })

type Obj = Record<string, unknown>
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v)

/**
 * A list, even an empty one, replaces the kind's defaults. Entries without a
 * label and a command are dropped, and so is a target the kind can't use.
 */
export function readActionList(v: unknown, kind: ItemKind): ItemAction[] {
  const actions: ItemAction[] = []
  if (!Array.isArray(v)) return actions
  for (const a of v) {
    if (!isObj(a) || typeof a.label !== 'string' || typeof a.command !== 'string') continue
    const label = a.label.trim().slice(0, MAX_LABEL)
    const command = a.command.trim()
    if (!label || !command) continue
    const action: ItemAction = { label, command }
    const target = ACTION_TARGETS.find((t) => t === a.target)
    if (target && (target !== 'worktree' || WORKTREE_KINDS.includes(kind))) action.target = target
    actions.push(action)
  }
  return actions.slice(0, MAX_ITEM_ACTIONS)
}

/**
 * Before version 7, the Pull requests panel's entries were a top-level
 * `prActions` list. It fills in `itemActions.pr` when that isn't a list.
 */
export function readItemActions(v: unknown, prActions?: unknown): ItemActions {
  const out = defaultItemActions()
  const raw = isObj(v) ? v : {}
  for (const kind of ITEM_KINDS) {
    const list = kind === 'pr' && !Array.isArray(raw.pr) ? prActions : raw[kind]
    if (Array.isArray(list)) out[kind] = readActionList(list, kind)
  }
  return out
}
