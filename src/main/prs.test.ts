import { describe, expect, it } from 'bun:test'
import { filterPrs } from '@shared/prs'
import {
  checkState,
  failedLogTail,
  parsePrDetail,
  parsePrs,
  prActArgs,
  readPrAct,
  rollup
} from './prs'

const pr = (author: Record<string, unknown>, extra: Record<string, unknown> = {}): unknown => ({
  number: 1,
  title: 't',
  url: 'https://github.com/o/r/pull/1',
  author,
  isDraft: false,
  headRefName: 'b',
  reviewDecision: '',
  updatedAt: '2026-10-08T19:35:46Z',
  reviewRequests: [],
  statusCheckRollup: [],
  ...extra
})

describe('parsePrs', () => {
  it('finds bots by flag, app/ login, or [bot] in the login or name', () => {
    const prs = parsePrs(
      [
        pr({ login: 'app/claude', is_bot: true }),
        pr({ login: 'renovate[bot]', is_bot: false }),
        pr({ login: 'app-user', name: 'Dependabot [bot]' }),
        pr({ login: 'octocat', name: 'Mona' })
      ],
      'octocat'
    )
    expect(prs.map((p) => p.bot)).toEqual([true, true, true, false])
    expect(filterPrs(prs, 'bots')).toHaveLength(3)
    expect(filterPrs(prs, 'mine').map((p) => p.author)).toEqual(['octocat'])
    expect(filterPrs(prs, 'others')).toHaveLength(0)
  })

  it('marks review requests for the viewer and the review decision', () => {
    const [p] = parsePrs(
      [pr({ login: 'x' }, { reviewRequests: [{ login: 'me' }], reviewDecision: 'APPROVED' })],
      'me'
    )
    expect(p).toMatchObject({ toReview: true, review: 'approved', mine: false })
  })
})

describe('rollup', () => {
  it('fails on any failure, else pends on anything running, else passes', () => {
    expect(rollup([])).toBeNull()
    expect(rollup([{ status: 'COMPLETED', conclusion: 'SUCCESS' }])).toBe('passing')
    expect(rollup([{ status: 'IN_PROGRESS', conclusion: '' }, { state: 'SUCCESS' }])).toBe(
      'pending'
    )
    expect(rollup([{ status: 'IN_PROGRESS' }, { state: 'FAILURE' }])).toBe('failing')
  })
})

const detail = (pr: Record<string, unknown>, repo: Record<string, unknown> = {}): unknown => ({
  data: {
    viewer: { login: 'me' },
    repository: {
      nameWithOwner: 'o/r',
      mergeCommitAllowed: true,
      squashMergeAllowed: true,
      rebaseMergeAllowed: false,
      viewerDefaultMergeMethod: 'SQUASH',
      ...repo,
      pullRequest: {
        number: 7,
        title: 'Fix login',
        url: 'https://github.com/o/r/pull/7',
        state: 'OPEN',
        isDraft: false,
        body: 'Body',
        updatedAt: '2026-11-08T10:00:00Z',
        headRefName: 'me/sc-1/fix',
        baseRefName: 'main',
        isCrossRepository: false,
        reviewDecision: 'CHANGES_REQUESTED',
        mergeable: 'MERGEABLE',
        viewerCanUpdate: true,
        author: { __typename: 'User', login: 'me' },
        comments: { nodes: [] },
        reviews: { nodes: [] },
        reviewThreads: { nodes: [] },
        commits: { nodes: [] },
        ...pr
      }
    }
  }
})

describe('parsePrDetail', () => {
  it('reads the pull request, with the default merge method first', () => {
    const r = parsePrDetail(detail({}, { viewerDefaultMergeMethod: 'MERGE' }))
    if (!r.ok) throw new Error(r.error)
    expect(r.pr).toMatchObject({
      repo: 'o/r',
      number: 7,
      state: 'open',
      branch: 'me/sc-1/fix',
      base: 'main',
      review: 'changes',
      mergeable: 'yes',
      mine: true,
      canUpdate: true,
      mergeMethods: ['merge', 'squash']
    })
  })

  it('reads threads, bots, deleted authors, and reviews worth showing', () => {
    const r = parsePrDetail(
      detail({
        reviews: {
          nodes: [
            {
              id: 'R1',
              author: { login: 'a' },
              state: 'APPROVED',
              body: '',
              submittedAt: '2026-11-08T10:00:00Z',
              url: 'u1'
            },
            {
              id: 'R2',
              author: { login: 'me' },
              state: 'PENDING',
              body: 'draft',
              submittedAt: null,
              url: 'u2'
            }
          ]
        },
        reviewThreads: {
          nodes: [
            {
              id: 'T1',
              isResolved: false,
              isOutdated: true,
              path: 'src/a.ts',
              line: null,
              startLine: null,
              originalLine: 12,
              viewerCanReply: true,
              viewerCanResolve: true,
              viewerCanUnresolve: false,
              comments: {
                nodes: [
                  {
                    id: 'C1',
                    author: { __typename: 'Bot', login: 'coderabbitai' },
                    body: 'Nit',
                    createdAt: '2026-11-08T09:00:00Z',
                    url: 'c1',
                    diffHunk: '@@ -1 +1 @@\n-a\n+b'
                  },
                  {
                    id: 'C2',
                    author: null,
                    body: 'ok',
                    createdAt: '2026-11-08T09:05:00Z',
                    url: 'c2'
                  }
                ]
              }
            }
          ]
        }
      })
    )
    if (!r.ok) throw new Error(r.error)
    expect(r.pr.reviews.map((x) => [x.id, x.verdict])).toEqual([['R1', 'approved']])
    const [t] = r.pr.threads
    expect(t).toMatchObject({
      id: 'T1',
      outdated: true,
      line: null,
      originalLine: 12,
      hunk: '@@ -1 +1 @@\n-a\n+b'
    })
    expect(t?.comments.map((c) => [c.author, c.bot])).toEqual([
      ['coderabbitai', true],
      ['ghost', false]
    ])
  })

  it('orders checks failing first and keeps job ids only for Actions runs', () => {
    const r = parsePrDetail(
      detail({
        commits: {
          nodes: [
            {
              commit: {
                statusCheckRollup: {
                  contexts: {
                    nodes: [
                      {
                        __typename: 'CheckRun',
                        name: 'lint',
                        status: 'COMPLETED',
                        conclusion: 'SUCCESS',
                        detailsUrl: 'https://github.com/x',
                        databaseId: 1,
                        checkSuite: { workflowRun: { workflow: { name: 'check' } } }
                      },
                      {
                        __typename: 'StatusContext',
                        context: 'ci/circle',
                        state: 'PENDING',
                        targetUrl: 'https://circleci.com/x'
                      },
                      {
                        __typename: 'CheckRun',
                        name: 'test',
                        status: 'COMPLETED',
                        conclusion: 'FAILURE',
                        detailsUrl: 'https://github.com/y',
                        databaseId: 2,
                        checkSuite: { workflowRun: { workflow: { name: 'check' } } }
                      },
                      {
                        __typename: 'CheckRun',
                        name: 'app',
                        status: 'COMPLETED',
                        conclusion: 'FAILURE',
                        detailsUrl: 'javascript:alert(1)',
                        databaseId: 3,
                        checkSuite: { workflowRun: null }
                      }
                    ]
                  }
                }
              }
            }
          ]
        }
      })
    )
    if (!r.ok) throw new Error(r.error)
    expect(r.pr.checks.map((c) => [c.name, c.state, c.jobId, c.url])).toEqual([
      ['app', 'failing', null, null],
      ['test', 'failing', 2, 'https://github.com/y'],
      ['ci/circle', 'pending', null, 'https://circleci.com/x'],
      ['lint', 'passing', 1, 'https://github.com/x']
    ])
  })

  it('reports GraphQL errors and missing pull requests', () => {
    expect(parsePrDetail({ errors: [{ message: 'Could not resolve' }] })).toEqual({
      ok: false,
      error: 'Could not resolve'
    })
    expect(parsePrDetail({ data: { repository: { pullRequest: null } } }).ok).toBe(false)
  })
})

describe('checkState', () => {
  it('maps check runs and commit statuses', () => {
    expect(checkState({ status: 'IN_PROGRESS' })).toBe('pending')
    expect(checkState({ status: 'COMPLETED', conclusion: 'SKIPPED' })).toBe('skipped')
    expect(checkState({ status: 'COMPLETED', conclusion: 'TIMED_OUT' })).toBe('failing')
    expect(checkState({ __typename: 'StatusContext', state: 'ERROR' })).toBe('failing')
    expect(checkState({ __typename: 'StatusContext', state: 'EXPECTED' })).toBe('pending')
  })
})

describe('readPrAct', () => {
  it('accepts well-formed actions', () => {
    expect(readPrAct({ type: 'comment', body: 'hi' })).toEqual({ type: 'comment', body: 'hi' })
    expect(readPrAct({ type: 'resolve', threadId: 'PRRT_kwDO1', resolved: false })).toEqual({
      type: 'resolve',
      threadId: 'PRRT_kwDO1',
      resolved: false
    })
    expect(readPrAct({ type: 'review', verdict: 'approve' })).toEqual({
      type: 'review',
      verdict: 'approve',
      body: ''
    })
    expect(readPrAct({ type: 'merge', method: 'rebase' })).toEqual({
      type: 'merge',
      method: 'rebase'
    })
  })

  it('refuses empty or oversized bodies, odd ids, and unknown types', () => {
    expect(readPrAct({ type: 'comment', body: '  ' })).toBeNull()
    expect(readPrAct({ type: 'comment', body: 'x'.repeat(70_000) })).toBeNull()
    expect(readPrAct({ type: 'reply', threadId: '../x', body: 'hi' })).toBeNull()
    expect(readPrAct({ type: 'review', verdict: 'changes', body: '' })).toBeNull()
    expect(readPrAct({ type: 'merge', method: 'octopus' })).toBeNull()
    expect(readPrAct({ type: 'delete' })).toBeNull()
  })
})

describe('prActArgs', () => {
  const ref = { repo: 'o/r', number: 7 }
  it('keeps a body that starts with a dash as a value', () => {
    expect(prActArgs(ref, { type: 'comment', body: '--delete-branch' })).toEqual([
      'pr',
      'comment',
      '7',
      '--repo',
      'o/r',
      '--body=--delete-branch'
    ])
  })
  it('merges with the chosen method and nothing else', () => {
    expect(prActArgs(ref, { type: 'merge', method: 'squash' })).toEqual([
      'pr',
      'merge',
      '7',
      '--repo',
      'o/r',
      '--squash'
    ])
  })
  it('leaves out an empty approval body', () => {
    expect(prActArgs(ref, { type: 'review', verdict: 'approve', body: ' ' })).toEqual([
      'pr',
      'review',
      '7',
      '--repo',
      'o/r',
      '--approve'
    ])
  })
})

describe('failedLogTail', () => {
  it('drops the job name and time stamps and heads each step', () => {
    const out = [
      '﻿check\tRun tests\t2026-11-08T12:07:01.4695580Z \x1b[31mFAIL\x1b[0m a.test.ts',
      'check\tRun tests\t2026-11-08T12:07:01.4799290Z expected 1',
      'check\tSmoke test\t2026-11-08T12:07:02.0000000Z exited with code 1',
      'not a log line'
    ].join('\n')
    expect(failedLogTail(out)).toBe(
      '== Run tests ==\nFAIL a.test.ts\nexpected 1\n== Smoke test ==\nexited with code 1'
    )
    expect(failedLogTail(out, 2)).toBe('== Smoke test ==\nexited with code 1')
  })
})
