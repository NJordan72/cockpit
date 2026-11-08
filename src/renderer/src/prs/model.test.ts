import { describe, expect, it } from 'bun:test'
import type { PaneSession } from '@shared/ipc'
import type { PrNote, PrReviewNote, PrThread } from '@shared/prs'
import type { TaskInfo } from '@shared/tasks'
import { findPrPane } from '../layout/model'
import { handOffChoices, hunkTail, sortThreads, taskFor, timeline } from './model'

const note = (id: string, at: number, body = 'x'): PrNote => ({
  id,
  author: 'a',
  bot: false,
  body,
  at,
  url: `u-${id}`
})

const review = (
  id: string,
  at: number,
  verdict: PrReviewNote['verdict'],
  body = ''
): PrReviewNote => ({
  ...note(id, at, body),
  verdict
})

const thread = (id: string, extra: Partial<PrThread>): PrThread => ({
  id,
  path: 'a.ts',
  line: 1,
  startLine: null,
  originalLine: 1,
  resolved: false,
  outdated: false,
  hunk: '',
  comments: [],
  canReply: true,
  canResolve: true,
  canUnresolve: false,
  ...extra
})

const session = (id: string, cwd: string, extra: Partial<PaneSession> = {}): PaneSession => ({
  id,
  tabId: 't',
  presetId: 'claude',
  name: 'Claude Code',
  cwd,
  status: 'idle',
  since: 0,
  agent: 'claude',
  title: null,
  tokens: null,
  focused: false,
  message: null,
  branch: null,
  labels: [],
  ...extra
})

const task = (path: string, branch: string, prUrl: string | null): TaskInfo => ({
  path,
  repo: '~/dev/r',
  branch,
  head: null,
  changed: 0,
  unpushed: 0,
  pr: prUrl
    ? {
        number: 7,
        title: 't',
        url: prUrl,
        state: 'open',
        draft: false,
        checks: null,
        review: null,
        head: 'abc'
      }
    : null,
  prError: null,
  inPr: true,
  createdAt: 0
})

const pr = {
  url: 'https://github.com/o/r/pull/7',
  branch: 'me/fix',
  fork: false,
  state: 'open' as const
}

describe('timeline', () => {
  it('puts comments and reviews in order and drops reviews that only hold thread comments', () => {
    const items = timeline({
      comments: [note('c2', 30), note('c1', 10)],
      reviews: [
        review('r1', 20, 'commented'),
        review('r2', 25, 'approved'),
        review('r3', 5, 'commented', 'Overall fine')
      ]
    })
    expect(items.map((i) => i.note.id)).toEqual(['r3', 'c1', 'r2', 'c2'])
  })
})

describe('sortThreads', () => {
  it('puts open threads first, then outdated, then resolved, each by file and line', () => {
    const sorted = sortThreads([
      thread('resolved', { resolved: true }),
      thread('old', { outdated: true, line: null, originalLine: 3 }),
      thread('b9', { path: 'b.ts', line: 9 }),
      thread('a5', { line: 5 }),
      thread('a2', { line: 2 })
    ])
    expect(sorted.map((t) => t.id)).toEqual(['a2', 'a5', 'b9', 'old', 'resolved'])
  })
})

describe('hunkTail', () => {
  it('keeps the last lines and drops the hunk header', () => {
    expect(hunkTail('@@ -1,3 +1,3 @@\n a\n-b\n+c', 2)).toEqual(['-b', '+c'])
  })
})

describe('taskFor', () => {
  it('matches by pull request, or by branch when gh had no answer', () => {
    const byPr = task('~/.cockpit/worktrees/r/a', 'other', pr.url)
    const byBranch = task('~/.cockpit/worktrees/r/b', 'me/fix', null)
    expect(taskFor(pr, [byBranch, byPr])).toBe(byPr)
    expect(taskFor(pr, [byBranch])).toBe(byBranch)
    expect(taskFor({ ...pr, fork: true }, [byBranch])).toBeNull()
  })
})

describe('handOffChoices', () => {
  const wt = '~/.cockpit/worktrees/r/me-fix'

  it("offers the agent in the pull request's task first, then the others, then a new agent", () => {
    const groups = handOffChoices(
      pr,
      '~/dev/r',
      [
        session('in-task', `${wt}/src`, { title: 'Fixing login' }),
        session('elsewhere', '~/dev/x'),
        session('shell', '~/dev/r', { agent: null }),
        session('gone', '~/dev/r', { status: 'exited' })
      ],
      [task(wt, 'me/fix', pr.url)]
    )
    expect(groups.map((g) => g.map((c) => c.target))).toEqual([
      [{ kind: 'pane', paneId: 'in-task' }],
      [{ kind: 'pane', paneId: 'elsewhere' }],
      [{ kind: 'newSession', cwd: '~/dev/r' }]
    ])
    expect(groups[0]?.[0]?.label).toBe('Fixing login in the task on me/fix')
  })

  it('offers a new agent in the task when none runs there', () => {
    const groups = handOffChoices(pr, '~/dev/r', [], [task(wt, 'me/fix', pr.url)])
    expect(groups[0]).toEqual([
      { label: 'New agent in the task on me/fix', target: { kind: 'task', path: wt } }
    ])
  })

  it('offers a new task only for an open pull request from this repository', () => {
    const first = (p: typeof pr): unknown => handOffChoices(p, '~/dev/r', [], [])[0]?.[0]?.target
    expect(first(pr)).toEqual({ kind: 'newTask', branch: 'me/fix', repo: '~/dev/r' })
    expect(first({ ...pr, fork: true })).toEqual({ kind: 'newSession', cwd: '~/dev/r' })
    expect(first({ ...pr, state: 'merged' as never })).toEqual({
      kind: 'newSession',
      cwd: '~/dev/r'
    })
  })
})

describe('findPrPane', () => {
  it('finds the pane already showing a pull request', () => {
    const tabs = [
      { id: 't1', root: { type: 'pane' as const, id: 'p1', presetId: 'shell', cwd: '~' } },
      {
        id: 't2',
        root: {
          type: 'pane' as const,
          id: 'p2',
          presetId: 'shell',
          cwd: '~',
          pr: { repo: 'o/r', number: 7 }
        }
      }
    ]
    expect(findPrPane(tabs, { repo: 'o/r', number: 7 })).toEqual({ tabId: 't2', paneId: 'p2' })
    expect(findPrPane(tabs, { repo: 'o/r', number: 8 })).toBeNull()
  })
})
