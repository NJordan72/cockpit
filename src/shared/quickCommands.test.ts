import { describe, expect, it } from 'bun:test'
import {
  clipboardInput,
  inputValid,
  MAX_QUICK_COMMANDS,
  quickPrompt,
  readQuickCommands,
  type QuickCommand
} from './quickCommands'

const approve = {
  id: 'approve-ship',
  label: 'Approve ship',
  preset: 'claude',
  model: 'claude-opus-5-5',
  effort: 'medium',
  prompt: '/approve-ship --quick {input}',
  input: { label: 'Slack link', pattern: '^https://[^/]+\\.slack\\.com/' }
}

describe('readQuickCommands', () => {
  it('reads an entry, running it in the background unless told not to', () => {
    expect(readQuickCommands([approve])).toEqual([{ ...approve, background: true } as QuickCommand])
    expect(readQuickCommands([{ ...approve, background: false }])[0]?.background).toBe(false)
  })

  it('drops entries without an id, label, preset, or prompt, and repeated ids', () => {
    const list = readQuickCommands([
      { ...approve, id: '' },
      { ...approve, id: 'has space' },
      { ...approve, label: ' ' },
      { ...approve, preset: undefined },
      { ...approve, prompt: '' },
      'nope',
      approve,
      { ...approve, label: 'Again' }
    ])
    expect(list.map((c) => c.label)).toEqual(['Approve ship'])
  })

  it('leaves out a model, effort, or pattern it can’t use', () => {
    const [cmd] = readQuickCommands([
      {
        ...approve,
        model: '--dangerously-skip-permissions',
        effort: 'huge',
        input: { pattern: '(' }
      }
    ])
    expect(cmd).toEqual({
      id: 'approve-ship',
      label: 'Approve ship',
      preset: 'claude',
      prompt: '/approve-ship --quick {input}',
      input: { label: 'Input' },
      background: true
    })
  })

  it('keeps model names with brackets, dots, and slashes', () => {
    for (const model of ['opus[1m]', 'gpt-5.5', 'vendor/model:tag']) {
      expect(readQuickCommands([{ ...approve, model }])[0]?.model).toBe(model)
    }
  })

  it('takes `input: true` as a field with a plain label', () => {
    expect(readQuickCommands([{ ...approve, input: true }])[0]?.input).toEqual({ label: 'Input' })
  })

  it('caps the list', () => {
    const many = Array.from({ length: 30 }, (_, i) => ({ ...approve, id: `c${String(i)}` }))
    expect(readQuickCommands(many)).toHaveLength(MAX_QUICK_COMMANDS)
    expect(readQuickCommands({})).toEqual([])
  })
})

describe('quickPrompt', () => {
  const [cmd] = readQuickCommands([approve])
  if (!cmd) throw new Error('not read')
  const link = 'https://narrative.slack.com/archives/C123/p1763'

  it('fills in the input', () => {
    expect(quickPrompt(cmd, `  ${link}\n`)).toBe(`/approve-ship --quick ${link}`)
  })

  it('refuses a value that is missing or doesn’t match', () => {
    expect(quickPrompt(cmd, '')).toBeNull()
    expect(quickPrompt(cmd, 'https://example.com/x')).toBeNull()
    expect(inputValid(cmd, link)).toBe(true)
  })

  it('adds the input at the end when the prompt has no {input}', () => {
    expect(quickPrompt({ ...cmd, prompt: '/approve-ship --quick' }, link)).toBe(
      `/approve-ship --quick ${link}`
    )
  })

  it('leaves `$&` in the input as it is', () => {
    const free: QuickCommand = { ...cmd, input: { label: 'Text' } }
    expect(quickPrompt(free, 'a $& b')).toBe('/approve-ship --quick a $& b')
  })

  it('sends a command without input as it is', () => {
    const plain: QuickCommand = {
      id: 'p',
      label: 'P',
      preset: 'claude',
      prompt: '/standup',
      background: true
    }
    expect(quickPrompt(plain, 'ignored')).toBe('/standup')
  })
})

describe('clipboardInput', () => {
  const [cmd] = readQuickCommands([approve])
  if (!cmd) throw new Error('not read')

  it('takes the clipboard only when it matches the pattern', () => {
    expect(clipboardInput(cmd, 'https://x.slack.com/archives/C1/p2')).toBe(
      'https://x.slack.com/archives/C1/p2'
    )
    expect(clipboardInput(cmd, 'some other text')).toBe('')
    expect(clipboardInput({ ...cmd, input: { label: 'Any' } }, 'some text')).toBe('')
  })
})
