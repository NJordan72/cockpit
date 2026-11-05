import { describe, expect, it } from 'bun:test'
import { findPathCandidates } from './paths'

const paths = (line: string): string[] => findPathCandidates(line).map((c) => c.path)

describe('findPathCandidates', () => {
  it('finds home, absolute, and relative paths in prose', () => {
    expect(paths('run open ~/Desktop/rubric-talk/deck/dist/index.html. Arrow keys')).toEqual([
      '~/Desktop/rubric-talk/deck/dist/index.html'
    ])
    expect(paths('each slide is a short HTML file in slides/, with notes')).toEqual(['slides/'])
    expect(paths('see /etc/hosts and ./src/main.ts')).toEqual(['/etc/hosts', './src/main.ts'])
  })

  it('finds bare file names that have an extension', () => {
    expect(paths('Edited README.md and package.json')).toEqual(['README.md', 'package.json'])
    expect(paths('the end. Then more')).toEqual([])
  })

  it('drops line and column suffixes but keeps their span out of the link', () => {
    const [c] = findPathCandidates('at src/app.ts:12:4 here')
    expect(c).toEqual({ path: 'src/app.ts', start: 3, end: 13 })
  })

  it('stops at quotes, brackets, and backticks', () => {
    expect(paths('`src/a.ts` "b/c.txt" (d/e.md) [f/g.json]')).toEqual([
      'src/a.ts',
      'b/c.txt',
      'd/e.md',
      'f/g.json'
    ])
  })

  it('skips URLs, dates, and numbers', () => {
    expect(paths('https://example.com/a/b.html 2026/10/21 1/2 3.14')).toEqual([])
  })
})
