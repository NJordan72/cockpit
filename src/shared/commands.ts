// Slash commands saved from prompts that worked. They're Claude Code's own
// command files, so they run with or without Cockpit: ~/.claude/commands/
// for every project, or <repo>/.claude/commands/ for one.

export type CommandScope = 'global' | 'repo'

export interface SavedCommand {
  /** Typed as /name. */
  name: string
  scope: CommandScope
  description: string | null
  /** The prompt the command expands to. */
  body: string
  /** With ~ for home. */
  path: string
}

export interface CommandList {
  /** The repository root of the focused pane, with ~ for home; null outside a repo. */
  repo: string | null
  commands: SavedCommand[]
}

export interface SaveCommand {
  name: string
  scope: CommandScope
  description?: string
  body: string
  /** The directory whose repository a repo command goes in. */
  cwd: string
  /** Replace a command of the same name and scope. */
  overwrite?: boolean
}

export type SaveResult = { ok: true; path: string } | { ok: false; error: string; exists?: boolean }

/** Claude Code command names: letters, digits, '-' and '_', starting with a letter or digit. */
export const COMMAND_NAME = /^[a-z0-9][a-z0-9_-]{0,63}$/

/** A command name from a prompt's first few words. */
export function suggestName(prompt: string): string {
  return prompt
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 4)
    .join('-')
    .slice(0, 40)
    .replace(/-+$/, '')
}
