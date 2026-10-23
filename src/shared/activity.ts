// What the Activity panel shows about a pane: a log of what its
// agent did, the files it touched, the subagents it started, and the git
// state of its directory. Only the chrome gets this. Widgets don't, since the
// log quotes commands and prompts.

export type ActivityTab = 'log' | 'files' | 'agents' | 'git'

export const ACTIVITY_TABS: readonly ActivityTab[] = ['log', 'files', 'agents', 'git']

/**
 * session: started, resumed, cleared, ended. prompt: the user sent one.
 * tool: a tool call began. fail: a tool call or turn failed, or was denied.
 * ask: the agent wants permission or an answer. agent: a subagent started or
 * finished. note: a notification. stop: a turn finished. compact: the
 * context is being compacted.
 */
export type ActivityKind =
  'session' | 'prompt' | 'tool' | 'fail' | 'ask' | 'agent' | 'note' | 'stop' | 'compact'

export interface ActivityEntry {
  /** 1 for a pane's first entry, then one more for each. */
  seq: number
  /** ms since the epoch */
  at: number
  kind: ActivityKind
  /** The tool's name for tool calls, otherwise a word or two ("Started", "Explore"). */
  label: string
  /** One line: the command, the file, the message. May be empty. */
  text: string
  /** The whole thing when `text` had to be cut down to one line. */
  detail: string | null
  /** The type of subagent this happened in ("Explore"), or null for the main thread. */
  agent: string | null
  /** For a Bash call, what it ran and where, so it can be copied or run again. */
  command: BashCommand | null
}

export interface BashCommand {
  /** The whole command, uncut. */
  text: string
  /** Absolute. null when no hook has said where the session is. */
  cwd: string | null
}

/** created beats edited beats read. */
export type FileChange = 'read' | 'edited' | 'created'

export interface FileTouch {
  /** Absolute path. */
  path: string
  /** Relative to the session's directory when inside it, otherwise with ~ for home. */
  display: string
  change: FileChange
  reads: number
  edits: number
  /** Lines added and removed across all edits, from the tools' patches. */
  added: number
  removed: number
  /** When it was last touched (ms since the epoch). */
  at: number
}

export interface SubagentRun {
  /** Claude Code's agent_id. */
  id: string
  /** "Explore", "general-purpose", ... */
  type: string
  /** The description Claude gave the Agent tool call that started it. */
  description: string | null
  /**
   * failed: its Agent tool call failed. stopped: the turn or session ended
   * before it reported back (an interrupt, say).
   */
  status: 'running' | 'done' | 'failed' | 'stopped'
  started: number
  ended: number | null
  /** Tool calls it made. */
  tools: number
  /** The first line of its final message. */
  result: string | null
  background: boolean
}

export interface PaneActivity {
  paneId: string
  /** The newest entries, oldest first. The last one's seq counts every entry so far. */
  entries: ActivityEntry[]
  /** Most recently touched first. */
  files: FileTouch[]
  /** In the order they started. */
  agents: SubagentRun[]
}

/** What changed in a pane's activity since the last update. */
export interface ActivityUpdate {
  paneId: string
  /** New entries, oldest first. */
  entries: ActivityEntry[]
  /** The whole list, when it changed. */
  files?: FileTouch[]
  agents?: SubagentRun[]
}

export interface GitFile {
  /** Relative to the repository root. */
  path: string
  /** For renames and copies, where it came from. */
  from: string | null
  /** Porcelain status letters: index, worktree. "?" twice for untracked. */
  index: string
  worktree: string
}

export interface GitCommit {
  hash: string
  subject: string
  /** Commit time, ms since the epoch. */
  at: number
}

export interface GitStatus {
  /** The repository's top level, with ~ for home. */
  root: string
  /** null when HEAD is detached. */
  branch: string | null
  /** Short commit id of HEAD; null before the first commit. */
  head: string | null
  upstream: string | null
  ahead: number
  behind: number
  /** Changed and untracked files, at most GIT_MAX_FILES. */
  files: GitFile[]
  /** How many changed files there are in all. */
  changed: number
  /** The newest commits on HEAD. */
  commits: GitCommit[]
}

/** Entries kept per pane, in main and in the chrome. */
export const ACTIVITY_MAX_ENTRIES = 1000

export const GIT_MAX_FILES = 300
