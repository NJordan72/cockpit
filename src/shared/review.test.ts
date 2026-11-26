import { describe, expect, it } from 'bun:test'
import {
  formatReviewPrompt,
  isReviewRef,
  parseUnifiedDiff,
  startsCollapsed,
  type ReviewComment
} from './review'

describe('isReviewRef', () => {
  it('accepts valid review refs and rejects malformed ones', () => {
    expect(isReviewRef({ dir: '~/dev/cockpit' })).toBe(true)
    expect(isReviewRef({ dir: '~/dev/cockpit', branch: 'feat/review' })).toBe(true)
    expect(isReviewRef(null)).toBe(false)
    expect(isReviewRef('~/dev/cockpit')).toBe(false)
    expect(isReviewRef({ dir: '' })).toBe(false)
    expect(isReviewRef({ dir: '~/dev/cockpit', branch: '' })).toBe(false)
    expect(isReviewRef({ dir: '~/dev/cockpit', branch: 42 })).toBe(false)
    expect(isReviewRef({ dir: 'a'.repeat(5000) })).toBe(false)
  })
})

describe('parseUnifiedDiff', () => {
  it('returns empty list for empty input', () => {
    expect(parseUnifiedDiff('')).toEqual({ files: [], truncated: false })
    expect(parseUnifiedDiff('   \n')).toEqual({ files: [], truncated: false })
  })

  it('parses modified, added, deleted, renamed, and binary files', () => {
    const raw = [
      'diff --git a/src/a.ts b/src/a.ts',
      'index 1111111..2222222 100644',
      '--- a/src/a.ts',
      '+++ b/src/a.ts',
      '@@ -10,4 +10,5 @@ function greet() {',
      ' const a = 1',
      '-const b = 2',
      '+const b = 3',
      '+const c = 4',
      ' return a + b',
      'diff --git a/src/new.ts b/src/new.ts',
      'new file mode 100644',
      '--- /dev/null',
      '+++ b/src/new.ts',
      '@@ -0,0 +1,2 @@',
      '+export const x = 1',
      '+export const y = 2',
      '\\ No newline at end of file',
      'diff --git a/src/old.ts b/src/old.ts',
      'deleted file mode 100644',
      '--- a/src/old.ts',
      '+++ /dev/null',
      '@@ -1,2 +0,0 @@',
      '-line1',
      '-line2',
      'diff --git a/src/from.ts b/src/to.ts',
      'similarity index 95%',
      'rename from src/from.ts',
      'rename to src/to.ts',
      '--- a/src/from.ts',
      '+++ b/src/to.ts',
      '@@ -1,1 +1,1 @@',
      '-old',
      '+new',
      'diff --git a/assets/logo.png b/assets/logo.png',
      'new file mode 100644',
      'Binary files /dev/null and b/assets/logo.png differ'
    ].join('\n')

    const { files, truncated } = parseUnifiedDiff(raw)
    expect(truncated).toBe(false)
    expect(files).toHaveLength(5)

    const [mod, added, del, renamed, bin] = files
    expect(mod).toMatchObject({
      path: 'src/a.ts',
      oldPath: null,
      status: 'modified',
      binary: false,
      added: 2,
      removed: 1,
      totalLines: 5,
      truncated: false
    })
    expect(mod?.hunks[0]?.lines).toEqual([
      { kind: 'context', oldLine: 10, newLine: 10, text: 'const a = 1' },
      { kind: 'del', oldLine: 11, newLine: null, text: 'const b = 2' },
      { kind: 'add', oldLine: null, newLine: 11, text: 'const b = 3' },
      { kind: 'add', oldLine: null, newLine: 12, text: 'const c = 4' },
      { kind: 'context', oldLine: 12, newLine: 13, text: 'return a + b' }
    ])

    expect(added).toMatchObject({ path: 'src/new.ts', status: 'added', added: 2, removed: 0 })
    expect(added?.hunks[0]?.lines[2]).toEqual({
      kind: 'meta',
      oldLine: null,
      newLine: null,
      text: '\\ No newline at end of file'
    })

    expect(del).toMatchObject({ path: 'src/old.ts', status: 'deleted', added: 0, removed: 2 })
    expect(renamed).toMatchObject({
      path: 'src/to.ts',
      oldPath: 'src/from.ts',
      status: 'renamed',
      added: 1,
      removed: 1
    })
    expect(bin).toMatchObject({ path: 'assets/logo.png', binary: true, hunks: [] })
  })

  it('caps per-file diff lines and marks the file truncated', () => {
    const body = Array.from({ length: 20 }, (_, i) => `+line ${String(i + 1)}`).join('\n')
    const raw = `diff --git a/big.txt b/big.txt\n--- /dev/null\n+++ b/big.txt\n@@ -0,0 +1,20 @@\n${body}`
    const { files } = parseUnifiedDiff(raw, { maxFileLines: 5 })
    const first = files[0]
    expect(first).toBeDefined()
    expect(first?.added).toBe(20)
    expect(first?.totalLines).toBe(20)
    expect(first?.truncated).toBe(true)
    expect(first?.hunks[0]?.lines).toHaveLength(5)
    if (first) expect(startsCollapsed(first)).toBe(true)
  })

  it('caps total number of files and marks the diff truncated', () => {
    const raw = ['a.ts', 'b.ts', 'c.ts']
      .map((f) => `diff --git a/${f} b/${f}\n--- a/${f}\n+++ b/${f}\n@@ -1 +1 @@\n-1\n+2`)
      .join('\n')
    const { files, truncated } = parseUnifiedDiff(raw, { maxFiles: 2 })
    expect(files.map((f) => f.path)).toEqual(['a.ts', 'b.ts'])
    expect(truncated).toBe(true)
  })
})

describe('formatReviewPrompt', () => {
  const comment = (overrides: Partial<ReviewComment> = {}): ReviewComment => ({
    id: 'c1',
    path: 'src/foo.ts',
    startLine: 12,
    endLine: 12,
    side: 'new',
    excerpt: '+const x = 1',
    body: 'Rename x to count.',
    ...overrides
  })

  it('returns empty string when there are no comments', () => {
    expect(formatReviewPrompt([])).toBe('')
  })

  it('formats a single comment with branch, line, and code excerpt', () => {
    const out = formatReviewPrompt([comment()], { branch: 'feat/diff', base: 'origin/main' })
    expect(out).toContain('this code review comment on branch `feat/diff` (vs `origin/main`):')
    expect(out).toContain('1. src/foo.ts line 12')
    expect(out).toContain('```diff\n+const x = 1\n```')
    expect(out).toContain('Rename x to count.')
  })

  it('sorts comments by file and line and formats ranges and removed lines', () => {
    const out = formatReviewPrompt([
      comment({ id: '2', path: 'src/b.ts', startLine: 5, endLine: 8, body: 'Extract helper.' }),
      comment({
        id: '1',
        path: 'src/a.ts',
        startLine: 3,
        endLine: 3,
        side: 'old',
        excerpt: '-oldCall()',
        body: 'Keep this call.'
      })
    ])
    const idxA = out.indexOf('1. src/a.ts line 3 (removed)')
    const idxB = out.indexOf('2. src/b.ts lines 5-8')
    expect(idxA).toBeGreaterThan(-1)
    expect(idxB).toBeGreaterThan(idxA)
  })

  it('escapes triple backticks in excerpts and stays within the prompt budget', () => {
    const many = Array.from({ length: 40 }, (_, i) =>
      comment({
        id: `c${String(i)}`,
        path: `src/f${String(i).padStart(2, '0')}.ts`,
        startLine: i + 1,
        endLine: i + 1,
        excerpt: '+const md = "```ts\\nfoo\\n```"',
        body: 'x'.repeat(800)
      })
    )
    const out = formatReviewPrompt(many)
    expect(out.length).toBeLessThanOrEqual(19_500)
    expect(out).not.toContain('```ts')
    expect(out).toContain('omitted to fit the prompt limit')
  })
})
