import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import type { RunDraft, RunView } from '@shared/runs'
import type { NewTask, NewTaskResult, TaskInfo, TaskPr } from '@shared/tasks'
import type { SessionStatus } from '@shared/widgets'
import { formatRuns, runRequests, RunStore, type RunStoreOptions } from './runs'

let tmp: string
let tasks: TaskInfo[]
let created: NewTask[]
let opened: { path: string; presetId: string; prompt: string }[]
let drafts: RunDraft[]
let notes: string[]
let agents: Record<string, SessionStatus>
let createDelay: Promise<void> | null

const task = (req: NewTask): TaskInfo => ({
  path: `~/w/${req.branch}`,
  repo: req.repo,
  branch: req.branch,
  head: 'h',
  changed: 0,
  unpushed: 0,
  pr: null,
  prError: null,
  inPr: false,
  createdAt: 0
})

const pr = (state: TaskPr['state'], extra: Partial<TaskPr> = {}): TaskPr => ({
  number: 1,
  title: 't',
  url: 'https://github.com/o/r/pull/1',
  state,
  draft: false,
  checks: null,
  review: null,
  head: 'h',
  base: 'main',
  ...extra
})

/** Gives the branch's task a pull request, as TaskStore would after asking gh. */
const setPr = (branch: string, p: TaskPr | null): void => {
  tasks = tasks.map((t) => (t.branch === branch ? { ...t, pr: p } : t))
}

const store = (extra: Partial<RunStoreOptions> = {}): RunStore =>
  new RunStore({
    dir: path.join(tmp, 'runs'),
    tasks: () => tasks,
    scanned: () => true,
    create: async (req): Promise<NewTaskResult> => {
      created.push(req)
      if (createDelay) await createDelay
      const have = tasks.find((t) => t.branch === req.branch)
      if (have) return { ok: true, path: have.path, existing: true }
      const t = task(req)
      tasks.push(t)
      return { ok: true, path: t.path, existing: false }
    },
    mainCheckout: (dir) => Promise.resolve({ ok: true, path: dir }),
    defaultBranch: () => Promise.resolve('main'),
    agentIn: (p) => agents[p] ?? null,
    open: (r) => {
      opened.push(r)
      return true
    },
    canStart: () => true,
    confirm: (d) => {
      drafts.push(d)
      return true
    },
    readPr: () => Promise.resolve(null),
    notify: (title, body) => notes.push(`${title}: ${body}`),
    onChange: () => undefined,
    now: () => 1000,
    ...extra
  })

const item = (id: string, after: string[] = []) => ({
  id,
  title: `Story ${id}`,
  branch: `me/${id}`,
  prompt: `Start story ${id}`,
  after
})

const graph = (items: unknown[], extra: Record<string, unknown> = {}) => ({
  title: 'Epic',
  items,
  ...extra
})

/** Submits and confirms a run, then waits for the first check. */
async function started(
  s: RunStore,
  g: unknown,
  choices: { mode?: 'merge' | 'stack'; maxParallel?: number } = {}
): Promise<string> {
  const sub = s.submit(g, { kind: 'script' }, 'cockpit-run')
  if (!sub.ok) throw new Error(sub.error)
  const ok = await s.confirm({
    id: sub.id,
    mode: choices.mode ?? 'merge',
    maxParallel: choices.maxParallel ?? 3,
    presetId: 'claude',
    repo: '~/dev/app'
  })
  if (!ok.ok) throw new Error(ok.error)
  await s.idle()
  return sub.id
}

const phases = (v: RunView | undefined): Record<string, string> =>
  Object.fromEntries((v?.items ?? []).map((i) => [i.id, i.state.phase]))

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ck-runs-'))
  tasks = []
  created = []
  opened = []
  drafts = []
  notes = []
  agents = {}
  createDelay = null
})

afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true })
})

describe('RunStore', () => {
  it('asks first, then starts what waits on nothing, with the pull request line', async () => {
    const s = store()
    const sub = s.submit(graph([item('b', ['a']), item('a')]), { kind: 'script' }, 'cockpit-run')
    if (!sub.ok) throw new Error(sub.error)
    await s.idle()
    expect(created).toEqual([])
    expect(drafts[0]?.items.map((i) => i.id)).toEqual(['a', 'b'])
    expect(s.list()).toEqual([])

    await s.confirm({
      id: sub.id,
      mode: 'merge',
      maxParallel: 3,
      presetId: 'claude',
      repo: '~/dev/app'
    })
    await s.idle()
    expect(created).toEqual([{ repo: '~/dev/app', branch: 'me/a' }])
    expect(opened).toEqual([
      {
        path: '~/w/me/a',
        presetId: 'claude',
        prompt:
          'Start story a\n\nWhen the work is ready, push this branch and open a pull request against main.'
      }
    ])
    expect(notes).toEqual(['Started Story a: Epic'])
    expect(phases(s.list()[0])).toEqual({ a: 'working', b: 'waiting' })
    expect(fs.existsSync(path.join(tmp, 'runs', `${sub.id}.json`))).toBe(true)
  })

  it("refuses a graph it can't read, and a run with no repository to work in", async () => {
    const s = store()
    expect(s.submit(graph([item('a', ['a'])]), { kind: 'script' }, 'x')).toEqual({
      ok: false,
      error: 'Item "a" waits on itself'
    })
    const sub = s.submit(graph([item('a')]), { kind: 'script' }, 'x')
    if (!sub.ok) throw new Error(sub.error)
    expect(
      await s.confirm({ id: sub.id, mode: 'merge', maxParallel: 3, presetId: 'claude' })
    ).toEqual({ ok: false, error: 'Pick a repository for Story a' })
    expect(
      store({ confirm: () => false }).submit(graph([item('a')]), { kind: 'script' }, 'x')
    ).toEqual({ ok: false, error: 'Open a Cockpit window to confirm the run' })
  })

  it('starts each item once, however many checks arrive while its task is being made', async () => {
    let release = (): void => undefined
    createDelay = new Promise((r) => (release = r))
    const s = store()
    const sub = s.submit(graph([item('a'), item('b')]), { kind: 'script' }, 'x')
    if (!sub.ok) throw new Error(sub.error)
    const confirmed = s.confirm({
      id: sub.id,
      mode: 'merge',
      maxParallel: 3,
      presetId: 'claude',
      repo: '~/dev/app'
    })
    s.poke()
    s.poke()
    await new Promise((r) => setTimeout(r, 10))
    s.poke()
    release()
    await confirmed
    await s.idle()
    s.poke()
    await s.idle()
    expect(created.map((c) => c.branch)).toEqual(['me/a', 'me/b'])
    expect(opened).toHaveLength(2)
  })

  it('keeps maxParallel items working, and starts the next when one opens its pull request', async () => {
    const s = store()
    await started(s, graph(['a', 'b', 'c'].map((id) => item(id))), { maxParallel: 2 })
    expect(created.map((c) => c.branch)).toEqual(['me/a', 'me/b'])
    setPr('me/a', pr('open'))
    s.poke()
    await s.idle()
    expect(created.map((c) => c.branch)).toEqual(['me/a', 'me/b', 'me/c'])
  })

  it('starts what a merge unblocked, and keeps a merged item done after its worktree is removed', async () => {
    const s = store()
    const id = await started(s, graph([item('a'), item('b', ['a'])]))
    setPr('me/a', pr('merged'))
    s.poke()
    await s.idle()
    expect(created.map((c) => c.branch)).toEqual(['me/a', 'me/b'])
    expect(notes).toContain('Started Story b: It was waiting on Story a.')

    // Clean up merged removes the worktree.
    tasks = tasks.filter((t) => t.branch !== 'me/a')
    s.poke()
    await s.idle()
    expect(phases(s.list().find((v) => v.id === id))).toEqual({ a: 'done', b: 'working' })
  })

  it('counts a branch that already has a task as started, and opens no second agent', async () => {
    // Cockpit quit after making the worktree and before saving the run, or
    // the user had started the story by hand.
    tasks.push(task({ repo: '~/dev/app', branch: 'me/a' }))
    agents['~/w/me/a'] = 'working'
    const s = store()
    const id = await started(s, graph([item('a'), item('b')]), { maxParallel: 1 })
    expect(created).toEqual([])
    expect(opened).toEqual([])
    const saved = JSON.parse(fs.readFileSync(path.join(tmp, 'runs', `${id}.json`), 'utf8')) as {
      records: Record<string, { startedAt?: number }>
    }
    expect(saved.records.a?.startedAt).toBe(1000)
  })

  it('reads its runs back after a restart, without starting anything twice', async () => {
    const first = store()
    const id = await started(first, graph([item('a'), item('b', ['a'])]))
    expect(created).toHaveLength(1)
    const again = store()
    again.poke()
    await again.idle()
    expect(created).toHaveLength(1)
    expect(phases(again.list().find((v) => v.id === id))).toEqual({ a: 'working', b: 'waiting' })
  })

  it('stacks an item on a blocker in review, branching from that blocker', async () => {
    const s = store()
    await started(s, graph([item('a'), item('b', ['a'])]), { mode: 'stack' })
    setPr('me/a', pr('open'))
    s.poke()
    await s.idle()
    expect(created[1]).toEqual({ repo: '~/dev/app', branch: 'me/b', base: 'me/a' })
    expect(opened[1]?.prompt.endsWith('open a pull request against me/a.')).toBe(true)
  })

  it('retries a stuck item, ignoring the pull request that closed', async () => {
    const s = store()
    const id = await started(s, graph([item('a')]))
    setPr('me/a', pr('closed', { number: 7 }))
    s.poke()
    await s.idle()
    expect(phases(s.list()[0])).toEqual({ a: 'stuck' })
    expect(await s.act(id, 'retry', 'a')).toEqual({ ok: true })
    await s.idle()
    expect(opened).toHaveLength(2)
    expect(phases(s.list()[0])).toEqual({ a: 'working' })
    expect(await s.act(id, 'retry', 'a')).toEqual({ ok: false, error: "Story a isn't stuck" })
  })

  it('starts nothing while paused or cancelled, and starts a waiting item on Start now', async () => {
    const s = store()
    const id = await started(s, graph([item('a'), item('b', ['a']), item('c')]), { maxParallel: 1 })
    expect(created.map((c) => c.branch)).toEqual(['me/a'])
    await s.act(id, 'pause')
    setPr('me/a', pr('open'))
    s.poke()
    await s.idle()
    expect(created).toHaveLength(1)
    await s.act(id, 'resume')
    await s.idle()
    expect(created.map((c) => c.branch)).toEqual(['me/a', 'me/c'])
    expect(await s.act(id, 'startNow', 'b')).toEqual({ ok: true })
    expect(created.map((c) => c.branch)).toEqual(['me/a', 'me/c', 'me/b'])
    await s.act(id, 'cancel')
    expect(await s.act(id, 'remove')).toEqual({ ok: true })
    expect(s.list()).toEqual([])
  })

  it('shows a widget only its own runs, and lets it mark only those done', async () => {
    const s = store()
    const mine = s.submit(graph([item('a')]), { kind: 'widget', widgetId: 'shortcut' }, 'Shortcut')
    const theirs = s.submit(graph([item('b')]), { kind: 'widget', widgetId: 'other' }, 'Other')
    if (!mine.ok || !theirs.ok) throw new Error('not submitted')
    expect(s.listFor('shortcut').map((v) => [v.id, v.pending])).toEqual([[mine.id, true]])
    await s.confirm({
      id: theirs.id,
      mode: 'merge',
      maxParallel: 1,
      presetId: 'claude',
      repo: '~/a'
    })
    expect(await s.markDoneFor('shortcut', theirs.id, 'b')).toEqual({
      ok: false,
      error: 'No such run'
    })
    expect(await s.markDoneFor('other', theirs.id, 'b')).toEqual({ ok: true })
  })

  it('marks an external item done when its pull request merges', async () => {
    const s = store({ readPr: () => Promise.resolve('merged') })
    const url = 'https://github.com/o/r/pull/3'
    await started(s, graph([item('a', ['x']), { id: 'x', title: 'X', external: true, pr: url }]))
    expect(created).toEqual([])
    await s.tick()
    await s.idle()
    expect(created.map((c) => c.branch)).toEqual(['me/a'])
  })
})

describe('formatRuns', () => {
  it('lists each run with its items and what they wait on', async () => {
    const s = store()
    const id = await started(s, graph([item('a'), item('bb', ['a'])]))
    expect(formatRuns(s.list())).toBe(
      `${id}  Epic (merge, 0/2 done)\n  a   working  Story a\n  bb  waiting  Story bb (waits on a)\n`
    )
    expect(formatRuns([])).toBe('No runs.\n')
  })
})

describe('runRequests', () => {
  it('submits, lists, and marks done for cockpit-run, saying why a request fails', async () => {
    const s = store()
    const answer = runRequests(s)
    const body = JSON.stringify(graph([item('a')]))
    expect(await answer({ method: 'POST', path: '/v1/runs', body: '{' })).toEqual({
      status: 400,
      text: "cockpit-run: the run isn't JSON\n"
    })
    const sub = await answer({ method: 'POST', path: '/v1/runs', body })
    expect(sub.status).toBe(200)
    const id = drafts[0]?.id ?? ''
    expect(sub.text).toBe(`Submitted run ${id}. Confirm it in Cockpit to start it.\n`)
    expect((await answer({ method: 'GET', path: '/v1/runs', body: '' })).text).toContain(
      'waiting for you to confirm it'
    )
    expect(await answer({ method: 'POST', path: `/v1/runs/${id}/items/a/done`, body: '' })).toEqual(
      { status: 404, text: 'cockpit-run: No such run\n' }
    )
    await s.confirm({ id, mode: 'merge', maxParallel: 1, presetId: 'claude', repo: '~/dev/app' })
    expect(await answer({ method: 'POST', path: `/v1/runs/${id}/items/a/done`, body: '' })).toEqual(
      { status: 200, text: 'Marked a done.\n' }
    )
    expect((await answer({ method: 'GET', path: '/v1/runs/x', body: '' })).status).toBe(404)
  })
})
