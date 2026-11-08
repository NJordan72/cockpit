// Runs: a set of work items, each listing the items it waits on, that Cockpit
// works through by starting each item as a task once its blockers are far
// enough along. A widget, a script, or an agent submits the graph, and the
// user confirms the whole run once. Pure, so the rules can be unit tested.
import { prRefFromUrl } from './prs'
import { MAX_BRANCH, type TaskPr } from './tasks'
import type { SessionStatus } from './widgets'

/**
 * merge: an item starts once every item it waits on is done, on a branch from
 * the default branch. stack: an item can start on top of a blocker whose pull
 * request is open, on a branch from that blocker's branch.
 */
export type RunMode = 'merge' | 'stack'

export const RUN_MODES: readonly RunMode[] = ['merge', 'stack']

export const MAX_ITEMS = 100
export const MAX_PARALLEL = 10
export const DEFAULT_PARALLEL = 3
export const MAX_PROMPT = 20_000
/** The most a submitted graph can be, as JSON. */
export const MAX_GRAPH_BYTES = 1024 * 1024
const MAX_TITLE = 200
const MAX_URL = 2000
const MAX_PATH = 1024
const MAX_PRESET = 64
/** Safe in a URL path, so `cockpit-run done <run> <item>` needs no escaping. */
const ITEM_ID = /^[A-Za-z0-9._-]{1,64}$/

/** Work Cockpit starts as a task of its own. */
export interface TaskItem {
  id: string
  title: string
  external?: false
  branch: string
  prompt: string
  /** The ids of the items this one waits on. */
  after: string[]
  url?: string
  /** A folder in the repository; the run's when missing. */
  repo?: string
  /** The agent to start; the run's when missing. */
  presetId?: string
}

/** Work Cockpit waits on but never starts, such as a story in another epic. */
export interface ExternalItem {
  id: string
  title: string
  external: true
  url?: string
  /** A pull request URL; the item is done when it merges. */
  pr?: string
}

export type RunItem = TaskItem | ExternalItem

export interface RunGraph {
  title: string
  repo?: string
  presetId?: string
  mode?: RunMode
  maxParallel?: number
  items: RunItem[]
}

export type Checked<T> = { ok: true; value: T } | { ok: false; error: string }

type Obj = Record<string, unknown>
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v)

function text(v: unknown, max: number): string | null {
  if (typeof v !== 'string') return null
  const s = v.trim()
  return s && s.length <= max ? s : null
}

const isUrl = (s: string): boolean => /^https?:\/\/\S+$/.test(s)
const isRepo = (s: string): boolean => /^[~/]/.test(s)

function readItem(raw: unknown, n: number): Checked<RunItem> {
  const fail = (error: string): Checked<RunItem> => ({ ok: false, error })
  if (!isObj(raw)) return fail(`Item ${String(n + 1)} isn't an object`)
  const id = typeof raw.id === 'string' ? raw.id : ''
  if (!ITEM_ID.test(id)) {
    return fail(`Item ${String(n + 1)} needs an id of letters, digits, ".", "_" or "-"`)
  }
  const title = text(raw.title, MAX_TITLE)
  if (!title) return fail(`Item "${id}" needs a title`)
  let url: string | undefined
  if (raw.url !== undefined) {
    const u = text(raw.url, MAX_URL)
    if (!u || !isUrl(u)) return fail(`Item "${id}" has a url that isn't an http(s) link`)
    url = u
  }

  if (raw.external === true) {
    if (raw.after !== undefined) return fail(`External item "${id}" can't wait on other items`)
    const item: ExternalItem = { id, title, external: true, ...(url ? { url } : {}) }
    if (raw.pr !== undefined) {
      const pr = typeof raw.pr === 'string' ? raw.pr.trim() : ''
      if (!prRefFromUrl(pr))
        return fail(`External item "${id}" has a pr that isn't a pull request URL`)
      item.pr = pr
    }
    return { ok: true, value: item }
  }
  if (raw.external !== undefined && raw.external !== false) {
    return fail(`Item "${id}" has an external that isn't true or false`)
  }

  const branch = text(raw.branch, MAX_BRANCH)
  if (!branch)
    return fail(`Item "${id}" needs a branch of at most ${String(MAX_BRANCH)} characters`)
  const prompt = text(raw.prompt, MAX_PROMPT)
  if (!prompt)
    return fail(`Item "${id}" needs a prompt of at most ${String(MAX_PROMPT)} characters`)
  const after: string[] = []
  if (raw.after !== undefined) {
    if (!Array.isArray(raw.after) || !raw.after.every((a) => typeof a === 'string')) {
      return fail(`Item "${id}" has an after that isn't a list of ids`)
    }
    for (const a of raw.after) if (!after.includes(a)) after.push(a)
  }
  const item: TaskItem = { id, title, branch, prompt, after, ...(url ? { url } : {}) }
  if (raw.repo !== undefined) {
    const repo = text(raw.repo, MAX_PATH)
    if (!repo || !isRepo(repo)) return fail(`Item "${id}" has a repo that isn't a path`)
    item.repo = repo
  }
  if (raw.presetId !== undefined) {
    const preset = text(raw.presetId, MAX_PRESET)
    if (!preset) return fail(`Item "${id}" has an empty presetId`)
    item.presetId = preset
  }
  return { ok: true, value: item }
}

/** One loop among `items`, as ids in the order they wait on each other, or null if there's none. */
function findCycle(items: readonly RunItem[]): string[] | null {
  const byId = new Map(items.map((i) => [i.id, i]))
  const after = (id: string): string[] => {
    const item = byId.get(id)
    return item && !item.external ? item.after : []
  }
  // 0: not visited, 1: on the current path, 2: finished.
  const mark = new Map<string, number>()
  const path: string[] = []
  const visit = (id: string): string[] | null => {
    mark.set(id, 1)
    path.push(id)
    for (const next of after(id)) {
      const m = mark.get(next) ?? 0
      if (m === 1) return [...path.slice(path.indexOf(next)), next]
      if (m === 0) {
        const found = visit(next)
        if (found) return found
      }
    }
    path.pop()
    mark.set(id, 2)
    return null
  }
  for (const item of items) {
    if ((mark.get(item.id) ?? 0) === 0) {
      const found = visit(item.id)
      if (found) return found
    }
  }
  return null
}

/**
 * Reads a submitted graph. Refuses duplicate ids, an `after` that names no
 * item, a loop of items waiting on each other, and graphs past the caps.
 */
export function checkGraph(raw: unknown): Checked<RunGraph> {
  const fail = (error: string): Checked<RunGraph> => ({ ok: false, error })
  if (!isObj(raw)) return fail('A run is a JSON object with a title and items')
  const title = text(raw.title, MAX_TITLE)
  if (!title) return fail(`A run needs a title of at most ${String(MAX_TITLE)} characters`)
  if (!Array.isArray(raw.items) || raw.items.length === 0) return fail('A run needs items')
  if (raw.items.length > MAX_ITEMS) return fail(`A run can have at most ${String(MAX_ITEMS)} items`)

  const graph: RunGraph = { title, items: [] }
  if (raw.repo !== undefined) {
    const repo = text(raw.repo, MAX_PATH)
    if (!repo || !isRepo(repo)) return fail("The run's repo isn't a path")
    graph.repo = repo
  }
  if (raw.presetId !== undefined) {
    const preset = text(raw.presetId, MAX_PRESET)
    if (!preset) return fail("The run's presetId is empty")
    graph.presetId = preset
  }
  if (raw.mode !== undefined) {
    if (!RUN_MODES.includes(raw.mode as RunMode)) return fail('mode is "merge" or "stack"')
    graph.mode = raw.mode as RunMode
  }
  if (raw.maxParallel !== undefined) {
    const n = raw.maxParallel
    if (typeof n !== 'number' || !Number.isInteger(n) || n < 1 || n > MAX_PARALLEL) {
      return fail(`maxParallel is a whole number from 1 to ${String(MAX_PARALLEL)}`)
    }
    graph.maxParallel = n
  }

  const ids = new Set<string>()
  for (const [n, r] of raw.items.entries()) {
    const item = readItem(r, n)
    if (!item.ok) return item
    if (ids.has(item.value.id)) return fail(`Two items have the id "${item.value.id}"`)
    ids.add(item.value.id)
    graph.items.push(item.value)
  }
  if (!graph.items.some((i) => !i.external)) return fail("A run needs an item that isn't external")
  for (const item of graph.items) {
    if (item.external) continue
    for (const a of item.after) {
      if (a === item.id) return fail(`Item "${item.id}" waits on itself`)
      if (!ids.has(a)) return fail(`Item "${item.id}" waits on "${a}", which isn't in the run`)
    }
  }
  const cycle = findCycle(graph.items)
  if (cycle) return fail(`These items wait on each other in a loop: ${cycle.join(', ')}`)
  return { ok: true, value: graph }
}

/**
 * The items in an order they can start in. Each step takes the first item in
 * the graph whose blockers are all placed, so a graph listing c (which waits
 * on a), a, and b comes out as a, c, b.
 */
export function startOrder<T extends RunItem>(items: readonly T[]): T[] {
  const placed = new Set<string>()
  const left = [...items]
  const out: T[] = []
  while (left.length > 0) {
    const i = left.findIndex(
      (item) => item.external === true || item.after.every((a) => placed.has(a))
    )
    // checkGraph refuses loops, so this only guards against a hand-edited file.
    const [next] = left.splice(i === -1 ? 0 : i, 1)
    if (!next) break
    placed.add(next.id)
    out.push(next)
  }
  return out
}

/** The line Cockpit adds to each prompt, so the item's pull request is how Cockpit sees it finish. */
export function prLine(base: string): string {
  return `When the work is ready, push this branch and open a pull request against ${base}.`
}

export function promptFor(item: Pick<TaskItem, 'prompt'>, base: string): string {
  return `${item.prompt}\n\n${prLine(base)}`
}

/** A confirmed run, as Cockpit keeps it. */
export interface Run {
  id: string
  title: string
  mode: RunMode
  maxParallel: number
  /** The agent for items that don't name their own. */
  presetId: string
  /** Each task item's `repo` is its repository's main checkout, with ~ for home. */
  items: RunItem[]
  records: Record<string, ItemRecord>
  paused: boolean
  cancelled: boolean
  source: RunSource
  createdAt: number
}

/** Who submitted a run. A widget sees only the runs it submitted. */
export type RunSource = { kind: 'widget'; widgetId: string } | { kind: 'script' }

/** What Cockpit can't read back from git, gh, or the panes about one item. */
export interface ItemRecord {
  /** When Cockpit started the item (made its task), in ms since the epoch. */
  startedAt?: number
  /** The item whose branch this one's branch started from, in stack mode. */
  stackedOn?: string
  /**
   * When Cockpit first saw the item done, or someone marked it done. It
   * stays done after Clean up merged removes its worktree.
   */
  doneAt?: number
  /** A pull request that closed without merging before a retry, which no longer counts. */
  ignoredPr?: number
  /** Why making the item's task failed. */
  error?: string
}

/**
 * waiting: an item it waits on isn't far enough along. ready: it could start.
 * working: its task is made and has no pull request. review: its pull
 * request is open. done: its pull request merged, or someone marked it done.
 * stuck: its pull request closed, its worktree is gone, or its task couldn't
 * be made.
 */
export type ItemPhase = 'waiting' | 'ready' | 'working' | 'review' | 'done' | 'stuck'

export interface ItemState {
  phase: ItemPhase
  /** waiting: the items it still waits on. */
  waitingOn: string[]
  /** ready: the item whose branch it would start from, in stack mode. */
  startsOn: string | null
  /** working: the agent's status in the task's worktree, or null when no agent is running there. */
  agent: SessionStatus | null
  /** The task's worktree, with ~ for home. */
  path: string | null
  pr: TaskPr | null
  /** review: the pull request merged into this branch, whose own item isn't done. */
  mergedInto: string | null
  /** The item under this one in a stack is done, so this branch needs a rebase. */
  baseMerged: boolean
  /** stuck: why. */
  reason: string | null
}

/** What Cockpit reads back about one item, from git, gh, and the panes. */
export interface ItemFacts {
  /** The task on the item's branch in its repository, or null when there's none. */
  task: { path: string; pr: TaskPr | null } | null
  agent: SessionStatus | null
  /** Its task is being made. */
  starting: boolean
  /** External items with a `pr`: that pull request's state, or null until it's read. */
  prState: TaskPr['state'] | null
}

const NO_FACTS: ItemFacts = { task: null, agent: null, starting: false, prState: null }

function state(phase: ItemPhase, extra: Partial<ItemState> = {}): ItemState {
  return {
    phase,
    waitingOn: [],
    startsOn: null,
    agent: null,
    path: null,
    pr: null,
    mergedInto: null,
    baseMerged: false,
    reason: null,
    ...extra
  }
}

/** The items under `id` in its stack, nearest first. */
function stackBelow(run: Run, id: string): string[] {
  const out: string[] = []
  let next = run.records[id]?.stackedOn
  while (next && !out.includes(next)) {
    out.push(next)
    next = run.records[next]?.stackedOn
  }
  return out
}

/** Whether Cockpit has started the item, or the item's branch has a task anyway. */
export const isStarted = (run: Run, id: string, facts: ItemFacts | undefined): boolean =>
  run.records[id]?.startedAt !== undefined || (facts?.task ?? null) !== null || !!facts?.starting

/**
 * Each item's state, from what the run recorded and what Cockpit reads back.
 * An item merged into the branch under it in a stack stays in review until
 * that item is done, since its work isn't on the default branch yet.
 */
export function itemStates(
  run: Run,
  facts: Readonly<Record<string, ItemFacts>>
): Record<string, ItemState> {
  const out: Record<string, ItemState> = {}
  const byId = new Map(run.items.map((i) => [i.id, i]))
  const isDone = (id: string): boolean => out[id]?.phase === 'done'

  for (const item of startOrder(run.items)) {
    const rec = run.records[item.id] ?? {}
    const f = facts[item.id] ?? NO_FACTS
    if (item.external) {
      out[item.id] = state(rec.doneAt !== undefined || f.prState === 'merged' ? 'done' : 'waiting')
      continue
    }
    if (rec.doneAt !== undefined) {
      out[item.id] = state('done', { path: f.task?.path ?? null, pr: f.task?.pr ?? null })
      continue
    }
    const raw = f.task?.pr ?? null
    const pr = raw && raw.number === rec.ignoredPr ? null : raw
    const below = rec.stackedOn ? byId.get(rec.stackedOn) : undefined
    const onBelow = below && !below.external && pr?.base === below.branch
    const common = {
      path: f.task?.path ?? null,
      pr,
      baseMerged: !!below && isDone(below.id) && pr?.state !== 'merged'
    }
    if (pr?.state === 'merged') {
      out[item.id] =
        onBelow && !isDone(below.id)
          ? state('review', { ...common, mergedInto: below.branch })
          : state('done', { ...common, baseMerged: false })
      continue
    }

    if (isStarted(run, item.id, f)) {
      if (f.starting) out[item.id] = state('working', common)
      else if (!f.task) {
        out[item.id] = state('stuck', {
          ...common,
          reason: rec.error ?? 'Its worktree is gone'
        })
      } else if (pr?.state === 'open') out[item.id] = state('review', common)
      else if (pr?.state === 'closed') {
        out[item.id] = state('stuck', {
          ...common,
          reason: `Its pull request #${String(pr.number)} closed without merging`
        })
      } else out[item.id] = state('working', { ...common, agent: f.agent })
      continue
    }

    const waitingOn = item.after.filter((a) => !isDone(a))
    if (waitingOn.length === 0) {
      out[item.id] = state('ready')
      continue
    }
    if (run.mode === 'stack') {
      const startsOn = item.after.find((b) => {
        const blocker = byId.get(b)
        if (!blocker || blocker.external || blocker.repo !== item.repo) return false
        const s = out[b]
        if (s?.phase !== 'review' || s.pr?.state !== 'open') return false
        const under = stackBelow(run, b)
        return item.after.every((o) => o === b || isDone(o) || under.includes(o))
      })
      if (startsOn) {
        out[item.id] = state('ready', { startsOn })
        continue
      }
    }
    out[item.id] = state('waiting', { waitingOn })
  }
  return out
}

export interface Start {
  id: string
  /** The item whose branch the new branch starts from, or null for the default branch. */
  stackedOn: string | null
}

/**
 * The ready items to start now, in start order, while fewer than
 * `maxParallel` items are working. An item in review doesn't use a slot.
 */
export function nextToStart(run: Run, states: Readonly<Record<string, ItemState>>): Start[] {
  if (run.paused || run.cancelled) return []
  const working = Object.values(states).filter((s) => s.phase === 'working').length
  const free = run.maxParallel - working
  if (free <= 0) return []
  return startOrder(run.items)
    .filter((i) => states[i.id]?.phase === 'ready')
    .slice(0, free)
    .map((i) => ({ id: i.id, stackedOn: states[i.id]?.startsOn ?? null }))
}

/** How many of the run's items are done, out of how many. */
export function progress(states: Readonly<Record<string, ItemState>>): {
  done: number
  total: number
} {
  const all = Object.values(states)
  return { done: all.filter((s) => s.phase === 'done').length, total: all.length }
}

/** A run that has nothing left to do: every item is done, or the run was cancelled. */
export const isFinished = (run: Run, states: Readonly<Record<string, ItemState>>): boolean =>
  run.cancelled || Object.values(states).every((s) => s.phase === 'done')

export const RUN_VERSION = 1

/** A run as ~/.cockpit/runs/<id>.json holds it. */
export interface SavedRun extends Run {
  version: number
}

const RUN_ID = /^[A-Za-z0-9_-]{1,64}$/

export const isRunId = (id: string): boolean => RUN_ID.test(id)

function readRecord(raw: unknown): ItemRecord {
  const rec: ItemRecord = {}
  if (!isObj(raw)) return rec
  const time = (v: unknown): number | undefined =>
    typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : undefined
  const startedAt = time(raw.startedAt)
  if (startedAt !== undefined) rec.startedAt = startedAt
  const doneAt = time(raw.doneAt)
  if (doneAt !== undefined) rec.doneAt = doneAt
  if (typeof raw.stackedOn === 'string' && ITEM_ID.test(raw.stackedOn))
    rec.stackedOn = raw.stackedOn
  if (typeof raw.ignoredPr === 'number' && Number.isSafeInteger(raw.ignoredPr)) {
    rec.ignoredPr = raw.ignoredPr
  }
  if (typeof raw.error === 'string' && raw.error) rec.error = raw.error.slice(0, 500)
  return rec
}

/**
 * A saved run read back, or null for a file that isn't one or that a newer
 * Cockpit wrote. Fields a file leaves out get their defaults.
 */
export function readRun(raw: unknown): Run | null {
  if (!isObj(raw)) return null
  const version = raw.version ?? 1
  if (typeof version !== 'number' || version > RUN_VERSION) return null
  if (typeof raw.id !== 'string' || !isRunId(raw.id)) return null
  const graph = checkGraph({ title: raw.title, items: raw.items })
  if (!graph.ok) return null
  const ids = new Set(graph.value.items.map((i) => i.id))
  const records: Record<string, ItemRecord> = {}
  if (isObj(raw.records)) {
    for (const [id, rec] of Object.entries(raw.records)) {
      if (ids.has(id)) records[id] = readRecord(rec)
    }
  }
  const src = isObj(raw.source) ? raw.source : {}
  const source: RunSource =
    src.kind === 'widget' && typeof src.widgetId === 'string'
      ? { kind: 'widget', widgetId: src.widgetId }
      : { kind: 'script' }
  const n = raw.maxParallel
  return {
    id: raw.id,
    title: graph.value.title,
    mode: raw.mode === 'stack' ? 'stack' : 'merge',
    maxParallel:
      typeof n === 'number' && Number.isInteger(n) && n >= 1 && n <= MAX_PARALLEL
        ? n
        : DEFAULT_PARALLEL,
    presetId: typeof raw.presetId === 'string' && raw.presetId ? raw.presetId : 'claude',
    items: graph.value.items,
    records,
    paused: raw.paused === true,
    cancelled: raw.cancelled === true,
    source,
    createdAt: typeof raw.createdAt === 'number' ? raw.createdAt : 0
  }
}

/** One run and its items' states, in start order, for the Runs panel. */
export interface RunView {
  id: string
  title: string
  /** Submitted, and waiting for the user to confirm it. */
  pending: boolean
  mode: RunMode
  maxParallel: number
  presetId: string
  paused: boolean
  cancelled: boolean
  finished: boolean
  done: number
  total: number
  createdAt: number
  items: RunItemView[]
}

export type RunItemView = RunItem & { state: ItemState }

/** A submitted run waiting for the user to confirm it, for the dialog. */
export interface RunDraft {
  id: string
  title: string
  /** Who submitted it: a widget's name, or "cockpit-run". */
  from: string
  mode: RunMode
  maxParallel: number
  presetId?: string
  repo?: string
  /** In start order. */
  items: RunItem[]
}

/** What the user chose in the dialog. */
export interface RunStartRequest {
  id: string
  mode: RunMode
  maxParallel: number
  presetId: string
  /** The repository for items that don't name one; needed only when some item doesn't. */
  repo?: string
}

export type RunAction = 'pause' | 'resume' | 'cancel' | 'remove' | 'startNow' | 'markDone' | 'retry'

export const RUN_ACTIONS: readonly RunAction[] = [
  'pause',
  'resume',
  'cancel',
  'remove',
  'startNow',
  'markDone',
  'retry'
]
