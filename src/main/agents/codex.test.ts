import { describe, expect, it } from 'bun:test'
import { codexTitleState, CodexWatcher, parseCodexNotification } from './codex'

const title = (t: string): string => `\x1b]0;${t}\x07`
const notify = (t: string): string => `\x1b]9;${t}\x07`

describe('codexTitleState', () => {
  it('reads the run state', () => {
    expect(codexTitleState('⠋ Working')).toBe('working')
    expect(codexTitleState('⠙ Thinking')).toBe('working')
    expect(codexTitleState('Waiting')).toBe('working')
    expect(codexTitleState('Ready')).toBe('ready')
    expect(codexTitleState('Starting')).toBe('ready')
    expect(codexTitleState('[ ! ] Action Required | Working')).toBe('waiting')
    expect(codexTitleState('[ . ] Action Required')).toBe('waiting')
    expect(codexTitleState('')).toBeNull()
    expect(codexTitleState('~/dev/cockpit')).toBeNull()
  })
})

describe('parseCodexNotification', () => {
  it('tells requests from finished turns', () => {
    expect(parseCodexNotification('Approval requested: rm -rf build')).toMatchObject({
      kind: 'waiting',
      message: 'Approval requested: rm -rf build'
    })
    expect(parseCodexNotification('Codex wants to edit src/a.ts')).toMatchObject({
      kind: 'waiting'
    })
    expect(parseCodexNotification('Question: Which branch?')).toMatchObject({ kind: 'waiting' })
    expect(parseCodexNotification('Done. Tests pass.')).toEqual({
      kind: 'done',
      message: 'Done. Tests pass.'
    })
    expect(parseCodexNotification('Agent turn complete')).toEqual({ kind: 'done', message: null })
  })
})

describe('CodexWatcher', () => {
  const kinds = (w: CodexWatcher, chunk: string): string[] =>
    w.feed(chunk).map((r) => r.signal.kind)

  it('reports a change of state once, not every spinner frame', () => {
    const w = new CodexWatcher()
    expect(kinds(w, title('Ready'))).toEqual(['idle'])
    expect(kinds(w, title('⠋ Working'))).toEqual(['working'])
    expect(kinds(w, title('⠙ Working') + title('⠹ Thinking'))).toEqual([])
    expect(kinds(w, title('Ready') + notify('All done'))).toEqual(['idle', 'done'])
  })

  it("doesn't let a stale frame undo an approval request", () => {
    const w = new CodexWatcher()
    w.feed(title('⠋ Working'))
    // The notification can land before the title catches up.
    const reports = w.feed(notify('Approval requested: make') + title('⠙ Working'))
    expect(reports.map((r) => r.signal)).toEqual([
      { kind: 'waiting', key: null, message: 'Approval requested: make' }
    ])
    expect(w.feed(title('[ ! ] Action Required')).map((r) => r.signal)).toEqual([
      { kind: 'waiting', key: null, message: null }
    ])
    expect(kinds(w, title('⠋ Working'))).toEqual(['working'])
  })

  it('ignores progress reports and other OSC codes', () => {
    const w = new CodexWatcher()
    expect(kinds(w, '\x1b]9;4;1;50\x07\x1b]8;;https://x\x07link\x1b]8;;\x07')).toEqual([])
  })
})
