import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { DEFAULT_PRESETS } from '@shared/config'
import { claudeProjectDir } from './agents/history'
import { foldTaskDirs, listDirs } from './dirs'

const T = Date.UTC(2026, 9, 17)

describe('listDirs', () => {
  let root: string
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'cockpit-dirs-'))
  })
  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true })
  })

  const touch = (p: string, ms: number): void => {
    fs.utimesSync(p, ms / 1000, ms / 1000)
  }

  it('sorts by the latest use from Cockpit, Claude Code, or Codex, then by mtime', async () => {
    const dev = path.join(root, 'dev')
    const at = (name: string): string => path.join(dev, name)
    for (const name of ['a', 'b', 'c', 'old', 'older']) fs.mkdirSync(at(name), { recursive: true })
    fs.mkdirSync(path.join(root, 'elsewhere'))

    const claude = path.join(root, 'claude')
    const transcript = path.join(claude, 'projects', claudeProjectDir(at('b')), 's.jsonl')
    fs.mkdirSync(path.dirname(transcript), { recursive: true })
    fs.writeFileSync(transcript, '{}')
    touch(transcript, T - 2000)

    const codex = path.join(root, 'codex')
    const rollout = path.join(codex, 'sessions', '2026', '10', '17', 'rollout-2026-10-17-x.jsonl')
    fs.mkdirSync(path.dirname(rollout), { recursive: true })
    fs.writeFileSync(rollout, JSON.stringify({ type: 'session_meta', payload: { cwd: at('c') } }))
    touch(rollout, T - 1000)

    touch(at('old'), T - 10_000)
    touch(at('older'), T - 20_000)

    const dirs = await listDirs(
      {
        projectsDir: dev,
        presets: DEFAULT_PRESETS,
        recentDirs: [
          { path: at('a'), presetId: 'shell', at: T - 3000 },
          { path: path.join(root, 'elsewhere'), presetId: 'codex', at: T - 4000 },
          { path: path.join(root, 'gone'), presetId: 'claude', at: T },
          // From before times were kept: counts as never used.
          { path: at('old'), at: 0 }
        ]
      },
      { claude, codex }
    )

    expect(dirs.map((d) => [d.name, d.usedMs && T - d.usedMs, d.usedPresetId])).toEqual([
      ['c', 1000, 'codex'],
      ['b', 2000, 'claude'],
      ['a', 3000, 'shell'],
      ['elsewhere', 4000, 'codex'],
      ['old', 0, null],
      ['older', 0, null]
    ])
  })

  it('leaves the agent out when no preset runs it', async () => {
    const dev = path.join(root, 'dev')
    fs.mkdirSync(path.join(dev, 'a'), { recursive: true })
    const claude = path.join(root, 'claude')
    const transcript = path.join(
      claude,
      'projects',
      claudeProjectDir(path.join(dev, 'a')),
      's.jsonl'
    )
    fs.mkdirSync(path.dirname(transcript), { recursive: true })
    fs.writeFileSync(transcript, '{}')

    const [dir] = await listDirs(
      { projectsDir: dev, presets: [{ id: 'shell', name: 'Shell', cwd: '~' }], recentDirs: [] },
      { claude, codex: path.join(root, 'codex') }
    )
    expect(dir?.usedMs).toBeGreaterThan(0)
    expect(dir?.usedPresetId).toBeNull()
  })
})

describe('foldTaskDirs', () => {
  it("counts a task's use for its repository and leaves worktrees off the list", () => {
    const tasks = {
      repoOf: (d: string) => (d.startsWith('~/.cockpit/worktrees/app/') ? '~/dev/app' : null),
      holds: (d: string) => d.startsWith('~/.cockpit/worktrees/')
    }
    expect(
      foldTaskDirs(
        [
          { path: '~/.cockpit/worktrees/app/feat-x', presetId: 'codex', at: 30 },
          { path: '~/dev/app', presetId: 'claude', at: 10 },
          { path: '~/.cockpit/worktrees/app/feat-y', presetId: 'claude', at: 20 },
          { path: '~/.cockpit/worktrees/gone/old', presetId: 'claude', at: 40 },
          { path: '~/dev/other', at: 5 }
        ],
        tasks
      )
    ).toEqual([
      { path: '~/dev/app', presetId: 'codex', at: 30 },
      { path: '~/dev/other', at: 5 }
    ])
  })
})
