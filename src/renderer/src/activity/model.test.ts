import { describe, expect, it } from 'bun:test'
import type { ActivityEntry, AgentPlan, PaneActivity } from '@shared/activity'
import {
  applyUpdate,
  filterLog,
  formatDuration,
  gitCode,
  loggedCount,
  splitPath,
  toggleFilter
} from './model'
import { pickPlan, planKey, planStatus } from './PlanDialog'

const entry = (seq: number, kind: ActivityEntry['kind'] = 'tool'): ActivityEntry => ({
  seq,
  at: 0,
  kind,
  label: '',
  text: String(seq),
  detail: null,
  agent: null,
  command: null,
  file: null
})

const makePlan = (over: Partial<AgentPlan> = {}): AgentPlan => ({
  file: '/Users/me/.claude/plans/a.md',
  text: '# A',
  title: 'A',
  status: 'proposed',
  proposed: 1000,
  at: 1000,
  rounds: 1,
  ...over
})

const empty = (paneId = 'p1'): PaneActivity => ({
  paneId,
  entries: [],
  plans: [],
  files: [],
  agents: []
})

describe('applyUpdate', () => {
  it('appends new entries, skips ones it has, and replaces lists that came along', () => {
    let a = applyUpdate(empty(), { paneId: 'p1', entries: [entry(1), entry(2)] })
    a = applyUpdate(a, { paneId: 'p1', entries: [entry(2), entry(3)], files: [] })
    expect(a.entries.map((e) => e.seq)).toEqual([1, 2, 3])
    expect(loggedCount(a)).toBe(3)
    const same = applyUpdate(a, { paneId: 'p1', entries: [entry(3)] })
    expect(same.entries).toBe(a.entries)
  })

  it('replaces everything on a reset, even entries with seqs it has', () => {
    const a = applyUpdate(empty(), {
      paneId: 'p1',
      entries: [entry(1), entry(2), entry(3)],
      files: [],
      agents: []
    })
    const b = applyUpdate(a, { paneId: 'p1', entries: [entry(1, 'session')], reset: true })
    expect(b.entries).toEqual([entry(1, 'session')])
    expect(b.files).toEqual([])
    expect(loggedCount(b)).toBe(1)
    const c = applyUpdate(b, { paneId: 'p1', entries: [entry(2)] })
    expect(c.entries.map((e) => e.seq)).toEqual([1, 2])
  })

  it('keeps plans through a reset that brings none, and takes the ones that come', () => {
    const plan = makePlan({ file: '/p/a.md' })
    const a = applyUpdate(empty(), { paneId: 'p1', entries: [], plans: [plan] })
    expect(a.plans).toEqual([plan])
    const b = applyUpdate(a, { paneId: 'p1', entries: [entry(1)] })
    expect(b.plans).toBe(a.plans)
    const c = applyUpdate(b, { paneId: 'p1', entries: [], reset: true })
    expect(c.plans).toEqual([plan])
    const d = applyUpdate(c, { paneId: 'p1', entries: [], plans: [] })
    expect(d.plans).toEqual([])
  })

  it("ignores another pane's update and keeps at most the cap", () => {
    const a = empty()
    expect(applyUpdate(a, { paneId: 'p2', entries: [entry(1)] })).toBe(a)
    const many = Array.from({ length: 1005 }, (_, i) => entry(i + 1))
    const b = applyUpdate(a, { paneId: 'p1', entries: many })
    expect(b.entries).toHaveLength(1000)
    expect(b.entries[0]?.seq).toBe(6)
    expect(loggedCount(b)).toBe(1005)
    expect(loggedCount(null)).toBe(0)
  })
})

describe('log filter', () => {
  it('splits tool calls from everything else', () => {
    const log = [entry(1, 'session'), entry(2, 'tool'), entry(3, 'stop')]
    expect(filterLog(log, { events: true, tools: true })).toBe(log)
    expect(filterLog(log, { events: false, tools: true }).map((e) => e.seq)).toEqual([2])
    expect(filterLog(log, { events: true, tools: false }).map((e) => e.seq)).toEqual([1, 3])
  })

  it('never turns both switches off', () => {
    expect(toggleFilter({ events: true, tools: true }, 'tools')).toEqual({
      events: true,
      tools: false
    })
    expect(toggleFilter({ events: true, tools: false }, 'events')).toEqual({
      events: false,
      tools: true
    })
  })
})

describe('formatters', () => {
  it('formats durations', () => {
    expect(formatDuration(4200)).toBe('4s')
    expect(formatDuration(65_000)).toBe('1m 05s')
    expect(formatDuration(2 * 3600_000 + 3 * 60_000)).toBe('2h 03m')
    expect(formatDuration(-5)).toBe('0s')
  })

  it('splits paths into directory and name', () => {
    expect(splitPath('src/main/index.ts')).toEqual(['src/main/', 'index.ts'])
    expect(splitPath('README.md')).toEqual(['', 'README.md'])
    expect(splitPath('untracked dir/')).toEqual(['', 'untracked dir/'])
    expect(splitPath('a/b/')).toEqual(['a/', 'b/'])
  })

  it("shows git's status letters", () => {
    expect(gitCode({ path: 'a', from: null, index: '.', worktree: 'M' })).toBe(' M')
    expect(gitCode({ path: 'a', from: null, index: '?', worktree: '?' })).toBe('??')
  })
})

describe('plans', () => {
  it('shows the chosen plan while it exists, otherwise the newest', () => {
    const newest = makePlan({ file: '/p/b.md', title: 'B' })
    const older = makePlan({ file: '/p/a.md' })
    const unnamed = makePlan({ file: null, title: 'C' })
    const plans = [newest, older, unnamed]
    expect(pickPlan(plans, null)).toBe(newest)
    expect(pickPlan(plans, '/p/a.md')).toBe(older)
    expect(pickPlan(plans, planKey(unnamed))).toBe(unnamed)
    expect(pickPlan(plans, '/p/gone.md')).toBe(newest)
    expect(pickPlan([], null)).toBeUndefined()
  })

  it('says whether a plan was approved, and how many rounds it took', () => {
    const at = new Date(2026, 10, 6, 14, 5, 9).getTime()
    expect(planStatus(makePlan({ status: 'approved', at }))).toMatchObject({
      label: 'Approved',
      when: '14:05:09'
    })
    const proposed = planStatus(makePlan({ at, rounds: 3 }))
    expect(proposed).toMatchObject({ label: 'Proposed', when: '14:05:09 · 3 rounds' })
    expect(proposed.title).toContain('Not approved (yet)')
  })
})
