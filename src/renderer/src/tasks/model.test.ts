import { describe, expect, it } from 'bun:test'
import type { PaneSession } from '@shared/ipc'
import type { TaskInfo, TaskPr } from '@shared/tasks'
import { prChip, prTone, sessionsByTask, sessionToShow, taskMeta } from './model'

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

const task = (path: string, extra: Partial<TaskInfo> = {}): TaskInfo => ({
  path,
  repo: '~/dev/app',
  branch: 'feat/x',
  head: 'h',
  changed: 0,
  unpushed: 0,
  pr: null,
  prError: null,
  inPr: false,
  createdAt: 0,
  ...extra
})

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
  ...extra
})

describe('prTone and prChip', () => {
  it('colors a pull request by what it needs', () => {
    expect(prTone(null)).toBe('muted')
    expect(prTone(pr({ state: 'merged' }))).toBe('merged')
    expect(prTone(pr({ state: 'closed' }))).toBe('muted')
    expect(prTone(pr({ draft: true }))).toBe('muted')
    expect(prTone(pr({ checks: 'failing' }))).toBe('failing')
    expect(prTone(pr({ review: 'changes' }))).toBe('failing')
    expect(prTone(pr({ checks: 'pending' }))).toBe('pending')
    expect(prTone(pr())).toBe('passing')
    expect(prChip(pr({ state: 'merged' }))).toBe('#12 merged')
    expect(prChip(pr({ review: 'approved' }))).toBe('#12 approved')
    expect(prChip(pr({ checks: 'pending' }))).toBe('#12 checks')
  })
})

describe('sessions in tasks', () => {
  it('finds the sessions in each worktree, and the one to show', () => {
    const tasks = [task('~/.cockpit/worktrees/app/a'), task('~/.cockpit/worktrees/app/ab')]
    const sessions = [
      session('1', '~/.cockpit/worktrees/app/a'),
      session('2', '~/.cockpit/worktrees/app/a/src', { status: 'needs-input' }),
      session('3', '~/.cockpit/worktrees/app/ab', { focused: true }),
      session('4', '~/dev/app')
    ]
    const by = sessionsByTask(tasks, sessions)
    expect(by.get('~/.cockpit/worktrees/app/a')?.map((s) => s.id)).toEqual(['1', '2'])
    expect(by.get('~/.cockpit/worktrees/app/ab')?.map((s) => s.id)).toEqual(['3'])
    expect(sessionToShow(by.get('~/.cockpit/worktrees/app/a') ?? [])?.id).toBe('2')
    expect(sessionToShow(by.get('~/.cockpit/worktrees/app/ab') ?? [])?.id).toBe('3')
    expect(sessionToShow([])).toBeNull()
  })

  it('says what is open and unpushed, but not unpushed once merged', () => {
    expect(taskMeta(task('p', { changed: 2, unpushed: 1 }), 1)).toBe(
      'app · 1 terminal · 2 changed · 1 unpushed'
    )
    expect(taskMeta(task('p', { unpushed: 3, pr: pr({ state: 'merged' }) }), 0)).toBe('app')
  })
})
