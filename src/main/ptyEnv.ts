/**
 * Variables that describe where Cockpit itself was launched from: the parent
 * terminal (tmux, iTerm, ...) when started with `bun run dev`, a Claude Code
 * session it was started from, and Electron's own. Passing them on makes
 * programs think they run inside that parent. Claude Code warns about tmux
 * focus events when it sees TMUX, and turns off transcript saving when it
 * sees it's a child of another Claude Code session. A Cockpit started from a
 * Cockpit pane gets its own COCKPIT_* values. User settings such as API keys
 * or CLAUDE_CODE_USE_BEDROCK are left alone.
 *
 * NODE_ENV is electron-vite's, not the user's: `electron-vite preview` (`bun
 * start`) sets it to `production` in Electron's environment. Passed on, every
 * Node tool in a pane runs as production, which, for one, loads Vue's
 * production build, and Vue Test Utils then records no component emits.
 */
const INHERITED_TERMINAL_VARS = new RegExp(
  '^(' +
    [
      'TMUX',
      'TMUX_PANE',
      'STY',
      'TERM_SESSION_ID',
      'TERM_PROGRAM_VERSION',
      'LC_TERMINAL',
      'LC_TERMINAL_VERSION',
      'ITERM_.*',
      'KITTY_.*',
      'GHOSTTY_.*',
      'WEZTERM_.*',
      'ALACRITTY_.*',
      'VSCODE_.*',
      'WT_SESSION',
      'ELECTRON_.*',
      'NODE_ENV',
      'CLAUDECODE',
      'CLAUDE_PID',
      'CLAUDE_CODE_ENTRYPOINT',
      'CLAUDE_CODE_EXECPATH',
      'CLAUDE_CODE_CHILD_SESSION',
      'CLAUDE_CODE_SESSION_.*',
      'CLAUDE_CODE_MESSAGING_.*',
      'COCKPIT_SESSION_ID',
      'COCKPIT_SOCKET'
    ].join('|') +
    ')$'
)

/** The environment a pane starts with: Cockpit's own, minus what describes where Cockpit was launched. */
export function paneEnv(parent: NodeJS.ProcessEnv): Record<string, string> {
  const env: Record<string, string> = {}
  for (const [k, v] of Object.entries(parent)) {
    if (v !== undefined && !INHERITED_TERMINAL_VARS.test(k)) env[k] = v
  }
  return env
}
