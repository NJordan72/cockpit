import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { BranchTracker, gitDirOf, parseHead, readBranch } from './branches'

describe('parseHead', () => {
  it('reads a branch, and nothing from a detached HEAD', () => {
    expect(parseHead('ref: refs/heads/main\n')).toBe('main')
    expect(parseHead('ref: refs/heads/nick/sc-1234/fix-login\r\n')).toBe('nick/sc-1234/fix-login')
    expect(parseHead('42d0e8ab1c1d6f039d1fedb1643dc6d525e5a28a\n')).toBeNull()
    expect(parseHead('ref: refs/remotes/origin/main\n')).toBeNull()
    expect(parseHead('')).toBeNull()
  })
})

describe('readBranch', () => {
  let dir: string
  const git = (cwd: string, ...args: string[]): string =>
    execFileSync(
      'git',
      ['-c', 'user.email=t@t', '-c', 'user.name=t', '-c', 'commit.gpgsign=false', ...args],
      { cwd, encoding: 'utf8', env: { ...process.env, GIT_CONFIG_NOSYSTEM: '1' } }
    )

  beforeEach(() => {
    dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ck-branch-')))
  })
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true })
  })

  it('reads the checkout a directory is in, from any folder inside it', async () => {
    const repo = path.join(dir, 'repo')
    fs.mkdirSync(path.join(repo, 'src', 'deep'), { recursive: true })
    git(repo, 'init', '-q', '-b', 'nick/sc-1234/fix-login')
    expect(await readBranch(repo)).toBe('nick/sc-1234/fix-login')
    expect(await readBranch(path.join(repo, 'src', 'deep'))).toBe('nick/sc-1234/fix-login')
    expect(await gitDirOf(path.join(repo, 'src'))).toBe(path.join(repo, '.git'))
    expect(await readBranch(dir)).toBeNull()
    expect(await readBranch(path.join(dir, 'missing'))).toBeNull()
  })

  it("follows a worktree's .git file, and sees no branch on a detached HEAD", async () => {
    const repo = path.join(dir, 'repo')
    fs.mkdirSync(repo)
    git(repo, 'init', '-q', '-b', 'main')
    fs.writeFileSync(path.join(repo, 'a.txt'), 'a\n')
    git(repo, 'add', '.')
    git(repo, 'commit', '-qm', 'first')
    const tree = path.join(dir, 'tree')
    git(repo, 'worktree', 'add', '-q', '-b', 'nick/sc-7/other', tree)
    expect(fs.statSync(path.join(tree, '.git')).isFile()).toBe(true)
    expect(await readBranch(tree)).toBe('nick/sc-7/other')
    expect(await readBranch(repo)).toBe('main')

    git(tree, 'checkout', '-q', '--detach')
    expect(await readBranch(tree)).toBeNull()
    expect(await readBranch(repo)).toBe('main')
  })

  it('reads a relative gitdir, and keeps the branch a rebase is working on', async () => {
    const gitDir = path.join(dir, 'store')
    fs.mkdirSync(path.join(gitDir, 'rebase-merge'), { recursive: true })
    const tree = path.join(dir, 'tree')
    fs.mkdirSync(tree)
    fs.writeFileSync(path.join(tree, '.git'), 'gitdir: ../store\n')
    fs.writeFileSync(path.join(gitDir, 'HEAD'), 'ref: refs/heads/main\n')
    expect(await readBranch(tree)).toBe('main')

    fs.writeFileSync(path.join(gitDir, 'HEAD'), '42d0e8ab1c1d6f039d1fedb1643dc6d525e5a28a\n')
    fs.writeFileSync(path.join(gitDir, 'rebase-merge', 'head-name'), 'refs/heads/nick/sc-9/x\n')
    expect(await readBranch(tree)).toBe('nick/sc-9/x')

    fs.writeFileSync(path.join(gitDir, 'rebase-merge', 'head-name'), 'detached HEAD\n')
    expect(await readBranch(tree)).toBeNull()

    fs.writeFileSync(path.join(tree, '.git'), 'not a pointer\n')
    expect(await readBranch(tree)).toBeNull()
  })
})

describe('BranchTracker', () => {
  it('says once per refresh when branches changed, and forgets closed panes', async () => {
    const dirs: Record<string, string | null> = { a: '/a', b: '/b', c: null }
    const heads: Record<string, string | null> = { '/a': 'main', '/b': null }
    let changes = 0
    const tracker = new BranchTracker(
      (id) => Promise.resolve(dirs[id] ?? null),
      () => changes++,
      (dir) => Promise.resolve(heads[dir] ?? null)
    )
    await tracker.refresh(['a', 'b', 'c'])
    expect(changes).toBe(1)
    expect([tracker.get('a'), tracker.get('b'), tracker.get('c')]).toEqual(['main', null, null])

    await tracker.refresh(['a', 'b'])
    expect(changes).toBe(1)

    heads['/a'] = 'nick/sc-1/x'
    heads['/b'] = 'dev'
    await tracker.refresh(['a', 'b'])
    expect(changes).toBe(2)
    expect(tracker.get('a')).toBe('nick/sc-1/x')

    tracker.retain(new Set(['b']))
    expect(tracker.get('a')).toBeNull()
    expect(tracker.get('b')).toBe('dev')
  })

  it('keeps the newest read when an older one finishes after it', async () => {
    const pending: ((branch: string) => void)[] = []
    const tracker = new BranchTracker(
      () => Promise.resolve('/repo'),
      () => undefined,
      () => new Promise((resolve) => pending.push(resolve))
    )
    const first = tracker.refresh(['a'])
    const second = tracker.refresh(['a'])
    await Promise.resolve()
    await Promise.resolve()
    expect(pending).toHaveLength(2)
    pending[1]?.('new')
    await second
    pending[0]?.('old')
    await first
    expect(tracker.get('a')).toBe('new')
  })

  it('reads HEAD in the directory it knows when told the directories are the same', async () => {
    let asked = 0
    const dirs: Record<string, string> = { a: '/one' }
    const heads: Record<string, string> = { '/one': 'main', '/two': 'dev' }
    const tracker = new BranchTracker(
      (id) => {
        asked++
        return Promise.resolve(dirs[id] ?? null)
      },
      () => undefined,
      (dir) => Promise.resolve(heads[dir] ?? null)
    )
    await tracker.refresh(['a'], true)
    expect([asked, tracker.get('a')]).toEqual([1, 'main'])

    dirs.a = '/two'
    heads['/one'] = 'feature'
    await tracker.refresh(['a'], true)
    expect([asked, tracker.get('a')]).toEqual([1, 'feature'])

    await tracker.refresh(['a'])
    expect([asked, tracker.get('a')]).toEqual([2, 'dev'])
  })

  it('keeps reading where a pane was last found when the lookup fails', async () => {
    let dir: string | undefined = '/two'
    const heads: Record<string, string> = { '/two': 'dev' }
    const tracker = new BranchTracker(
      () => Promise.resolve(dir),
      () => undefined,
      (d) => Promise.resolve(heads[d] ?? null)
    )
    await tracker.refresh(['a'])
    dir = undefined
    heads['/two'] = 'dev2'
    await tracker.refresh(['a'])
    expect(tracker.get('a')).toBe('dev2')
    await tracker.refresh(['b'])
    expect(tracker.get('b')).toBeNull()
  })

  it('treats a failed read as no branch', async () => {
    const tracker = new BranchTracker(
      () => Promise.reject(new Error('lsof failed')),
      () => undefined
    )
    await tracker.refresh(['a'])
    expect(tracker.get('a')).toBeNull()
  })
})
