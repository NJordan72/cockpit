import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { claudeLastUsed, claudeProjectDir, codexLastUsed, parseCodexCwd } from './history'

const T = Date.UTC(2026, 9, 17) / 1000

/** Write a file and set its mtime (seconds). */
function put(file: string, text: string, mtime: number): void {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, text)
  fs.utimesSync(file, mtime, mtime)
}

const meta = (cwd: string): string =>
  JSON.stringify({
    timestamp: '2026-10-17T12:00:00.000Z',
    type: 'session_meta',
    payload: { id: 'x', cwd, base_instructions: { text: 'y'.repeat(20_000) } }
  }) + '\n{"type":"event_msg"}\n'

describe('claudeProjectDir', () => {
  it('replaces every character but letters and digits', () => {
    expect(claudeProjectDir('/Users/me/dev/cockpit')).toBe('-Users-me-dev-cockpit')
    expect(claudeProjectDir('/Users/me/dev/web/.claude/worktrees/sc_1')).toBe(
      '-Users-me-dev-web--claude-worktrees-sc-1'
    )
  })
})

describe('parseCodexCwd', () => {
  it('reads the cwd from a session_meta line cut off partway', () => {
    expect(parseCodexCwd(meta('/Users/me/dev/a "b"').slice(0, 300))).toBe('/Users/me/dev/a "b"')
  })

  it('ignores other first lines and relative paths', () => {
    expect(parseCodexCwd('{"type":"event_msg","payload":{"cwd":"/x"}}')).toBeNull()
    expect(parseCodexCwd(meta('relative'))).toBeNull()
    expect(parseCodexCwd('')).toBeNull()
  })
})

describe('usage history', () => {
  let root: string
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'cockpit-history-'))
  })
  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true })
  })

  it('takes the newest Claude transcript per directory', async () => {
    const claude = path.join(root, 'claude')
    const folder = path.join(claude, 'projects', '-dev-a')
    put(path.join(folder, 'one.jsonl'), '{}', T - 100)
    put(path.join(folder, 'two.jsonl'), '{}', T - 10)
    // Other files in the folder (tool results, memory) don't count.
    put(path.join(folder, 'memory', 'notes.md'), 'x', T)
    const used = await claudeLastUsed(['/dev/a', '/dev/b'], claude)
    expect([...used]).toEqual([['/dev/a', (T - 10) * 1000]])
  })

  it('maps recent Codex sessions to their directories', async () => {
    const codex = path.join(root, 'codex')
    const day = (d: string): string => path.join(codex, 'sessions', '2026', '10', d)
    put(path.join(day('16'), 'rollout-2026-10-16T09-00-00-a.jsonl'), meta('/dev/a'), T - 500)
    put(path.join(day('17'), 'rollout-2026-10-17T08-00-00-b.jsonl'), meta('/dev/a'), T - 50)
    put(path.join(day('17'), 'rollout-2026-10-17T09-00-00-c.jsonl'), meta('/dev/b'), T - 5)
    put(path.join(day('17'), 'rollout-2026-10-17T10-00-00-d.jsonl'), '', T)
    put(path.join(day('17'), 'notes.txt'), meta('/dev/c'), T)

    const used = await codexLastUsed(codex)
    expect(Object.fromEntries(used)).toEqual({
      '/dev/a': (T - 50) * 1000,
      '/dev/b': (T - 5) * 1000
    })

    // Only the newest files are read.
    const newest = await codexLastUsed(codex, 2)
    expect(Object.fromEntries(newest)).toEqual({ '/dev/b': (T - 5) * 1000 })
  })

  it('finds nothing when the agents have no files', async () => {
    expect((await claudeLastUsed(['/dev/a'], path.join(root, 'none'))).size).toBe(0)
    expect((await codexLastUsed(path.join(root, 'none'))).size).toBe(0)
  })
})
