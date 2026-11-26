import { describe, expect, it } from 'bun:test'
import type { PaneSession } from '@shared/ipc'
import type { ItemState, RunItemView, RunView } from '@shared/runs'
import type { TaskPr } from '@shared/tasks'
import { itemDot, itemMeta, phaseLabel, runMeta } from './model'

const session = (id: string, cwd: string, extra: Partial<PaneSession> = {}): PaneSession => ({
  id,
  tabId: 't',
  presetId: 'claude',
  name: 'Claude Code',
  cwd,
  branch: null,
  status: 'idle',
  since: 0,
  agent: 'claude',
  title: null,
  tokens: null,
  focused: false,
  message: null,
  labels: [],
  background: null,
  activeMs: 0,
  toolCalls: 0,
  ...extra
})

const pr = (extra: Partial<TaskPr> = {}): TaskPr => ({
  number: 12,
  title: 't',
  url: 'u',
  state: 'open',
  draft: false,
  checks: 'passing',
  review: null,
  head: 'h',
  base: 'main',
  ...extra
})

const state = (extra: Partial<ItemState>): ItemState => ({
  phase: 'waiting',
  waitingOn: [],
  startsOn: null,
  agent: null,
  path: null,
  pr: null,
  mergedInto: null,
  baseMerged: false,
  reason: null,
  ...extra
})

const item = (extra: Partial<ItemState>): RunItemView => ({
  id: 'sc-102',
  title: 'Issue tokens',
  branch: 'me/sc-102',
  prompt: 'p',
  after: ['sc-101'],
  state: state(extra)
})

const merge = { mode: 'merge' as const, paused: false }
const stack = { mode: 'stack' as const, paused: false }

describe('the Runs panel model', () => {
  it('names each phase, with Needs input for an agent waiting on the user', () => {
    expect(phaseLabel(state({ phase: 'working', agent: 'needs-input' }))).toBe('Needs input')
    expect(phaseLabel(state({ phase: 'working', agent: 'working' }))).toBe('Working')
    expect(phaseLabel(state({ phase: 'review' }))).toBe('In review')
    expect(itemDot(state({ phase: 'working', agent: null }))).toBe('exited')
    expect(itemDot(state({ phase: 'working', agent: 'working' }))).toBe('working')
  })

  it('says what an item waits on, where it starts, and how its pull request stands', () => {
    expect(itemMeta(item({ waitingOn: ['sc-101', 'sc-90'] }), merge)).toBe('Waits on sc-101, sc-90')
    expect(itemMeta(item({ phase: 'ready', startsOn: 'sc-101' }), stack)).toBe(
      'Starts on sc-101 when a slot frees up'
    )
    expect(itemMeta(item({ phase: 'ready' }), { ...merge, paused: true })).toBe(
      'Starts when the run resumes'
    )
    expect(itemMeta(item({ phase: 'working' }), merge)).toBe('No agent running. Click to open one')
    expect(itemMeta(item({ phase: 'review', pr: pr({ base: 'me/sc-101' }) }), stack)).toBe(
      '#12 open · into me/sc-101'
    )
    expect(
      itemMeta(
        item({ phase: 'review', pr: pr({ state: 'merged' }), mergedInto: 'me/sc-101' }),
        stack
      )
    ).toBe("#12 merged · merged into me/sc-101, which isn't done")
    expect(itemMeta(item({ phase: 'review', pr: pr(), baseMerged: true }), merge)).toBe(
      '#12 open · the branch under it merged, so rebase it'
    )
    expect(itemMeta(item({ phase: 'stuck', reason: 'Its worktree is gone' }), merge)).toBe(
      'Its worktree is gone'
    )
  })

  it('describes a run by its progress, its mode, and whether it is going', () => {
    const v: RunView = {
      id: 'r',
      title: 'Epic',
      pending: false,
      mode: 'stack',
      maxParallel: 3,
      presetId: 'claude',
      paused: false,
      cancelled: false,
      finished: false,
      done: 2,
      total: 5,
      createdAt: 0,
      items: []
    }
    expect(runMeta(v)).toBe('2/5 done · stacks pull requests · 3 at a time')
    expect(runMeta({ ...v, paused: true })).toBe('2/5 done · stacks pull requests · paused')
    expect(runMeta({ ...v, cancelled: true, paused: true })).toBe(
      '2/5 done · stacks pull requests · cancelled'
    )
  })

  it('rolls up active time, tool calls, and tokens onto run and item rows', () => {
    const a = item({ phase: 'working', agent: 'working', path: '~/.cockpit/worktrees/app/a' })
    const b: RunItemView = {
      ...item({ phase: 'review', path: '~/.cockpit/worktrees/app/b' }),
      id: 'sc-103'
    }
    const sessions = [
      session('p1', '~/.cockpit/worktrees/app/a', {
        status: 'working',
        since: 10_000,
        activeMs: 50_000,
        toolCalls: 6,
        tokens: 80_000
      }),
      session('p2', '~/.cockpit/worktrees/app/b/sub', {
        status: 'done',
        activeMs: 120_000,
        toolCalls: 4,
        tokens: 45_000
      })
    ]
    const v: RunView = {
      id: 'r',
      title: 'Epic',
      pending: false,
      mode: 'merge',
      maxParallel: 2,
      presetId: 'claude',
      paused: false,
      cancelled: false,
      finished: false,
      done: 1,
      total: 2,
      createdAt: 0,
      items: [a, b]
    }
    const first = sessions[0]
    if (!first) throw new Error('missing session')
    expect(itemMeta(a, merge, [first], 20_000)).toBe('Agent working · 1m · 6 tools · 80k tok')
    expect(runMeta(v, sessions, 20_000)).toBe(
      '1/2 done · waits for merges · 2 at a time · 3m · 10 tools · 125k tok'
    )
  })
})
