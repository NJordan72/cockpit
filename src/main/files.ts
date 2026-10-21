// Paths the user can click in a terminal. The renderer finds text that looks
// like a path; these decide which ones are real, relative to the pane's
// directory.
import fs from 'node:fs/promises'
import path from 'node:path'
import { expandHome } from './paths'

/** Most candidates a single check may ask about (one terminal line's worth). */
export const MAX_CANDIDATES = 50

export function resolveIn(cwd: string, p: string): string {
  return path.resolve(cwd, expandHome(p))
}

/** The candidates that name an existing file or directory, in their original order. */
export async function existingPaths(cwd: string, candidates: string[]): Promise<string[]> {
  const checks = await Promise.all(
    candidates.slice(0, MAX_CANDIDATES).map(async (p) => {
      try {
        await fs.stat(resolveIn(cwd, p))
        return p
      } catch {
        return null
      }
    })
  )
  return checks.filter((p) => p !== null)
}
