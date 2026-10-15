import { describe, expect, it } from 'vitest'
import { fuzzyScore, rankDirs } from './rankDirs'

const listing = {
  recent: ['~/dev/cockpit', '~/dev/api'],
  projects: [
    { path: '~/dev/api', name: 'api', mtimeMs: 3 },
    { path: '~/dev/web-console', name: 'web-console', mtimeMs: 2 },
    { path: '~/dev/cockpit', name: 'cockpit', mtimeMs: 1 }
  ]
}

describe('rankDirs', () => {
  it('lists current, then recent, then projects, without duplicates', () => {
    expect(rankDirs('', '~/dev/web-console', listing).map((d) => [d.path, d.tag])).toEqual([
      ['~/dev/web-console', 'current'],
      ['~/dev/cockpit', 'recent'],
      ['~/dev/api', 'recent']
    ])
  })

  it('filters by name before path', () => {
    expect(rankDirs('cock', null, listing).map((d) => d.path)).toEqual(['~/dev/cockpit'])
    expect(rankDirs('wc', null, listing).map((d) => d.path)).toEqual(['~/dev/web-console'])
  })

  it('offers a typed path', () => {
    expect(rankDirs('~/tmp', null, listing)[0]).toEqual({
      path: '~/tmp',
      label: 'tmp',
      tag: 'path'
    })
  })
})

describe('fuzzyScore', () => {
  it('prefers substrings over scattered matches', () => {
    const sub = fuzzyScore('cock', 'cockpit')
    const fuzzy = fuzzyScore('cpt', 'cockpit')
    expect(sub).not.toBeNull()
    expect(fuzzy).not.toBeNull()
    expect(sub ?? 0).toBeLessThan(fuzzy ?? 0)
    expect(fuzzyScore('xyz', 'cockpit')).toBeNull()
  })
})
