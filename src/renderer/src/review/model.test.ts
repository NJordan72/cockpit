import { describe, expect, it } from 'bun:test'
import type { PaneSession } from '@shared/ipc'
import type { DiffLine } from '@shared/review'
import type { TaskInfo } from '@shared/tasks'
import { findReviewPane, makeReviewPane } from '../layout/model'
import { buildLineExcerpt, resolveLineRange, reviewHandOffChoices, soleAgentInDir } from './model'

const session = (over: Partial<PaneSession> = {}): PaneSession => ({
  id: 'p1',
  tabId: 't1',
  presetId: 'claude',
  name: 'Claude Code',
  title: null,
  agent: 'claude',
  cwd: '~/dev/repo',
  branch: null,
  status: 'idle',
  focused: false,
  since: 0,
  tokens: null,
  message: null,
  labels: [],
  background: null,
  activeMs: 0,
  toolCalls: 0,
  model: null,
  ports: [],
  ...over
})

const task = (over: Partial<TaskInfo> = {}): TaskInfo => ({
  path: '~/.cockpit/worktrees/repo/feat-x',
  repo: '~/dev/repo',
  branch: 'feat/x',
  head: 'abc1234',
  changed: 1,
  unpushed: 0,
  pr: null,
  prError: null,
  inPr: false,
  createdAt: 0,
  ...over
})

describe('reviewHandOffChoices & soleAgentInDir', () => {
  it('puts the worktree agent first, then other agents, then a fresh agent', () => {
    const t = task()
    const inTask = session({ id: 'p-task', cwd: t.path, status: 'working' })
    const other = session({ id: 'p-other', cwd: '~/dev/other', name: 'Codex', agent: 'codex' })
    const exited = session({ id: 'p-dead', cwd: t.path, status: 'exited' })

    expect(soleAgentInDir(t.path, [inTask, other, exited], [t])?.id).toBe('p-task')

    const groups = reviewHandOffChoices(t.path, 'feat/x', [inTask, other, exited], [t])
    expect(groups).toHaveLength(3)
    expect(groups[0]?.[0]?.target).toEqual({ kind: 'pane', paneId: 'p-task' })
    expect(groups[0]?.[0]?.label).toContain('working')
    expect(groups[1]?.[0]?.target).toEqual({ kind: 'pane', paneId: 'p-other' })
    expect(groups[2]?.[0]?.target).toEqual({ kind: 'newSession', cwd: t.path })
  })

  it('offers a new agent in the task when none is running in it', () => {
    const t = task()
    expect(soleAgentInDir(t.path, [], [t])).toBeNull()
    const groups = reviewHandOffChoices(t.path, 'feat/x', [], [t])
    expect(groups[0]?.[0]?.target).toEqual({ kind: 'task', path: t.path })
  })
})

describe('buildLineExcerpt & resolveLineRange', () => {
  const lines: DiffLine[] = [
    { kind: 'context', oldLine: 10, newLine: 10, text: 'const a = 1' },
    { kind: 'del', oldLine: 11, newLine: null, text: 'const b = 2' },
    { kind: 'add', oldLine: null, newLine: 11, text: 'const b = 3' },
    { kind: 'add', oldLine: null, newLine: 12, text: 'const c = 4' }
  ]

  it('builds diff-prefixed excerpts regardless of selection direction', () => {
    expect(buildLineExcerpt(lines, 3, 1)).toBe('-const b = 2\n+const b = 3\n+const c = 4')
  })

  it('resolves new-side ranges when any new line is included, else old-side', () => {
    expect(resolveLineRange(lines, 1, 3)).toEqual({ startLine: 11, endLine: 12, side: 'new' })
    expect(resolveLineRange(lines, 1, 1)).toEqual({ startLine: 11, endLine: 11, side: 'old' })
  })
})

describe('findReviewPane', () => {
  it('finds an existing review pane by directory', () => {
    const p1 = makeReviewPane({ dir: '~/dev/a', branch: 'feat/a' })
    const p2 = makeReviewPane({ dir: '~/dev/b' })
    const tabs = [
      { id: 't1', root: p1 },
      { id: 't2', root: p2 }
    ]
    expect(findReviewPane(tabs, '~/dev/a')).toEqual({ tabId: 't1', paneId: p1.id })
    expect(findReviewPane(tabs, '~/dev/c')).toBeNull()
  })
})
