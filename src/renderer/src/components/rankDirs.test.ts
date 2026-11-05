import { describe, expect, it } from 'bun:test'
import type { DirEntry } from '@shared/ipc'
import { fuzzyScore, rankDirs } from './rankDirs'

const dir = (name: string): DirEntry => ({
  path: `~/dev/${name}`,
  name,
  mtimeMs: 1,
  usedMs: 0,
  usedPresetId: null
})
const listing = [dir('cockpit'), dir('api'), dir('web-console')]

describe('rankDirs', () => {
  it('lists current, then the rest in order, without duplicates', () => {
    expect(rankDirs('', '~/dev/web-console', listing).map((d) => [d.path, d.tag])).toEqual([
      ['~/dev/web-console', 'current'],
      ['~/dev/cockpit', undefined],
      ['~/dev/api', undefined]
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
