// Runs: Cockpit works through a confirmed run by starting each item as a
// task once the items it waits on are far enough along. RunStore saves only
// what Cockpit can't read back, one JSON file per run under
// ~/.cockpit/runs/. Each item's review, merged, and stuck states come from
// the tasks' pull requests, and its working state from the agent status
// tracker.
import { randomUUID } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import {
  checkGraph,
  DEFAULT_PARALLEL,
  isFinished,
  isRunId,
  itemStates,
  MAX_PARALLEL,
  nextToStart,
  progress,
  promptFor,
  readRun,
  RUN_MODES,
  RUN_VERSION,
  startOrder,
  type ItemFacts,
  type ItemState,
  type Run,
  type RunAction,
  type RunDraft,
  type RunGraph,
  type RunItem,
  type RunSource,
  type RunStartRequest,
  type RunView,
  type Start,
  type TaskItem
} from '@shared/runs'
import type { NewTask, NewTaskResult, TaskInfo, TaskPr } from '@shared/tasks'
import type { SessionStatus } from '@shared/widgets'

export type Result = { ok: true } | { ok: false; error: string }

export interface RunStoreOptions {
  /** ~/.cockpit/runs */
  dir: string
  tasks: () => readonly TaskInfo[]
  /** Whether the task list has been read once since launch. */
  scanned: () => boolean
  create: (req: NewTask) => Promise<NewTaskResult>
  /** A repository's main checkout with ~ for home, or why there's none. */
  mainCheckout: (dir: string) => Promise<{ ok: true; path: string } | { ok: false; error: string }>
  defaultBranch: (repo: string) => Promise<string | null>
  /** The status of the agent running in a worktree, or null with none. */
  agentIn: (worktree: string) => SessionStatus | null
  /** Opens a tab in the worktree that runs the preset with the prompt. False when it can't. */
  open: (req: { path: string; presetId: string; prompt: string }) => boolean
  /** False while nothing should start, such as in kids mode or with no terminal window. */
  canStart: () => boolean
  /** Asks the user to confirm a submitted run. False when no window can show the dialog. */
  confirm: (draft: RunDraft) => boolean
  readPr: (url: string) => Promise<TaskPr['state'] | null>
  notify: (title: string, body: string, worktree: string | null) => void
  onChange: (runs: RunView[]) => void
  now?: () => number
}

interface Pending {
  id: string
  graph: RunGraph
  source: RunSource
  from: string
  createdAt: number
}

/** External pull requests are read again after this long. */
const PR_MAX_AGE_MS = 60_000

const ownedBy = (run: { source: RunSource }, widgetId: string): boolean =>
  run.source.kind === 'widget' && run.source.widgetId === widgetId

export class RunStore {
  private readonly runs = new Map<string, Run>()
  private readonly pending = new Map<string, Pending>()
  /** `<run>/<item>` for each item whose task is being made. */
  private readonly starting = new Set<string>()
  private readonly prs = new Map<string, { state: TaskPr['state'] | null; at: number }>()
  private chain: Promise<unknown>
  private queued = false
  private sent = ''

  constructor(private readonly opts: RunStoreOptions) {
    this.chain = this.load()
  }

  private now(): number {
    return (this.opts.now ?? Date.now)()
  }

  /** Runs `fn` after everything already queued, so two changes never interleave. */
  private serial<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.chain.then(fn, fn)
    this.chain = run.catch((err: unknown) => {
      console.warn('runs:', err)
    })
    return run
  }

  /** Checks every run again, once for any number of calls made before the check starts. */
  poke(): void {
    if (this.queued) return
    this.queued = true
    void this.serial(async () => {
      this.queued = false
      await this.evaluate()
    })
  }

  /** Waits for every queued change and check. */
  idle(): Promise<void> {
    return this.chain.then(() => undefined)
  }

  list(): RunView[] {
    return [...this.runs.values()]
      .sort((a, b) => b.createdAt - a.createdAt)
      .map((run) => this.view(run))
  }

  /** The runs a widget submitted, the ones still waiting for the user included. */
  listFor(widgetId: string): RunView[] {
    const drafts = [...this.pending.values()]
      .filter((p) => ownedBy(p, widgetId))
      .map((p) => this.pendingView(p))
    const mine = [...this.runs.values()].filter((r) => ownedBy(r, widgetId)).map((r) => r.id)
    return [...drafts, ...this.list().filter((v) => mine.includes(v.id))]
  }

  /** Whether a run has items whose pull requests Cockpit should keep reading with no window on screen. */
  needsPolling(): boolean {
    return this.list().some(
      (v) =>
        !v.cancelled &&
        v.items.some((i) => i.state.phase === 'working' || i.state.phase === 'review')
    )
  }

  /**
   * Holds a submitted run until the user confirms it in the dialog. Returns
   * the run's id, or why the graph was refused.
   */
  submit(
    raw: unknown,
    source: RunSource,
    from: string
  ): { ok: true; id: string } | { ok: false; error: string } {
    const checked = checkGraph(raw)
    if (!checked.ok) return checked
    const graph = checked.value
    const id = `r${this.now().toString(36)}${randomUUID().slice(0, 4)}`
    const p: Pending = { id, graph, source, from, createdAt: this.now() }
    this.pending.set(id, p)
    if (!this.opts.confirm(this.draft(p))) {
      this.pending.delete(id)
      return { ok: false, error: 'Open a Cockpit window to confirm the run' }
    }
    this.emit()
    return { ok: true, id }
  }

  private draft(p: Pending): RunDraft {
    return {
      id: p.id,
      title: p.graph.title,
      from: p.from,
      mode: p.graph.mode ?? 'merge',
      maxParallel: p.graph.maxParallel ?? DEFAULT_PARALLEL,
      ...(p.graph.presetId ? { presetId: p.graph.presetId } : {}),
      ...(p.graph.repo ? { repo: p.graph.repo } : {}),
      items: startOrder(p.graph.items)
    }
  }

  discard(id: string): void {
    if (this.pending.delete(id)) this.emit()
  }

  /** Starts a submitted run with what the user chose in the dialog. */
  confirm(req: RunStartRequest): Promise<Result> {
    return this.serial(async (): Promise<Result> => {
      const p = this.pending.get(req.id)
      if (!p) return { ok: false, error: 'That run is gone' }
      if (!RUN_MODES.includes(req.mode)) return { ok: false, error: 'Pick a mode' }
      if (
        !Number.isInteger(req.maxParallel) ||
        req.maxParallel < 1 ||
        req.maxParallel > MAX_PARALLEL
      ) {
        return { ok: false, error: `Pick from 1 to ${String(MAX_PARALLEL)} at a time` }
      }
      if (!req.presetId) return { ok: false, error: 'Pick an agent' }
      const picked = req.repo?.trim()
      const fallback = picked !== undefined && picked !== '' ? picked : p.graph.repo
      const checkouts = new Map<string, string>()
      const items: RunItem[] = []
      for (const item of p.graph.items) {
        if (item.external) {
          items.push(item)
          continue
        }
        const repo = item.repo ?? fallback
        if (!repo) return { ok: false, error: `Pick a repository for ${item.title}` }
        let main = checkouts.get(repo)
        if (!main) {
          const found = await this.opts.mainCheckout(repo)
          if (!found.ok) return { ok: false, error: found.error }
          main = found.path
          checkouts.set(repo, main)
        }
        items.push({ ...item, repo: main })
      }
      const run: Run = {
        id: p.id,
        title: p.graph.title,
        mode: req.mode,
        maxParallel: req.maxParallel,
        presetId: req.presetId,
        items,
        records: {},
        paused: false,
        cancelled: false,
        source: p.source,
        createdAt: p.createdAt
      }
      await this.save(run)
      this.pending.delete(p.id)
      this.runs.set(run.id, run)
      this.poke()
      return { ok: true }
    })
  }

  /** Marks an item done from a widget, which may only touch the runs it submitted. */
  markDoneFor(widgetId: string, runId: string, itemId: string): Promise<Result> {
    const run = this.runs.get(runId)
    if (!run || !ownedBy(run, widgetId)) return Promise.resolve({ ok: false, error: 'No such run' })
    return this.act(runId, 'markDone', itemId)
  }

  /** An action from the Runs panel or cockpit-run. */
  act(runId: string, action: RunAction, itemId?: string): Promise<Result> {
    return this.serial(async (): Promise<Result> => {
      const run = this.runs.get(runId)
      if (!run) return { ok: false, error: 'No such run' }
      const item = itemId === undefined ? undefined : run.items.find((i) => i.id === itemId)
      if (itemId !== undefined && !item)
        return { ok: false, error: `No item ${itemId} in that run` }
      switch (action) {
        case 'pause':
          run.paused = true
          break
        case 'resume':
          run.paused = false
          break
        case 'cancel':
          run.cancelled = true
          break
        case 'remove': {
          const states = itemStates(run, this.facts(run))
          if (!isFinished(run, states)) return { ok: false, error: 'Cancel the run first' }
          this.runs.delete(run.id)
          await fs.rm(this.file(run.id), { force: true })
          this.emit()
          return { ok: true }
        }
        case 'markDone': {
          if (!item) return { ok: false, error: 'Mark which item?' }
          run.records[item.id] = { ...run.records[item.id], doneAt: this.now() }
          break
        }
        case 'startNow':
        case 'retry': {
          if (!item || item.external) return { ok: false, error: "Cockpit doesn't start that item" }
          if (run.cancelled) return { ok: false, error: 'That run was cancelled' }
          const state = itemStates(run, this.facts(run))[item.id]
          if (action === 'startNow' && state?.phase !== 'waiting' && state?.phase !== 'ready') {
            return { ok: false, error: `${item.title} has started already` }
          }
          if (action === 'retry' && state?.phase !== 'stuck') {
            return { ok: false, error: `${item.title} isn't stuck` }
          }
          const rec = { ...run.records[item.id] }
          if (state?.pr?.state === 'closed') rec.ignoredPr = state.pr.number
          delete rec.error
          run.records[item.id] = rec
          await this.save(run)
          await this.start(run, item, {
            id: item.id,
            stackedOn: rec.stackedOn ?? state?.startsOn ?? null
          })
          this.poke()
          return { ok: true }
        }
      }
      await this.save(run)
      this.poke()
      return { ok: true }
    })
  }

  /**
   * Reads external items' pull requests that are due, then checks the runs
   * again. Called about once a minute.
   */
  async tick(): Promise<void> {
    const now = this.now()
    const due = new Set<string>()
    for (const run of this.runs.values()) {
      if (run.cancelled) continue
      for (const item of run.items) {
        if (!item.external || !item.pr || run.records[item.id]?.doneAt !== undefined) continue
        const known = this.prs.get(item.pr)
        if (!known || now - known.at >= PR_MAX_AGE_MS) due.add(item.pr)
      }
    }
    await Promise.all(
      [...due].map(async (url) => {
        const state = await this.opts.readPr(url).catch(() => null)
        const before = this.prs.get(url)?.state ?? null
        this.prs.set(url, { state: state ?? before, at: this.now() })
      })
    )
    this.poke()
  }

  private facts(run: Run): Record<string, ItemFacts> {
    const tasks = this.opts.tasks()
    const out: Record<string, ItemFacts> = {}
    for (const item of run.items) {
      if (item.external) {
        out[item.id] = {
          task: null,
          agent: null,
          starting: false,
          prState: item.pr ? (this.prs.get(item.pr)?.state ?? null) : null
        }
        continue
      }
      const task = tasks.find((t) => t.repo === item.repo && t.branch === item.branch) ?? null
      out[item.id] = {
        task: task ? { path: task.path, pr: task.pr } : null,
        agent: task ? this.opts.agentIn(task.path) : null,
        starting: this.starting.has(`${run.id}/${item.id}`),
        prState: null
      }
    }
    return out
  }

  private async evaluate(): Promise<void> {
    if (!this.opts.scanned()) return
    for (const run of this.runs.values()) {
      if (run.cancelled) continue
      let changed = false
      let facts = this.facts(run)
      let states = itemStates(run, facts)
      for (const item of run.items) {
        const rec = run.records[item.id] ?? {}
        const s = states[item.id]
        // An item stays done after its worktree is removed.
        if (s?.phase === 'done' && rec.doneAt === undefined) {
          run.records[item.id] = { ...rec, doneAt: this.now() }
          changed = true
        } else if (!item.external && rec.startedAt === undefined && facts[item.id]?.task) {
          // Started by hand, or before Cockpit quit without saving.
          run.records[item.id] = { ...rec, startedAt: this.now() }
          changed = true
        }
      }
      if (changed) {
        await this.save(run)
        facts = this.facts(run)
        states = itemStates(run, facts)
      }
      if (run.paused || !this.opts.canStart()) continue
      for (const pick of nextToStart(run, states)) {
        const item = run.items.find((i) => i.id === pick.id)
        if (item && !item.external) await this.start(run, item, pick)
      }
    }
    this.emit()
  }

  /** Makes the item's task and opens its agent, unless one is running there already. */
  private async start(run: Run, item: TaskItem, pick: Start): Promise<void> {
    const key = `${run.id}/${item.id}`
    const below = pick.stackedOn ? run.items.find((i) => i.id === pick.stackedOn) : undefined
    const base = below && !below.external ? below.branch : undefined
    const rec = { ...run.records[item.id], startedAt: this.now() }
    if (pick.stackedOn) rec.stackedOn = pick.stackedOn
    delete rec.error
    run.records[item.id] = rec
    await this.save(run)
    this.starting.add(key)
    this.emit()
    let made: NewTaskResult
    try {
      made = await this.opts.create({
        repo: item.repo ?? '',
        branch: item.branch,
        ...(base ? { base } : {})
      })
    } finally {
      this.starting.delete(key)
    }
    if (!made.ok) {
      run.records[item.id] = { ...rec, error: made.error }
      await this.save(run)
      this.opts.notify(`Couldn't start ${item.title}`, made.error, null)
      this.emit()
      return
    }
    if (!made.existing || this.opts.agentIn(made.path) === null) {
      const to = base ?? (await this.opts.defaultBranch(item.repo ?? '')) ?? 'the default branch'
      this.opts.open({
        path: made.path,
        presetId: item.presetId ?? run.presetId,
        prompt: promptFor(item, to)
      })
    }
    const titles = item.after.map((a) => run.items.find((i) => i.id === a)?.title ?? a)
    this.opts.notify(
      `Started ${item.title}`,
      titles.length > 0 ? `It was waiting on ${titles.join(', ')}.` : run.title,
      made.path
    )
    this.emit()
  }

  private view(run: Run): RunView {
    const states = itemStates(run, this.facts(run))
    return this.viewOf(run, states, false)
  }

  private pendingView(p: Pending): RunView {
    const states: Record<string, ItemState> = {}
    for (const item of p.graph.items) {
      states[item.id] = {
        phase: 'waiting',
        waitingOn: item.external ? [] : item.after,
        startsOn: null,
        agent: null,
        path: null,
        pr: null,
        mergedInto: null,
        baseMerged: false,
        reason: null
      }
    }
    const d = this.draft(p)
    return this.viewOf(
      {
        id: p.id,
        title: d.title,
        mode: d.mode,
        maxParallel: d.maxParallel,
        presetId: d.presetId ?? '',
        items: p.graph.items,
        records: {},
        paused: false,
        cancelled: false,
        source: p.source,
        createdAt: p.createdAt
      },
      states,
      true
    )
  }

  private viewOf(run: Run, states: Record<string, ItemState>, pending: boolean): RunView {
    const { done, total } = progress(states)
    return {
      id: run.id,
      title: run.title,
      pending,
      mode: run.mode,
      maxParallel: run.maxParallel,
      presetId: run.presetId,
      paused: run.paused,
      cancelled: run.cancelled,
      finished: !pending && isFinished(run, states),
      done,
      total,
      createdAt: run.createdAt,
      items: startOrder(run.items).flatMap((item) => {
        const state = states[item.id]
        return state ? [{ ...item, state }] : []
      })
    }
  }

  private emit(): void {
    const views = this.list()
    const json = JSON.stringify([views, this.pending.size])
    if (json === this.sent) return
    this.sent = json
    this.opts.onChange(views)
  }

  private file(id: string): string {
    return path.join(this.opts.dir, `${id}.json`)
  }

  private async save(run: Run): Promise<void> {
    await fs.mkdir(this.opts.dir, { recursive: true })
    const file = this.file(run.id)
    const tmp = `${file}.${process.pid.toString()}.tmp`
    await fs.writeFile(tmp, JSON.stringify({ version: RUN_VERSION, ...run }, null, 2) + '\n')
    await fs.rename(tmp, file)
  }

  private async load(): Promise<void> {
    let names: string[]
    try {
      names = await fs.readdir(this.opts.dir)
    } catch {
      return
    }
    for (const name of names) {
      const id = name.endsWith('.json') ? name.slice(0, -'.json'.length) : ''
      if (!isRunId(id)) continue
      try {
        const run = readRun(JSON.parse(await fs.readFile(this.file(id), 'utf8')))
        if (run?.id === id) this.runs.set(id, run)
        else console.warn(`runs: skipped ${name}, which this version of Cockpit can't read`)
      } catch (err) {
        console.warn(`runs: could not read ${name}:`, err)
      }
    }
  }
}

/** `cockpit-run list` output: each run, then each of its items with its state. */
export function formatRuns(views: readonly RunView[]): string {
  if (views.length === 0) return 'No runs.\n'
  const lines: string[] = []
  for (const v of views) {
    const status = v.pending
      ? 'waiting for you to confirm it'
      : v.cancelled
        ? 'cancelled'
        : v.paused
          ? 'paused'
          : `${String(v.done)}/${String(v.total)} done`
    lines.push(`${v.id}  ${v.title} (${v.mode}, ${status})`)
    const width = Math.max(...v.items.map((i) => i.id.length))
    for (const i of v.items) {
      const pr = i.state.pr ? ` #${String(i.state.pr.number)}` : ''
      const waits = i.state.phase === 'waiting' && i.state.waitingOn.length > 0
      const note = waits ? ` (waits on ${i.state.waitingOn.join(', ')})` : ''
      lines.push(`  ${i.id.padEnd(width)}  ${i.state.phase.padEnd(7)}  ${i.title}${pr}${note}`)
    }
  }
  return lines.join('\n') + '\n'
}
