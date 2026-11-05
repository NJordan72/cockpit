import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'bun:test'
import { gitStatus, parseLog, parseStatus } from './git'

describe('parseStatus', () => {
  it('reads branch, upstream, and every kind of entry', () => {
    const out = [
      '# branch.oid 42d0e8ab1c1d6f039d1fedb1643dc6d525e5a28a',
      '# branch.head feature/x',
      '# branch.upstream origin/feature/x',
      '# branch.ab +2 -1',
      '1 .M N... 100644 100644 100644 2e65efe 2e65efe with space.txt',
      '1 A. N... 000000 100644 100644 0000000 1111111 src/new.ts',
      '2 R. N... 100644 100644 100644 63d8dbd 63d8dbd R100 sub/y.txt',
      'sub/x.txt',
      'u UU N... 100644 100644 100644 100644 a b c conflict.ts',
      '? untracked dir/',
      ''
    ].join('\0')
    expect(parseStatus(out)).toEqual({
      branch: 'feature/x',
      head: '42d0e8a',
      upstream: 'origin/feature/x',
      ahead: 2,
      behind: 1,
      changed: 5,
      files: [
        { path: 'with space.txt', from: null, index: '.', worktree: 'M' },
        { path: 'src/new.ts', from: null, index: 'A', worktree: '.' },
        { path: 'sub/y.txt', from: 'sub/x.txt', index: 'R', worktree: '.' },
        { path: 'conflict.ts', from: null, index: 'U', worktree: 'U' },
        { path: 'untracked dir/', from: null, index: '?', worktree: '?' }
      ]
    })
  })

  it('handles a detached HEAD and a repository with no commits', () => {
    expect(parseStatus('# branch.oid abcdef1234\0# branch.head (detached)\0')).toMatchObject({
      branch: null,
      head: 'abcdef1'
    })
    expect(parseStatus('# branch.oid (initial)\0# branch.head main\0')).toMatchObject({
      branch: 'main',
      head: null,
      upstream: null,
      changed: 0
    })
  })
})

describe('parseLog', () => {
  it('reads hash, time, and subject', () => {
    expect(parseLog('abc1234\x1f1700000000\x1ffeat: a\x1fb\n\n')).toEqual([
      { hash: 'abc1234', at: 1_700_000_000_000, subject: 'feat: a\x1fb' }
    ])
  })
})

describe('gitStatus', () => {
  it('reads a real repository, and returns null outside one', async () => {
    const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ck-git-')))
    try {
      expect(await gitStatus(dir)).toBeNull()
      const run = (...args: string[]): void => {
        execFileSync('git', ['-C', dir, ...args], { stdio: 'ignore' })
      }
      run('init', '-q', '-b', 'main')
      fs.writeFileSync(path.join(dir, 'a.txt'), 'a\n')
      run('add', '.')
      run('-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'first')
      fs.writeFileSync(path.join(dir, 'a.txt'), 'b\n')
      fs.mkdirSync(path.join(dir, 'sub'))
      fs.writeFileSync(path.join(dir, 'sub', 'new.txt'), 'n\n')
      const status = await gitStatus(path.join(dir, 'sub'))
      expect(status).toMatchObject({
        root: dir,
        branch: 'main',
        changed: 2,
        files: [
          { path: 'a.txt', index: '.', worktree: 'M' },
          { path: 'sub/', index: '?', worktree: '?' }
        ]
      })
      expect(status?.commits.map((c) => c.subject)).toEqual(['first'])
      // It mustn't leave a lock behind or take one.
      expect(fs.existsSync(path.join(dir, '.git', 'index.lock'))).toBe(false)

      // Nor run a program the repository's own config names.
      const marker = path.join(dir, 'fsmonitor-ran')
      run('config', 'core.fsmonitor', `touch '${marker}'; false`)
      expect(await gitStatus(dir)).toMatchObject({ branch: 'main' })
      expect(fs.existsSync(marker)).toBe(false)
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })
})
