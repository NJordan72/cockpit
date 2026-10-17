// When Claude Code and Codex last ran in each directory, read from files they
// keep anyway. Claude Code has one folder of transcripts per working directory
// (~/.claude/projects/<dir>/*.jsonl). Codex logs each session to
// ~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl, whose first line names the
// directory. A session appends to its file, so the file's mtime is when it
// last ran.
import fs from 'node:fs/promises'
import path from 'node:path'

/** Codex session files read per listing, newest first. */
const CODEX_FILES = 500
/** The cwd comes early in the first line; the rest of it is the system prompt. */
const CODEX_HEAD_BYTES = 8192
/** Open files at once while reading Codex sessions. */
const BATCH = 32

/** Claude Code's folder for a working directory: everything but letters and digits becomes '-'. */
export function claudeProjectDir(cwd: string): string {
  return cwd.replace(/[^A-Za-z0-9]/g, '-')
}

/** The last time Claude Code wrote a transcript in each of `dirs` (absolute paths). */
export async function claudeLastUsed(
  dirs: readonly string[],
  claudeHome: string
): Promise<Map<string, number>> {
  const used = new Map<string, number>()
  await Promise.all(
    dirs.map(async (dir) => {
      const folder = path.join(claudeHome, 'projects', claudeProjectDir(dir))
      let names: string[]
      try {
        names = await fs.readdir(folder)
      } catch {
        return
      }
      const times = await Promise.all(
        names
          .filter((n) => n.endsWith('.jsonl'))
          .map((n) =>
            fs.stat(path.join(folder, n)).then(
              (st) => st.mtimeMs,
              () => 0
            )
          )
      )
      const last = Math.max(0, ...times)
      if (last > 0) used.set(dir, last)
    })
  )
  return used
}

/** The cwd in the first line of a Codex session file, which may be cut off. */
export function parseCodexCwd(head: string): string | null {
  const line = head.split('\n', 1)[0] ?? ''
  if (!line.includes('"type":"session_meta"')) return null
  const quoted = /"cwd"\s*:\s*("(?:[^"\\]|\\.)*")/.exec(line)?.[1]
  if (!quoted) return null
  try {
    const cwd: unknown = JSON.parse(quoted)
    return typeof cwd === 'string' && path.isAbsolute(cwd) ? cwd : null
  } catch {
    return null
  }
}

/** A session file's cwd never changes once written. */
const codexCwds = new Map<string, string>()

async function codexCwd(file: string): Promise<string | null> {
  const cached = codexCwds.get(file)
  if (cached) return cached
  const fh = await fs.open(file, 'r')
  try {
    const buf = Buffer.alloc(CODEX_HEAD_BYTES)
    const { bytesRead } = await fh.read(buf, 0, CODEX_HEAD_BYTES, 0)
    const cwd = parseCodexCwd(buf.toString('utf8', 0, bytesRead))
    // A file that was just created may not have its first line yet.
    if (cwd) codexCwds.set(file, cwd)
    return cwd
  } finally {
    await fh.close()
  }
}

/** Up to `limit` session files, newest first by the date in their path and name. */
async function newestCodexFiles(sessions: string, limit: number): Promise<string[]> {
  const files: string[] = []
  const walk = async (dir: string, depth: number): Promise<void> => {
    let names: string[]
    try {
      names = await fs.readdir(dir)
    } catch {
      return
    }
    names.sort().reverse()
    for (const name of names) {
      if (files.length >= limit) return
      const full = path.join(dir, name)
      // sessions/YYYY/MM/DD/rollout-<time>-<id>.jsonl
      if (depth < 3) {
        if (/^\d+$/.test(name)) await walk(full, depth + 1)
      } else if (name.startsWith('rollout-') && name.endsWith('.jsonl')) {
        files.push(full)
      }
    }
  }
  await walk(sessions, 0)
  return files
}

/** The last time a recent Codex session ran in each directory, keyed by absolute path. */
export async function codexLastUsed(
  codexHome: string,
  limit = CODEX_FILES
): Promise<Map<string, number>> {
  const used = new Map<string, number>()
  const files = await newestCodexFiles(path.join(codexHome, 'sessions'), limit)
  for (let i = 0; i < files.length; i += BATCH) {
    await Promise.all(
      files.slice(i, i + BATCH).map(async (file) => {
        try {
          const [cwd, st] = await Promise.all([codexCwd(file), fs.stat(file)])
          if (cwd && st.mtimeMs > (used.get(cwd) ?? 0)) used.set(cwd, st.mtimeMs)
        } catch {
          // removed since it was listed
        }
      })
    )
  }
  return used
}
