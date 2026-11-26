import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { parseTranscriptTail, readTranscript } from './transcript'

const line = (v: unknown): string => JSON.stringify(v)
const assistant = (usage: object, extra: object = {}, model = 'claude-opus-5-5'): string =>
  line({
    type: 'assistant',
    isSidechain: false,
    message: { role: 'assistant', model, usage },
    ...extra
  })

describe('parseTranscriptTail', () => {
  it('takes the newest title and the last main-thread usage', () => {
    const text = [
      line({ type: 'ai-title', aiTitle: 'Old title', sessionId: 's' }),
      assistant({ input_tokens: 1, output_tokens: 1 }, {}, 'claude-sonnet-4-5-20250929'),
      line({ type: 'ai-title', aiTitle: 'New title', sessionId: 's' }),
      assistant({
        input_tokens: 10,
        cache_creation_input_tokens: 200,
        cache_read_input_tokens: 3000,
        output_tokens: 40
      }),
      // A subagent's request doesn't describe the main context.
      assistant({ input_tokens: 999_999 }, { isSidechain: true }),
      line({ type: 'last-prompt' })
    ].join('\n')
    expect(parseTranscriptTail(text)).toEqual({
      title: 'New title',
      tokens: 3250,
      model: 'claude-opus-5-5'
    })
  })

  it('skips the zero-usage entries Claude Code writes for an error', () => {
    const text = [
      assistant({ input_tokens: 400_000, output_tokens: 1000 }, {}, 'claude-fable-5-2'),
      assistant({ input_tokens: 0, output_tokens: 0 }, {}, '<synthetic>')
    ].join('\n')
    expect(parseTranscriptTail(text)).toMatchObject({ tokens: 401_000, model: 'claude-fable-5-2' })
  })

  it('skips cut-off and malformed lines', () => {
    expect(parseTranscriptTail('tle":"x"}\n{not json\n\n')).toEqual({
      title: null,
      tokens: null,
      model: null
    })
  })
})

describe('readTranscript', () => {
  let root: string
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'cockpit-transcript-'))
  })
  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true })
  })

  it('reads only the tail of a large file', async () => {
    const file = path.join(root, 'projects', 'p', 's.jsonl')
    fs.mkdirSync(path.dirname(file), { recursive: true })
    const filler = line({ type: 'progress', data: 'x'.repeat(1000) })
    const lines = [line({ type: 'ai-title', aiTitle: 'Too far back' })]
    for (let i = 0; i < 1500; i++) lines.push(filler)
    lines.push(assistant({ input_tokens: 5, output_tokens: 5 }))
    fs.writeFileSync(file, lines.join('\n') + '\n')
    expect(await readTranscript(file, root)).toEqual({
      title: null,
      tokens: 10,
      model: 'claude-opus-5-5'
    })
  })

  it('refuses files outside the Claude directory', async () => {
    const outside = path.join(os.tmpdir(), `cockpit-outside-${process.pid.toString()}.jsonl`)
    fs.writeFileSync(outside, line({ type: 'ai-title', aiTitle: 'nope' }))
    try {
      expect(await readTranscript(outside, root)).toBeNull()
      expect(await readTranscript(path.join(root, '..', path.basename(outside)), root)).toBeNull()
      expect(await readTranscript('relative.jsonl', root)).toBeNull()
    } finally {
      fs.rmSync(outside, { force: true })
    }
  })
})
