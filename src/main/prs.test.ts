import { describe, expect, it } from 'vitest'
import { filterPrs } from '@shared/prs'
import { parsePrs, rollup } from './prs'

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
