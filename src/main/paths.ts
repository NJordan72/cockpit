import os from 'node:os'
import path from 'node:path'

/** Root of Cockpit's user data. COCKPIT_HOME overrides it (tests, e2e). */
export const cockpitHome = (): string =>
  process.env.COCKPIT_HOME ?? path.join(os.homedir(), '.cockpit')

/** Claude Code's config and transcripts. */
export const claudeHome = (): string =>
  process.env.CLAUDE_CONFIG_DIR ?? path.join(os.homedir(), '.claude')

/** Codex's config and session logs. */
export const codexHome = (): string => process.env.CODEX_HOME ?? path.join(os.homedir(), '.codex')

/** Antigravity CLI's settings, conversations, and caches. */
export const agyHome = (): string => path.join(os.homedir(), '.gemini', 'antigravity-cli')

export function expandHome(p: string): string {
  if (p === '~') return os.homedir()
  if (p.startsWith('~/')) return path.join(os.homedir(), p.slice(2))
  return p
}

export function abbreviateHome(p: string): string {
  const home = os.homedir()
  if (p === home) return '~'
  if (p.startsWith(home + path.sep)) return '~' + p.slice(home.length)
  return p
}
