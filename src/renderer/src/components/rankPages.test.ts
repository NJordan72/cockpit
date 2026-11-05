import { describe, expect, it } from 'bun:test'
import type { RecentPage } from '@shared/config'
import { rankPages } from './rankPages'

const pages: RecentPage[] = [
  { url: 'http://localhost:5173/', title: 'Marketplace', at: 3 },
  { url: 'file:///Users/me/deck/dist/index.html', at: 2 },
  { url: 'https://example.com/', title: 'Example Domain', at: 1 }
]

describe('rankPages', () => {
  it('lists recent pages in order, by title or else a short name', () => {
    expect(rankPages('', pages).map((p) => p.label)).toEqual([
      'Marketplace',
      'index.html',
      'Example Domain'
    ])
  })

  it('filters by title before URL', () => {
    expect(rankPages('market', pages).map((p) => p.url)).toEqual(['http://localhost:5173/'])
    expect(rankPages('deck', pages).map((p) => p.url)).toEqual([
      'file:///Users/me/deck/dist/index.html'
    ])
  })

  it('offers a typed address first', () => {
    expect(rankPages('github.com', pages)[0]).toEqual({
      url: 'https://github.com/',
      label: 'github.com',
      tag: 'address'
    })
  })

  it("doesn't offer an address that's already listed", () => {
    expect(rankPages('example.com', pages).map((p) => p.tag)).toEqual([undefined])
  })
})
