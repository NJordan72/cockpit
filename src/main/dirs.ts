import { execFile, execFileSync } from 'node:child_process'
import fs from 'node:fs/promises'
import path from 'node:path'
import type { DirEntry } from '@shared/ipc'
import { abbreviateHome, expandHome } from './paths'

/** Subdirectories of the projects dir, most recently modified first. */
export async function listProjects(projectsDir: string, limit = 200): Promise<DirEntry[]> {
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
    .filter((e): e is DirEntry => e !== null)
    .sort((a, b) => b.mtimeMs - a.mtimeMs)
    .slice(0, limit)
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
