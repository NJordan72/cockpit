import { execFile, execFileSync } from 'node:child_process'
import fs from 'node:fs/promises'
import path from 'node:path'
import type { CockpitConfig, RecentDir } from '@shared/config'
import type { DirEntry } from '@shared/ipc'
import type { AgentKind } from '@shared/widgets'
import { claudeLastUsed, codexLastUsed } from './agents/history'
import { detectAgent } from './agents/launch'
import { abbreviateHome, expandHome } from './paths'

type Dir = Omit<DirEntry, 'usedMs' | 'usedPresetId'>

/** Subdirectories of the projects dir, most recently modified first. */
export async function listProjects(projectsDir: string, limit = 200): Promise<Dir[]> {
  const root = expandHome(projectsDir)
  let names: string[]
  try {
    names = await fs.readdir(root)
  } catch {
    return []
  }
  const entries = await Promise.all(
    names
      .filter((n) => !n.startsWith('.'))
      .map(async (name) => {
        const full = path.join(root, name)
        try {
          // stat follows symlinks, so linked project dirs are included.
          const st = await fs.stat(full)
          return st.isDirectory() ? { path: abbreviateHome(full), name, mtimeMs: st.mtimeMs } : null
        } catch {
          return null
        }
      })
  )
  return entries
    .filter((e): e is Dir => e !== null)
    .sort((a, b) => b.mtimeMs - a.mtimeMs)
    .slice(0, limit)
}

/** Task worktrees, which the start screen lists as their repository. */
export interface TaskDirs {
  /** The repository of the task a directory is in, or null. */
  repoOf(dir: string): string | null
  /** Whether a directory is in the worktrees folder at all. */
  holds(dir: string): boolean
}

const NO_TASKS: TaskDirs = { repoOf: () => null, holds: () => false }

/**
 * Recent dirs with each task's worktree counted as its repository, so a
 * repository is as recent as its newest task, and the worktrees themselves
 * stay off the list (the Tasks panel has them).
 */
export function foldTaskDirs(dirs: readonly RecentDir[], tasks: TaskDirs): RecentDir[] {
  const out = new Map<string, RecentDir>()
  for (const d of dirs) {
    const repo = tasks.repoOf(d.path)
    if (!repo && tasks.holds(d.path)) continue
    const path = repo ?? d.path
    const prev = out.get(path)
    if (!prev || d.at > prev.at) out.set(path, { ...d, path })
  }
  return [...out.values()]
}

/**
 * The projects dir's subdirectories plus recent dirs elsewhere, most recently
 * used first: by a Cockpit pane, or by Claude Code or Codex run anywhere.
 * Dirs never used sort by modification time. Recent dirs that are gone are
 * left out.
 */
export async function listDirs(
  config: Pick<CockpitConfig, 'projectsDir' | 'recentDirs' | 'presets'>,
  homes: { claude: string; codex: string },
  tasks: TaskDirs = NO_TASKS
): Promise<DirEntry[]> {
  const projects = await listProjects(config.projectsDir)
  const listed = new Set(projects.map((p) => p.path))
  const recentDirs = foldTaskDirs(config.recentDirs, tasks)
  const others = await Promise.all(
    recentDirs
      .filter((d) => !listed.has(d.path))
      .map(async (d): Promise<Dir | null> => {
        try {
          const st = await fs.stat(expandHome(d.path))
          return st.isDirectory()
            ? { path: d.path, name: path.basename(d.path), mtimeMs: st.mtimeMs }
            : null
        } catch {
          return null
        }
      })
  )
  const dirs = [...projects, ...others.filter((d): d is Dir => d !== null)]
  const full = dirs.map((d) => expandHome(d.path))
  const [claude, codex] = await Promise.all([
    claudeLastUsed(full, homes.claude),
    codexLastUsed(homes.codex)
  ])

  const recent = new Map(recentDirs.map((d) => [d.path, d]))
  const presetFor = (agent: AgentKind): string | null =>
    config.presets.find((p) => detectAgent(p.command)?.agent === agent)?.id ?? null
  const claudePreset = presetFor('claude')
  const codexPreset = presetFor('codex')

  return dirs
    .map((d, i): DirEntry => {
      const abs = full[i] ?? d.path
      const own = recent.get(d.path)
      const uses = [
        { at: own?.at ?? 0, presetId: own?.presetId ?? null },
        { at: claude.get(abs) ?? 0, presetId: claudePreset },
        { at: codex.get(abs) ?? 0, presetId: codexPreset }
      ]
      const last = uses.reduce((a, b) => (b.at > a.at ? b : a))
      return { ...d, usedMs: last.at, usedPresetId: last.at > 0 ? last.presetId : null }
    })
    .sort((a, b) => b.usedMs - a.usedMs || b.mtimeMs - a.mtimeMs)
}

/** Resolve a cwd from config/layout to an existing absolute directory. */
export async function resolveCwd(cwd: string | undefined, fallback: string): Promise<string> {
  for (const candidate of [cwd, fallback]) {
    if (!candidate) continue
    const abs = expandHome(candidate)
    try {
      if ((await fs.stat(abs)).isDirectory()) return abs
    } catch {
      // try the next one
    }
  }
  return expandHome('~')
}

function parseLsofCwd(out: string): string | null {
  const line = out.split('\n').find((l) => l.startsWith('n'))
  return line ? line.slice(1) : null
}

/** The current working directory of a process, via lsof. */
export function processCwd(pid: number): Promise<string | null> {
  return new Promise((resolve) => {
    execFile(
      'lsof',
      ['-a', '-p', String(pid), '-d', 'cwd', '-Fn'],
      { timeout: 2000 },
      (err, stdout) => {
        resolve(err ? null : parseLsofCwd(stdout))
      }
    )
  })
}

export function processCwdSync(pid: number): string | null {
  try {
    return parseLsofCwd(
      execFileSync('lsof', ['-a', '-p', String(pid), '-d', 'cwd', '-Fn'], {
        timeout: 2000,
        encoding: 'utf8'
      })
    )
  } catch {
    return null
  }
}
