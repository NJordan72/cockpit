import { describe, expect, it } from 'bun:test'
import type { ItemState, RunItemView, RunView } from '@shared/runs'
import type { TaskPr } from '@shared/tasks'
import { itemDot, itemMeta, phaseLabel, runMeta } from './model'

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
})
