import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { mergedAndClean, type RepoTaskSettings, type TaskInfo } from '@shared/tasks'
import { parseTaskPr, parseWorktrees, TaskStore, withSetup } from './tasks'

const git = (cwd: string, ...args: string[]): string =>
  execFileSync(
    'git',
    ['-c', 'user.email=t@t', '-c', 'user.name=t', '-c', 'commit.gpgsign=false', '-C', cwd, ...args],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }
  ).trim()

const commit = (cwd: string, file: string, text: string, message = file): void => {
  fs.writeFileSync(path.join(cwd, file), text)
  git(cwd, 'add', '.')
  git(cwd, 'commit', '-qm', message)
}

let tmp: string
/** A bare repository playing GitHub. */
let origin: string
/** The user's clone of it. */
let repo: string
let settings: Record<string, RepoTaskSettings>
let changes: TaskInfo[][]

const store = (gh?: ConstructorParameters<typeof TaskStore>[0]['gh']): TaskStore =>
  new TaskStore({
    dir: path.join(tmp, 'worktrees'),
    settings: (r) => settings[r],
    onChange: (t) => changes.push(t),
    gh: gh ?? (() => Promise.resolve({ out: '[]' }))
  })

beforeEach(() => {
  tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ck-tasks-')))
  origin = path.join(tmp, 'origin.git')
  repo = path.join(tmp, 'dev', 'app')
  const seed = path.join(tmp, 'seed')
  fs.mkdirSync(seed)
  git(seed, 'init', '-q', '-b', 'main')
  commit(seed, 'a.txt', 'a\n')
  git(tmp, 'init', '-q', '--bare', '-b', 'main', origin)
  git(seed, 'push', '-q', origin, 'main')
  git(tmp, 'clone', '-q', origin, repo)
  settings = {}
  changes = []
})

afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true })
})

describe('parseWorktrees', () => {
  it('reads the main checkout first, then branches, detached and bare entries', () => {
    const out = [
      'worktree /r',
      'HEAD aaa',
      'branch refs/heads/main',
      '',
      'worktree /w/x',
      'HEAD bbb',
      'detached',
      '',
      'worktree /b',
      'bare',
      ''
    ].join('\0')
    expect(parseWorktrees(out)).toEqual([
      { path: '/r', head: 'aaa', branch: 'main', bare: false },
      { path: '/w/x', head: 'bbb', branch: null, bare: false },
      { path: '/b', head: null, branch: null, bare: true }
    ])
  })
})

describe('parseTaskPr', () => {
  it('reads state, draft, checks, review, and head', () => {
    expect(
      parseTaskPr({
        number: 7,
        title: 't',
        url: 'https://github.com/o/r/pull/7',
        state: 'MERGED',
        isDraft: false,
        reviewDecision: 'APPROVED',
        statusCheckRollup: [{ status: 'COMPLETED', conclusion: 'SUCCESS' }],
        headRefOid: 'abc'
      })
    ).toEqual({
      number: 7,
      title: 't',
      url: 'https://github.com/o/r/pull/7',
      state: 'merged',
      draft: false,
      checks: 'passing',
      review: 'approved',
      head: 'abc'
    })
    expect(parseTaskPr({ title: 'no number' })).toBeNull()
    expect(parseTaskPr([])).toBeNull()
    expect(parseTaskPr([{ number: 1, state: 'OPEN', isDraft: true }])).toMatchObject({
      number: 1,
      state: 'open',
      draft: true
    })
  })
})

describe('withSetup', () => {
  it('runs the setup, says when it fails, and then runs the command anyway', () => {
    const out = execFileSync('/bin/sh', ['-c', withSetup(`echo "it's set"; false`, 'echo next')], {
      encoding: 'utf8'
    })
    expect(out).toContain(`[cockpit] setting up: echo "it's set"; false`)
    expect(out).toContain("it's set")
    expect(out).toContain('setup exited with 1')
    expect(out.trim().endsWith('next')).toBe(true)
  })
})

describe('TaskStore', () => {
  it('starts a new branch at the remote default branch, fetched first, with no upstream', async () => {
    // Someone pushed after the clone, so the local main is behind.
    const other = path.join(tmp, 'other')
    git(tmp, 'clone', '-q', origin, other)
    commit(other, 'b.txt', 'b\n')
    git(other, 'push', '-q', 'origin', 'main')
    const remoteHead = git(other, 'rev-parse', 'HEAD')

    const tasks = store()
    const made = await tasks.create({
      repo: path.join(repo, 'sub-folder-that-is-ignored', '..'),
      branch: 'feat/x'
    })
    expect(made).toEqual({
      ok: true,
      path: path.join(tmp, 'worktrees', 'app', 'feat-x'),
      existing: false
    })
    const wt = path.join(tmp, 'worktrees', 'app', 'feat-x')
    expect(git(wt, 'rev-parse', 'HEAD')).toBe(remoteHead)
    expect(git(wt, 'branch', '--show-current')).toBe('feat/x')
    expect(() => git(wt, 'rev-parse', '--abbrev-ref', '@{u}')).toThrow()
    expect(tasks.list()).toMatchObject([
      { path: wt, repo, branch: 'feat/x', head: remoteHead, changed: 0, unpushed: 0, pr: null }
    ])
    expect(changes.length).toBeGreaterThan(0)
    expect(tasks.repoOf(path.join(wt, 'src'))).toBe(repo)
    expect(tasks.repoOf(repo)).toBeNull()
  })

  it('opens the worktree a branch has, and refuses the main checkout, bad names, and non-repos', async () => {
    const tasks = store()
    const first = await tasks.create({ repo, branch: 'feat/x' })
    expect(first.ok).toBe(true)
    // From inside the task's own worktree, too.
    const wt = first.ok ? first.path : ''
    expect(await tasks.create({ repo: wt, branch: 'feat/x' })).toEqual({
      ok: true,
      path: wt,
      existing: true
    })
    expect(await tasks.create({ repo, branch: 'main' })).toEqual({
      ok: false,
      error: `main is checked out in ${repo} already`
    })
    for (const bad of ['two words', '-x', 'a..b', '']) {
      const r = await tasks.create({ repo, branch: bad })
      expect(r.ok).toBe(false)
    }
    const plain = path.join(tmp, 'plain')
    fs.mkdirSync(plain)
    expect(await tasks.create({ repo: plain, branch: 'x' })).toEqual({
      ok: false,
      error: `${plain} isn't in a git repository`
    })
    expect(tasks.list()).toHaveLength(1)
  })

  it('checks out a local branch as it is, and tracks one only on the remote', async () => {
    git(repo, 'branch', 'local-only')
    const other = path.join(tmp, 'other')
    git(tmp, 'clone', '-q', origin, other)
    git(other, 'switch', '-qc', 'theirs')
    commit(other, 'c.txt', 'c\n')
    git(other, 'push', '-q', 'origin', 'theirs')

    const tasks = store()
    const local = await tasks.create({ repo, branch: 'local-only' })
    const theirs = await tasks.create({ repo, branch: 'theirs' })
    if (!local.ok || !theirs.ok) throw new Error('not made')
    expect(git(local.path, 'branch', '--show-current')).toBe('local-only')
    expect(git(theirs.path, 'rev-parse', '--abbrev-ref', '@{u}')).toBe('origin/theirs')
    expect(fs.existsSync(path.join(theirs.path, 'c.txt'))).toBe(true)
  })

  it('gives a branch a free folder when another took its name', async () => {
    const tasks = store()
    const a = await tasks.create({ repo, branch: 'a/b' })
    const b = await tasks.create({ repo, branch: 'a-b' })
    expect(a.ok && a.path).toBe(path.join(tmp, 'worktrees', 'app', 'a-b'))
    expect(b.ok && b.path).toBe(path.join(tmp, 'worktrees', 'app', 'a-b-2'))
  })

  it('copies the files config.json lists, and keeps the setup for the first terminal', async () => {
    fs.writeFileSync(path.join(repo, '.env'), 'SECRET=1\n')
    fs.mkdirSync(path.join(repo, 'conf'))
    fs.writeFileSync(path.join(repo, 'conf', 'local.json'), '{}\n')
    settings[repo] = { setup: 'bun install', copy: ['.env', 'conf', 'missing.txt'] }
    const tasks = store()
    const made = await tasks.create({ repo, branch: 'x' })
    if (!made.ok) throw new Error(made.error)
    expect(fs.readFileSync(path.join(made.path, '.env'), 'utf8')).toBe('SECRET=1\n')
    expect(fs.existsSync(path.join(made.path, 'conf', 'local.json'))).toBe(true)
    expect(fs.existsSync(path.join(made.path, 'missing.txt'))).toBe(false)
    expect(tasks.takeSetup(made.path)).toBe('bun install')
    expect(tasks.takeSetup(made.path)).toBeNull()
  })

  it('counts changes and unpushed commits, and removes worktrees', async () => {
    const tasks = store()
    const made = await tasks.create({ repo, branch: 'work' })
    if (!made.ok) throw new Error(made.error)
    commit(made.path, 'mine.txt', 'mine\n')
    fs.writeFileSync(path.join(made.path, 'loose.txt'), 'loose\n')
    // Ignored files don't stop a removal.
    fs.writeFileSync(path.join(made.path, '.gitignore'), 'node_modules/\n')
    fs.mkdirSync(path.join(made.path, 'node_modules'))
    await tasks.refresh()
    expect(tasks.list()).toMatchObject([{ branch: 'work', changed: 2, unpushed: 1 }])

    const refused = await tasks.remove(made.path, { force: false, deleteBranch: false })
    expect(refused.ok).toBe(false)
    expect(fs.existsSync(made.path)).toBe(true)
    expect(await tasks.remove(made.path, { force: true, deleteBranch: false })).toEqual({
      ok: true
    })
    expect(fs.existsSync(made.path)).toBe(false)
    // Its repository's folder goes with its last task.
    expect(fs.existsSync(path.join(tmp, 'worktrees', 'app'))).toBe(false)
    expect(git(repo, 'branch', '--list', 'work')).toContain('work')
    expect(tasks.list()).toEqual([])

    const again = await tasks.create({ repo, branch: 'gone' })
    if (!again.ok) throw new Error(again.error)
    expect(await tasks.remove(again.path, { force: false, deleteBranch: true })).toEqual({
      ok: true
    })
    expect(git(repo, 'branch', '--list', 'gone')).toBe('')
    expect(await tasks.remove(again.path, { force: false, deleteBranch: true })).toEqual({
      ok: false,
      error: 'That task is gone'
    })
  })

  it('asks gh about the pull request, and sees work newer than a merged one', async () => {
    let answer: { out: string } | { error: string } = { out: '[]' }
    const asked: string[][] = []
    const tasks = store((_cwd, args) => {
      asked.push(args)
      return Promise.resolve(answer)
    })
    const made = await tasks.create({ repo, branch: 'feat/y' })
    if (!made.ok) throw new Error(made.error)
    commit(made.path, 'y.txt', 'y\n')
    const head = git(made.path, 'rev-parse', 'HEAD')
    await tasks.refresh(true)
    expect(tasks.list()).toMatchObject([{ pr: null, prError: null }])
    answer = {
      out: JSON.stringify([{ number: 3, title: 'Y', url: 'u', state: 'MERGED', headRefOid: head }])
    }
    await tasks.refresh(true)
    expect(asked.at(-1)?.slice(0, 7)).toEqual([
      'pr',
      'list',
      '--head',
      'feat/y',
      '--state',
      'all',
      '--limit'
    ])
    const [merged] = tasks.list()
    expect(merged).toMatchObject({ pr: { number: 3, state: 'merged' }, inPr: true, unpushed: 1 })
    if (merged) expect(mergedAndClean(merged)).toBe(true)

    // A merged pull request isn't asked about again unless forced.
    const count = asked.length
    await tasks.refresh()
    expect(asked.length).toBe(count)

    commit(made.path, 'later.txt', 'later\n')
    answer = { error: 'could not connect' }
    await tasks.refresh(true)
    const [later] = tasks.list()
    // What gh said before stays when it can't be reached.
    expect(later).toMatchObject({ pr: { number: 3 }, prError: 'could not connect', inPr: false })
    if (later) expect(mergedAndClean(later)).toBe(false)
  })
})
