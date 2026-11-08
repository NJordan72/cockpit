import { describe, expect, it } from 'bun:test'
import {
  checkGraph,
  itemStates,
  MAX_ITEMS,
  nextToStart,
  progress,
  promptFor,
  readRun,
  RUN_VERSION,
  startOrder,
  type ItemFacts,
  type Run
} from './runs'
import type { TaskPr } from './tasks'

const item = (id: string, after: string[] = [], extra: Record<string, unknown> = {}) => ({
  id,
  title: `Story ${id}`,
  branch: `me/${id}`,
  prompt: `Start story ${id}`,
  after,
  ...extra
})

const run = (graph: unknown, extra: Partial<Run> = {}): Run => {
  const g = checkGraph(graph)
  if (!g.ok) throw new Error(g.error)
  return {
    id: 'r1',
    title: g.value.title,
    mode: 'merge',
    maxParallel: 3,
    presetId: 'claude',
    items: g.value.items.map((i) => (i.external ? i : { ...i, repo: i.repo ?? '~/dev/app' })),
    records: {},
    paused: false,
    cancelled: false,
    source: { kind: 'script' },
    createdAt: 0,
    ...extra
  }
}

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

const facts = (extra: Partial<ItemFacts> = {}): ItemFacts => ({
  task: null,
  agent: null,
  starting: false,
  prState: null,
  ...extra
})
const working = (id: string): ItemFacts =>
  facts({ task: { path: `~/w/${id}`, pr: null }, agent: 'working' })
const inReview = (id: string, base = 'main', n = 1): ItemFacts =>
  facts({ task: { path: `~/w/${id}`, pr: pr('open', { base, number: n }) } })
const merged = (id: string, base = 'main'): ItemFacts =>
  facts({ task: { path: `~/w/${id}`, pr: pr('merged', { base }) } })

const phases = (r: Run, f: Record<string, ItemFacts>): Record<string, string> =>
  Object.fromEntries(Object.entries(itemStates(r, f)).map(([id, s]) => [id, s.phase]))

const ids = (r: Run, f: Record<string, ItemFacts>): string[] =>
  nextToStart(r, itemStates(r, f)).map((s) => s.id)

// An eight-story epic: each story waits on the stories whose `blocks` links point at it.
const epic = {
  title: 'Epic 200: Example epic',
  items: [
    item('201'),
    item('206', ['203']),
    item('208', ['204', '206']),
    item('204', ['201']),
    item('205', ['204']),
    item('203', ['202']),
    item('207', ['203']),
    item('202', ['201'])
  ]
}

// The graph from issue #49, with sc-104 in another repository.
const issue = {
  title: 'Epic 812: Login revamp',
  repo: '~/dev/app',
  items: [
    item('sc-101'),
    item('sc-102', ['sc-101']),
    item('sc-103', ['sc-101', 'sc-102']),
    item('sc-104', ['sc-103', 'sc-90'], { repo: '~/dev/app-web' }),
    { id: 'sc-90', title: 'Publish the new design tokens', external: true }
  ]
}

describe('checkGraph', () => {
  it("takes the issue's graph, external items included", () => {
    const g = checkGraph(issue)
    expect(g.ok).toBe(true)
    if (!g.ok) return
    expect(g.value.items.map((i) => i.id)).toEqual([
      'sc-101',
      'sc-102',
      'sc-103',
      'sc-104',
      'sc-90'
    ])
    expect(g.value.items[4]).toEqual({
      id: 'sc-90',
      title: 'Publish the new design tokens',
      external: true
    })
  })

  it('refuses duplicate ids, unknown blockers, and items waiting on themselves', () => {
    const err = (items: unknown[]): string => {
      const g = checkGraph({ title: 't', items })
      return g.ok ? 'ok' : g.error
    }
    expect(err([item('a'), item('a')])).toBe('Two items have the id "a"')
    expect(err([item('a', ['zz'])])).toBe('Item "a" waits on "zz", which isn\'t in the run')
    expect(err([item('a', ['a'])])).toBe('Item "a" waits on itself')
    expect(err([item('a b')])).toContain('needs an id')
    expect(err([{ id: 'x', title: 'X', external: true }])).toBe(
      "A run needs an item that isn't external"
    )
    expect(err([item('a'), { id: 'x', title: 'X', external: true, after: ['a'] }])).toBe(
      'External item "x" can\'t wait on other items'
    )
    expect(err([item('a'), { id: 'x', title: 'X', external: true, pr: 'nope' }])).toContain(
      "isn't a pull request URL"
    )
    expect(err([item('a', [], { url: 'javascript:alert(1)' })])).toContain("isn't an http(s) link")
  })

  it('names the items in a loop', () => {
    const g = checkGraph({ title: 't', items: [item('a', ['b']), item('b', ['a']), item('c')] })
    expect(g).toEqual({ ok: false, error: 'These items wait on each other in a loop: a, b, a' })
    const long = checkGraph({
      title: 't',
      items: [item('x'), item('a', ['c']), item('b', ['a']), item('c', ['b', 'x'])]
    })
    expect(long.ok ? '' : long.error).toBe('These items wait on each other in a loop: a, c, b, a')
  })

  it('caps the items, maxParallel, branches, and prompts', () => {
    const many = Array.from({ length: MAX_ITEMS + 1 }, (_, n) => item(`i${String(n)}`))
    expect(checkGraph({ title: 't', items: many }).ok).toBe(false)
    expect(checkGraph({ title: 't', maxParallel: 11, items: [item('a')] }).ok).toBe(false)
    expect(checkGraph({ title: 't', maxParallel: 0, items: [item('a')] }).ok).toBe(false)
    expect(checkGraph({ title: 't', mode: 'yolo', items: [item('a')] }).ok).toBe(false)
    expect(checkGraph({ title: 't', items: [item('a', [], { branch: 'b'.repeat(201) })] }).ok).toBe(
      false
    )
    expect(
      checkGraph({ title: 't', items: [item('a', [], { prompt: 'p'.repeat(20_001) })] }).ok
    ).toBe(false)
    expect(checkGraph({ title: '', items: [item('a')] }).ok).toBe(false)
    expect(checkGraph([]).ok).toBe(false)
  })
})

describe('startOrder', () => {
  it('puts each item after the ones it waits on, and otherwise keeps the graph order', () => {
    const g = checkGraph({ title: 't', items: [item('c', ['a']), item('a'), item('b')] })
    if (!g.ok) throw new Error(g.error)
    expect(startOrder(g.value.items).map((i) => i.id)).toEqual(['a', 'c', 'b'])
    expect(startOrder(run(epic).items).map((i) => i.id)).toEqual([
      '201',
      '204',
      '205',
      '202',
      '203',
      '206',
      '208',
      '207'
    ])
  })
})

describe('itemStates and nextToStart in merge mode', () => {
  it('starts only what waits on nothing, then what the merges unblocked', () => {
    const r = run(epic)
    expect(ids(r, {})).toEqual(['201'])
    expect(itemStates(r, {})['202']).toMatchObject({ phase: 'waiting', waitingOn: ['201'] })
    // An open pull request isn't enough in merge mode.
    expect(ids(r, { '201': inReview('201') })).toEqual([])
    expect(ids(r, { '201': merged('201') })).toEqual(['204', '202'])
  })

  it('keeps fewer than maxParallel items working, and an item in review frees its slot', () => {
    const r = run({ title: 't', items: ['a', 'b', 'c', 'd', 'e'].map((id) => item(id)) })
    expect(ids(r, {})).toEqual(['a', 'b', 'c'])
    expect(ids(r, { a: working('a'), b: working('b') })).toEqual(['c'])
    expect(ids(r, { a: working('a'), b: working('b'), c: working('c') })).toEqual([])
    expect(ids(r, { a: inReview('a'), b: working('b'), c: working('c') })).toEqual(['d'])
    // A started item with no agent running still holds its slot.
    const idle = facts({ task: { path: '~/w/a', pr: null } })
    expect(ids({ ...r, maxParallel: 1 }, { a: idle })).toEqual([])
  })

  it('starts nothing while paused or cancelled', () => {
    expect(ids(run(epic, { paused: true }), {})).toEqual([])
    expect(ids(run(epic, { cancelled: true }), {})).toEqual([])
  })

  it('counts a branch that has a task as started, even when the run never recorded it', () => {
    const r = run(epic)
    expect(itemStates(r, { '201': working('201') })['201']).toMatchObject({
      phase: 'working',
      agent: 'working',
      path: '~/w/201'
    })
    expect(ids(r, { '201': working('201') })).toEqual([])
  })

  it('waits on an external item until someone marks it done or its pull request merges', () => {
    const r = run({
      title: 't',
      items: [item('a', ['x']), { id: 'x', title: 'X', external: true }]
    })
    expect(phases(r, {})).toEqual({ x: 'waiting', a: 'waiting' })
    expect(ids({ ...r, records: { x: { doneAt: 1 } } }, {})).toEqual(['a'])
    expect(ids(r, { x: facts({ prState: 'merged' }) })).toEqual(['a'])
    expect(ids(r, { x: facts({ prState: 'open' }) })).toEqual([])
  })
})

describe('stuck items', () => {
  it('is stuck when its worktree is gone, its task failed, or its pull request closed', () => {
    const r = run({ title: 't', items: [item('a'), item('b'), item('c'), item('d', ['a'])] })
    const s = itemStates(
      {
        ...r,
        records: {
          a: { startedAt: 1 },
          b: { startedAt: 1, error: 'feat/b is checked out in ~/dev/app already' }
        }
      },
      { c: facts({ task: { path: '~/w/c', pr: pr('closed', { number: 9 }) } }) }
    )
    expect(s.a).toMatchObject({ phase: 'stuck', reason: 'Its worktree is gone' })
    expect(s.b).toMatchObject({
      phase: 'stuck',
      reason: 'feat/b is checked out in ~/dev/app already'
    })
    expect(s.c).toMatchObject({
      phase: 'stuck',
      reason: 'Its pull request #9 closed without merging'
    })
    // Its dependents keep waiting, and a stuck item frees its slot.
    expect(s.d).toMatchObject({ phase: 'waiting', waitingOn: ['a'] })
  })

  it('ignores the pull request that closed before a retry', () => {
    const r = run(
      { title: 't', items: [item('a')] },
      { records: { a: { startedAt: 1, ignoredPr: 9 } } }
    )
    const closed = facts({
      task: { path: '~/w/a', pr: pr('closed', { number: 9 }) },
      agent: 'idle'
    })
    expect(itemStates(r, { a: closed }).a).toMatchObject({ phase: 'working', pr: null })
  })

  it('reads an item being made as working, so it holds a slot and starts once', () => {
    const r = run({ title: 't', items: [item('a'), item('b')] }, { maxParallel: 1 })
    expect(phases(r, { a: facts({ starting: true }) })).toEqual({ a: 'working', b: 'ready' })
    expect(ids(r, { a: facts({ starting: true }) })).toEqual([])
  })
})

describe('itemStates and nextToStart in stack mode', () => {
  it("stacks the issue's items, and waits for a merge across repositories", () => {
    const r = run(issue, { mode: 'stack' })
    expect(ids(r, {})).toEqual(['sc-101'])
    const one = { 'sc-101': inReview('sc-101') }
    expect(nextToStart(r, itemStates(r, one))).toEqual([{ id: 'sc-102', stackedOn: 'sc-101' }])

    // sc-101 is under sc-102, so sc-103 can start on sc-102.
    const stacked = { ...r, records: { 'sc-102': { startedAt: 1, stackedOn: 'sc-101' } } }
    const two = { ...one, 'sc-102': inReview('sc-102', 'me/sc-101', 2) }
    expect(nextToStart(stacked, itemStates(stacked, two))).toEqual([
      { id: 'sc-103', stackedOn: 'sc-102' }
    ])

    // sc-104 is in another repository and waits on an external item.
    const three = {
      ...two,
      'sc-103': inReview('sc-103', 'me/sc-102', 3)
    }
    expect(itemStates(stacked, three)['sc-104']).toMatchObject({
      phase: 'waiting',
      waitingOn: ['sc-103', 'sc-90']
    })
    const done = {
      ...stacked,
      records: { ...stacked.records, 'sc-90': { doneAt: 1 } }
    }
    expect(ids(done, { ...three, 'sc-103': merged('sc-103') })).toEqual(['sc-104'])
  })

  it("stacks an eight-story epic, and holds 208 while its blockers' pull requests are side by side", () => {
    const r = run(epic, { mode: 'stack', maxParallel: 10 })
    expect(nextToStart(r, itemStates(r, { '201': inReview('201') }))).toEqual([
      { id: '204', stackedOn: '201' },
      { id: '202', stackedOn: '201' }
    ])

    const records = {
      '204': { startedAt: 1, stackedOn: '201' },
      '202': { startedAt: 1, stackedOn: '201' },
      '203': { startedAt: 1, stackedOn: '202' },
      '206': { startedAt: 1, stackedOn: '203' }
    }
    const open = {
      '201': inReview('201'),
      '204': inReview('204', 'me/201'),
      '202': inReview('202', 'me/201'),
      '203': inReview('203', 'me/202'),
      '206': inReview('206', 'me/203')
    }
    const s = itemStates({ ...r, records }, open)
    expect(s['208']).toMatchObject({ phase: 'waiting', waitingOn: ['204', '206'] })
    expect(s['205']).toMatchObject({ phase: 'ready', startsOn: '204' })

    // Once 204 merges, 208 starts on 206.
    const after = { ...open, '204': merged('204', 'me/201') }
    expect(itemStates({ ...r, records }, after)['204']).toMatchObject({
      phase: 'review',
      mergedInto: 'me/201'
    })
    const all = { ...after, '201': merged('201') }
    expect(itemStates({ ...r, records }, all)['208']).toMatchObject({
      phase: 'ready',
      startsOn: '206'
    })
  })

  it('counts a merge into the branch below as done once that item is done, and flags the rebase', () => {
    const r = run(
      { title: 't', items: [item('a'), item('b', ['a'])] },
      { mode: 'stack', records: { b: { startedAt: 1, stackedOn: 'a' } } }
    )
    expect(itemStates(r, { a: inReview('a'), b: merged('b', 'me/a') }).b?.phase).toBe('review')
    expect(itemStates(r, { a: merged('a'), b: merged('b', 'me/a') }).b?.phase).toBe('done')
    expect(itemStates(r, { a: merged('a'), b: inReview('b', 'me/a') }).b).toMatchObject({
      phase: 'review',
      baseMerged: true
    })
  })

  it('starts from the default branch once every blocker is done', () => {
    const r = run(epic, { mode: 'stack' })
    expect(nextToStart(r, itemStates(r, { '201': merged('201') }))).toEqual([
      { id: '204', stackedOn: null },
      { id: '202', stackedOn: null }
    ])
  })
})

describe('promptFor and progress', () => {
  it("adds the pull request line, and counts what's done", () => {
    expect(promptFor({ prompt: 'Start story 101' }, 'main')).toBe(
      'Start story 101\n\nWhen the work is ready, push this branch and open a pull request against main.'
    )
    const r = run({ title: 't', items: [item('a'), item('b')] })
    expect(progress(itemStates(r, { a: merged('a') }))).toEqual({ done: 1, total: 2 })
  })
})

describe('readRun', () => {
  it('reads back what was saved, and fills in what an older file leaves out', () => {
    const r = run(issue, {
      mode: 'stack',
      paused: true,
      records: { 'sc-101': { startedAt: 5 } },
      source: { kind: 'widget', widgetId: 'shortcut-stories' }
    })
    expect(readRun(JSON.parse(JSON.stringify({ version: RUN_VERSION, ...r })))).toEqual(r)
    const minimal = readRun({ id: 'r2', title: 't', items: [item('a')] })
    expect(minimal).toMatchObject({
      mode: 'merge',
      maxParallel: 3,
      paused: false,
      cancelled: false,
      records: {},
      source: { kind: 'script' }
    })
  })

  it('refuses a newer version, a bad id, and a broken graph, and drops records for unknown items', () => {
    expect(
      readRun({ version: RUN_VERSION + 1, id: 'r', title: 't', items: [item('a')] })
    ).toBeNull()
    expect(readRun({ id: '../x', title: 't', items: [item('a')] })).toBeNull()
    expect(readRun({ id: 'r', title: 't', items: [item('a', ['b'])] })).toBeNull()
    const r = readRun({
      id: 'r',
      title: 't',
      items: [item('a')],
      records: { a: { startedAt: 'soon', doneAt: 3 }, gone: { startedAt: 1 } }
    })
    expect(r?.records).toEqual({ a: { doneAt: 3 } })
  })
})
