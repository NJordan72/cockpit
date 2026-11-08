// The branch checked out where each pane's process is. It's read from the
// repository's HEAD file rather than by running git, so reading it for every
// pane every few seconds costs a few file reads.
import fs from 'node:fs/promises'
import path from 'node:path'

const HEADS = /^ref: refs\/heads\/(.+)$/

/** The branch a HEAD file names, or null when HEAD is detached. */
export function parseHead(text: string): string | null {
  return HEADS.exec(text.trim())?.[1] ?? null
}

const readText = (file: string): Promise<string | null> =>
  fs.readFile(file, 'utf8').catch(() => null)

/**
 * The git directory of the repository `dir` is in: the nearest .git folder,
 * or where a worktree's or submodule's .git file points.
 */
export async function gitDirOf(dir: string): Promise<string | null> {
  for (let d = path.resolve(dir); ; d = path.dirname(d)) {
    const dotGit = path.join(d, '.git')
    const stat = await fs.stat(dotGit).catch(() => null)
    if (stat?.isDirectory()) return dotGit
    if (stat?.isFile()) {
      const target = /^gitdir: (.+)$/m.exec((await readText(dotGit)) ?? '')?.[1]?.trim()
      return target ? path.resolve(d, target) : null
    }
    if (path.dirname(d) === d) return null
  }
}

/** The branch checked out in `dir`, or null outside a repository or on a detached HEAD. */
export async function readBranch(dir: string): Promise<string | null> {
  if (!(await fs.stat(dir).catch(() => null))?.isDirectory()) return null
  const gitDir = await gitDirOf(dir)
  if (!gitDir) return null
  const head = await readText(path.join(gitDir, 'HEAD'))
  if (head === null) return null
  const branch = parseHead(head)
  if (branch !== null) return branch
  // A rebase detaches HEAD while it runs, but the branch is still checked out.
  for (const file of ['rebase-merge/head-name', 'rebase-apply/head-name']) {
    const name = (await readText(path.join(gitDir, file)))?.trim()
    const rebasing = name?.startsWith('refs/heads/') ? name.slice('refs/heads/'.length) : null
    if (rebasing) return rebasing
  }
  return null
}

export class BranchTracker {
  private branches = new Map<string, string | null>()
  /** Where each pane's process was last found, for reads that don't ask again. */
  private dirs = new Map<string, string | null>()
  /** Bumped by each read of a pane, so an older read finishing late is dropped. */
  private reads = new Map<string, number>()

  constructor(
    /**
     * Where a pane's process is now: null when the pane is gone, undefined
     * when that couldn't be found out this time.
     */
    private readonly cwd: (paneId: string) => Promise<string | null | undefined>,
    private readonly changed: () => void,
    private readonly read: (dir: string) => Promise<string | null> = readBranch
  ) {}

  get(paneId: string): string | null {
    return this.branches.get(paneId) ?? null
  }

  /**
   * Reads these panes' branches again, then calls `changed` once if any is
   * different. With `sameDirs`, a pane whose directory is known reads HEAD
   * there without asking where its process is: finding that out can mean
   * running lsof, too much to do for every pane every few seconds.
   */
  async refresh(paneIds: readonly string[], sameDirs = false): Promise<void> {
    const changed = await Promise.all(paneIds.map((id) => this.readOne(id, sameDirs)))
    if (changed.includes(true)) this.changed()
  }

  /** Forgets panes that aren't in `paneIds`. */
  retain(paneIds: ReadonlySet<string>): void {
    for (const id of this.reads.keys()) {
      if (paneIds.has(id)) continue
      this.reads.delete(id)
      this.branches.delete(id)
      this.dirs.delete(id)
    }
  }

  private async readOne(paneId: string, sameDir: boolean): Promise<boolean> {
    const n = (this.reads.get(paneId) ?? 0) + 1
    this.reads.set(paneId, n)
    let branch: string | null = null
    try {
      const known = this.dirs.get(paneId)
      const found = sameDir && known !== undefined ? known : await this.cwd(paneId)
      // A lookup that failed reads where the pane was last found rather than guessing.
      const dir = found === undefined ? known : found
      if (dir === undefined) return false
      if (this.reads.get(paneId) === n) this.dirs.set(paneId, dir)
      if (dir !== null) branch = await this.read(dir)
    } catch {
      branch = null
    }
    if (this.reads.get(paneId) !== n) return false
    const before = this.branches.get(paneId) ?? null
    this.branches.set(paneId, branch)
    return branch !== before
  }
}
