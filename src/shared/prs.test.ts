import { describe, expect, it } from 'bun:test'
import {
  checkPrompt,
  feedbackPrompt,
  isPrRef,
  prRefFromUrl,
  stripHtmlComments,
  threadPlace,
  type PrNote,
  type PrThread
} from './prs'

const pr = {
  repo: 'o/r',
  number: 7,
  title: 'Fix login',
  url: 'https://github.com/o/r/pull/7',
  branch: 'me/fix'
}

const note = (
  author: string,
  body: string,
  url = `https://github.com/o/r/pull/7#${author}`
): PrNote => ({
  id: author,
  author,
  bot: false,
  body,
  at: 0,
  url
})

const thread = (extra: Partial<PrThread> = {}): PrThread => ({
  id: 'T1',
  path: 'src/a.ts',
  line: 42,
  startLine: null,
  originalLine: 40,
  resolved: false,
  outdated: false,
  hunk: '',
  comments: [note('alice', 'This loses the return URL.'), note('bob', 'Agreed.')],
  canReply: true,
  canResolve: true,
  canUnresolve: false,
  ...extra
})

describe('PrRef', () => {
  it('reads a pull request URL', () => {
    expect(prRefFromUrl('https://github.com/o/r/pull/7')).toEqual({ repo: 'o/r', number: 7 })
    expect(prRefFromUrl('https://github.com/o/r/pull/7/files#x')).toEqual({
      repo: 'o/r',
      number: 7
    })
    expect(prRefFromUrl('https://github.com/o/r/issues/7')).toBeNull()
    expect(prRefFromUrl('https://example.com/o/r/pull/7')).toBeNull()
  })
  it('refuses repository names that could be flags or paths', () => {
    expect(isPrRef({ repo: 'o/r', number: 1 })).toBe(true)
    expect(isPrRef({ repo: 'o/r/x', number: 1 })).toBe(false)
    expect(isPrRef({ repo: 'o r/x', number: 1 })).toBe(false)
    expect(isPrRef({ repo: 'o/r', number: 0 })).toBe(false)
    expect(isPrRef({ repo: 'o/r', number: 1.5 })).toBe(false)
  })
})

describe('threadPlace', () => {
  it('names the line, a range, or the old line of an outdated thread', () => {
    expect(threadPlace(thread())).toBe('src/a.ts line 42')
    expect(threadPlace(thread({ startLine: 40 }))).toBe('src/a.ts lines 40-42')
    expect(threadPlace(thread({ line: null }))).toBe('src/a.ts line 40 (outdated)')
    expect(threadPlace(thread({ line: null, originalLine: null }))).toBe('src/a.ts')
  })
})

describe('feedbackPrompt', () => {
  it('lists each piece with where it is, who wrote it, and a link', () => {
    const text = feedbackPrompt(pr, [
      { kind: 'thread', thread: thread() },
      { kind: 'review', note: { ...note('carol', 'Add a test.\n\nThanks'), verdict: 'changes' } }
    ])
    expect(text).toBe(
      [
        'Address these pieces of review feedback on pull request #7, "Fix login" (https://github.com/o/r/pull/7), on branch me/fix.',
        '1. Review thread on src/a.ts line 42 (https://github.com/o/r/pull/7#alice):\n   alice: This loses the return URL.\n   bob: Agreed.',
        '2. Review by carol, changes requested (https://github.com/o/r/pull/7#carol):\n   Add a test.\n\n   Thanks',
        "Fix what each one asks for, or say why not. When you're done, say what you changed for each one."
      ].join('\n\n')
    )
  })

  it('speaks of one piece in the singular and drops HTML comments', () => {
    const text = feedbackPrompt(pr, [
      { kind: 'comment', note: note('dave', '<!-- bot:meta -->Rename it') }
    ])
    expect(text).toContain('Address this piece of review feedback')
    expect(text).toContain('1. Comment by dave (https://github.com/o/r/pull/7#dave):\n   Rename it')
    expect(text).toContain('Fix what it asks for')
  })

  it('stays under the prompt limit by linking what does not fit', () => {
    const big = 'x'.repeat(2_900)
    const items = Array.from({ length: 12 }, (_, i) => ({
      kind: 'comment' as const,
      note: note(`u${String(i)}`, big)
    }))
    const text = feedbackPrompt(pr, items)
    expect(text.length).toBeLessThan(20_000)
    expect(text).toContain(
      '12. Too long to include here; read it at https://github.com/o/r/pull/7#u11'
    )
  })

  it('counts what is left once even the links run out', () => {
    const items = Array.from({ length: 300 }, (_, i) => ({
      kind: 'comment' as const,
      note: note(`user${String(i)}`, 'z'.repeat(2_000))
    }))
    const text = feedbackPrompt(pr, items)
    expect(text.length).toBeLessThan(20_000)
    expect(text).toMatch(
      /\n\n\d+ more didn't fit here\. Read them on the pull request: https:\/\/github\.com\/o\/r\/pull\/7\n\n/
    )
  })

  it('cuts a very long comment and says where the rest is', () => {
    const text = feedbackPrompt(pr, [{ kind: 'comment', note: note('e', 'y'.repeat(5_000)) }])
    expect(text).toContain('… (cut short; the rest is at https://github.com/o/r/pull/7#e)')
  })
})

describe('checkPrompt', () => {
  const check = {
    name: 'test',
    workflow: 'check',
    state: 'failing' as const,
    url: 'https://github.com/o/r/actions/runs/1/job/2',
    jobId: 2
  }
  it('includes the end of the log, without breaking its code fence', () => {
    const text = checkPrompt(pr, check, 'line 1\n```\nline 2')
    expect(text).toContain('The check "check / test" failed on pull request #7')
    expect(text).toContain("```\nline 1\n'''\nline 2\n```")
  })
  it('says how to read the log when there is none', () => {
    expect(checkPrompt(pr, check, null)).toContain(
      'Read its log with `gh run view --job 2 --log-failed --repo o/r`.'
    )
  })
})

describe('stripHtmlComments', () => {
  it('removes every comment, across lines', () => {
    expect(stripHtmlComments('<!-- a\nb -->Hi<!-- c --> there')).toBe('Hi there')
  })
})
