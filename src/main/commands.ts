// Reads and writes Claude Code command files for the Commands panel.
import { execFile } from 'node:child_process'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {
  COMMAND_NAME,
  type CommandList,
  type CommandScope,
  type SaveCommand,
  type SaveResult,
  type SavedCommand
} from '@shared/commands'
import { abbreviateHome } from './paths'

function repoRoot(cwd: string): Promise<string | null> {
  return new Promise((resolve) => {
    execFile('git', ['-C', cwd, 'rev-parse', '--show-toplevel'], { timeout: 3000 }, (err, out) => {
      resolve(err ? null : out.trim() || null)
    })
  })
}

function folder(scope: CommandScope, root: string | null, home: string): string | null {
  if (scope === 'global') return path.join(home, '.claude', 'commands')
  return root ? path.join(root, '.claude', 'commands') : null
}

/** A command file: optional frontmatter (only `description` is read), then the prompt. */
export function parseCommand(text: string): { description: string | null; body: string } {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(text)
  if (!m) return { description: null, body: text.trim() }
  const line = /^description:\s*(.*)$/m.exec(m[1] ?? '')?.[1]?.trim()
  return { description: line ? unquote(line) : null, body: text.slice(m[0].length).trim() }
}

/** A YAML scalar as written here (JSON-quoted) or by hand ('single', or bare). */
function unquote(s: string): string {
  if (s.startsWith('"')) {
    try {
      const v: unknown = JSON.parse(s)
      if (typeof v === 'string') return v
    } catch {
      // not JSON after all
    }
  }
  return s.replace(/^'(.*)'$/, '$1')
}

export function formatCommand(body: string, description?: string): string {
  const desc = description?.trim().replace(/\s+/g, ' ')
  return desc
    ? `---\ndescription: ${JSON.stringify(desc)}\n---\n\n${body.trim()}\n`
    : `${body.trim()}\n`
}

async function readFolder(dir: string, scope: CommandScope): Promise<SavedCommand[]> {
  let names: string[]
  try {
    names = await fs.readdir(dir)
  } catch {
    return []
  }
  const found = await Promise.all(
    names
      .filter((n) => n.endsWith('.md'))
      .map(async (n) => {
        const file = path.join(dir, n)
        try {
          const { description, body } = parseCommand(await fs.readFile(file, 'utf8'))
          return { name: n.slice(0, -3), scope, description, body, path: abbreviateHome(file) }
        } catch {
          return null
        }
      })
  )
  return found.filter((c): c is SavedCommand => c !== null)
}

/** The repo's commands, then the global ones, each sorted by name. */
export async function listCommands(cwd: string | null, home = os.homedir()): Promise<CommandList> {
  const root = cwd ? await repoRoot(cwd) : null
  const repoDir = folder('repo', root, home)
  const [repo, global] = await Promise.all([
    repoDir ? readFolder(repoDir, 'repo') : [],
    readFolder(folder('global', root, home) ?? '', 'global')
  ])
  const byName = (a: SavedCommand, b: SavedCommand): number => a.name.localeCompare(b.name)
  return {
    repo: root ? abbreviateHome(root) : null,
    commands: [...repo.sort(byName), ...global.sort(byName)]
  }
}

export async function saveCommand(req: SaveCommand, home = os.homedir()): Promise<SaveResult> {
  if (!COMMAND_NAME.test(req.name)) {
    return { ok: false, error: 'Use lowercase letters, digits, - and _ (up to 64)' }
  }
  if (!req.body.trim()) return { ok: false, error: 'The prompt is empty' }
  const root = req.scope === 'repo' ? await repoRoot(req.cwd) : null
  const dir = folder(req.scope, root, home)
  if (!dir) return { ok: false, error: 'This pane is not in a git repository' }
  const file = path.join(dir, `${req.name}.md`)
  await fs.mkdir(dir, { recursive: true })
  try {
    await fs.writeFile(file, formatCommand(req.body, req.description), {
      flag: req.overwrite ? 'w' : 'wx'
    })
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'EEXIST') {
      return { ok: false, error: `/${req.name} already exists`, exists: true }
    }
    return { ok: false, error: String(err) }
  }
  return { ok: true, path: abbreviateHome(file) }
}

/** Deletes a command file the list returned. Anything else is refused. */
export async function deleteCommand(
  cwd: string | null,
  name: string,
  scope: CommandScope,
  home = os.homedir()
): Promise<boolean> {
  if (!COMMAND_NAME.test(name)) return false
  const root = scope === 'repo' && cwd ? await repoRoot(cwd) : null
  const dir = folder(scope, root, home)
  if (!dir) return false
  try {
    await fs.unlink(path.join(dir, `${name}.md`))
    return true
  } catch {
    return false
  }
}
