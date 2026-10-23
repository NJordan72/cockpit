import { describe, expect, it } from 'vitest'
import type { ActivityEntry, PaneActivity } from '@shared/activity'
import {
  applyUpdate,
  filterLog,
  formatDuration,
  gitCode,
  loggedCount,
  splitPath,
  toggleFilter
} from './model'

const entry = (seq: number, kind: ActivityEntry['kind'] = 'tool'): ActivityEntry => ({
  seq,
  at: 0,
  kind,
  label: '',
  text: String(seq),
  detail: null,
  agent: null,
  command: null
})

const empty = (paneId = 'p1'): PaneActivity => ({ paneId, entries: [], files: [], agents: [] })

describe('applyUpdate', () => {
  it('appends new entries, skips ones it has, and replaces lists that came along', () => {
    let a = applyUpdate(empty(), { paneId: 'p1', entries: [entry(1), entry(2)] })
    a = applyUpdate(a, { paneId: 'p1', entries: [entry(2), entry(3)], files: [] })
    expect(a.entries.map((e) => e.seq)).toEqual([1, 2, 3])
    expect(loggedCount(a)).toBe(3)
    const same = applyUpdate(a, { paneId: 'p1', entries: [entry(3)] })
    expect(same.entries).toBe(a.entries)
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
