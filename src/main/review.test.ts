import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'bun:test'
import { readReviewDiff } from './review'

describe('readReviewDiff', () => {
  it('reads branch commits since merge-base plus uncommitted, untracked, and binary files', async () => {
    const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ck-review-')))
    const remoteDir = path.join(root, 'remote.git')
    const repoDir = path.join(root, 'repo')
    try {
      // Non-repo returns an error.
      const outside = await readReviewDiff(root)
      expect(outside.ok).toBe(false)

      const git = (cwd: string, ...args: string[]): void => {
        execFileSync('git', ['-C', cwd, ...args], { stdio: 'ignore' })
      }

      fs.mkdirSync(remoteDir)
      fs.mkdirSync(repoDir)
      git(remoteDir, 'init', '--bare', '-q', '-b', 'main')
      git(repoDir, 'init', '-q', '-b', 'main')
      git(repoDir, 'remote', 'add', 'origin', remoteDir)

      fs.writeFileSync(path.join(repoDir, 'a.txt'), 'line 1\nline 2\n')
      git(repoDir, 'add', '.')
      git(repoDir, '-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'init')
      git(repoDir, 'push', '-q', '-u', 'origin', 'main')
      git(repoDir, 'symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/main')

      // Feature branch with a committed change, an unstaged edit, an untracked text file, and an untracked binary.
      git(repoDir, 'checkout', '-qb', 'feat/review-test')
      fs.writeFileSync(path.join(repoDir, 'a.txt'), 'line 1\nline 2 updated\n')
      git(repoDir, 'add', 'a.txt')
      git(repoDir, '-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'update a')

      // Unstaged edit on top of the commit.
      fs.writeFileSync(path.join(repoDir, 'a.txt'), 'line 1\nline 2 updated\nline 3\n')
      // Untracked text file.
      fs.writeFileSync(path.join(repoDir, 'untracked.txt'), 'hello\nworld\n')
      // Untracked binary file.
      fs.writeFileSync(path.join(repoDir, 'bin.dat'), Buffer.from([0x89, 0x50, 0x00, 0x47]))

      const res = await readReviewDiff(repoDir)
      expect(res.ok).toBe(true)
      if (!res.ok) return

      expect(res.diff.branch).toBe('feat/review-test')
      expect(res.diff.base).toBe('origin/main')
      expect(res.diff.mergeBase).toBeTruthy()
      expect(res.diff.files.map((f) => [f.path, f.status, f.binary])).toEqual([
        ['a.txt', 'modified', false],
        ['bin.dat', 'untracked', true],
        ['untracked.txt', 'untracked', false]
      ])
      expect(res.diff.files[0]?.added).toBe(2)
      expect(res.diff.files[0]?.removed).toBe(1)
      expect(res.diff.files[2]?.added).toBe(2)
      expect(res.diff.files[2]?.hunks[0]?.lines.map((l) => l.text)).toEqual(['hello', 'world'])
    } finally {
      fs.rmSync(root, { recursive: true, force: true })
    }
  }, 30_000)
})
