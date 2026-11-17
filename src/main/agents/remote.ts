// Panes whose preset has a host run their command on that machine over ssh.
// Nothing is installed there first: everything the agent needs to report
// goes in the ssh command itself. Pure, so it can be tested.
//
// Codex's flags and agy's env var cross as they are, and both report through
// the terminal, which ssh carries. Claude Code's hooks post to Cockpit's
// event socket, so the socket is forwarded to the remote machine with
// `ssh -R`, and the hooks are passed inline to --settings, each one calling
// curl itself. A server that refuses the forward still runs the agent, and
// Claude's OSC 7501 reports (see programStatus.ts) keep its status.
import { CLAUDE_HOOK_EVENTS } from './events'
import { shQuote } from './launch'

/**
 * Where the forwarded socket goes on the remote machine. sshd won't bind
 * over a socket an earlier connection left behind (unless the server sets
 * StreamLocalBindUnlink), so each pane's process gets its own path.
 */
export function remoteSocketPath(token: string): string {
  return `/tmp/cockpit-${token}.sock`
}

/**
 * One hook's command, for a machine without Cockpit's hook script. Like the
 * script, it prints nothing and always exits 0. curl is found on the remote
 * PATH, since it may not be in /usr/bin there.
 */
export function inlineHookCommand(event: string): string {
  return (
    '[ -n "$COCKPIT_SOCKET" ] && [ -n "$COCKPIT_SESSION_ID" ] || exit 0; ' +
    'curl -q -s -o /dev/null --max-time 2 --unix-socket "$COCKPIT_SOCKET" ' +
    `-H "X-Cockpit-Session: $COCKPIT_SESSION_ID" -H 'Content-Type: application/json' ` +
    `--data-binary @- http://cockpit/v1/events/claude/${event} 2>/dev/null; exit 0`
  )
}

/** Claude Code's settings for a remote pane, as the JSON string --settings accepts. */
export function remoteClaudeSettings(): string {
  const hooks = Object.fromEntries(
    CLAUDE_HOOK_EVENTS.map((event) => [
      event,
      [{ hooks: [{ type: 'command', command: inlineHookCommand(event), timeout: 5 }] }]
    ])
  )
  return JSON.stringify({ hooks })
}

/** A directory for the remote shell, with a leading ~ left for it to expand. */
export function remoteDir(dir: string): string {
  if (dir === '~') return '~'
  if (dir.startsWith('~/')) return dir.length > 2 ? `~/${shQuote(dir.slice(2))}` : '~'
  return shQuote(dir)
}

/**
 * This machine's name in the path of its copies on a remote machine: the
 * hostname up to its first dot, as one safe path segment.
 */
export function machineName(hostname: string): string {
  const name = (hostname.split('.')[0] ?? '').replace(/[^A-Za-z0-9_-]/g, '-')
  return name === '' ? 'local' : name
}

/**
 * Where a remote pane starts, and the local directory to copy there first.
 *
 * - `host:dir`, the directory a remote pane reports, opens `dir` again
 *   without copying, so restarting a pane never copies over the agent's
 *   edits.
 * - A local directory, as the launcher passes, is copied into
 *   ~/.cockpit/remote/<this machine> on the host, away from the user's own
 *   files there and from another machine's copies: `~/dev/app` goes to
 *   `~/.cockpit/remote/mac/dev/app`, and `/srv/app`, outside home, to
 *   `~/.cockpit/remote/mac/root/srv/app`. Home itself and / are too big to
 *   copy, so they open the preset's directory instead.
 * - Anything else opens the preset's directory.
 */
export function remoteTarget(
  host: string,
  cwd: string | undefined,
  fallback: string,
  here: { home: string; machine: string }
): { dir: string; copyFrom: string | null } {
  const none = { dir: fallback, copyFrom: null }
  if (!cwd) return none
  if (cwd.startsWith(`${host}:`)) {
    const dir = cwd.slice(host.length + 1)
    return dir ? { dir, copyFrom: null } : none
  }
  const { home } = here
  const local = (cwd === '~' || cwd.startsWith('~/') ? home + cwd.slice(1) : cwd).replace(
    /\/+$/,
    ''
  )
  if (!local.startsWith('/') || local === home) return none
  const copies = `~/.cockpit/remote/${machineName(here.machine)}`
  if (local.startsWith(`${home}/`))
    return { dir: `${copies}/${local.slice(home.length + 1)}`, copyFrom: local }
  return { dir: `${copies}/root${local}`, copyFrom: local }
}

/**
 * Copies a local directory to `dir` on the host with rsync, before ssh
 * starts the agent there. Files a .gitignore ignores are left out, and so
 * are files that are newer on the host (-u), so copying again doesn't undo
 * the agent's edits. Nothing on the host is deleted. rsync creates only the
 * last directory of the path, so the remote side runs `mkdir -p` first.
 * Works with macOS's openrsync as well as rsync 3.
 */
export function copyCommand(host: string, local: string, dir: string): string {
  // rsync's remote paths are relative to the home folder there.
  const target = dir.startsWith('~/') ? dir.slice(2) : dir
  const note = `Copying ${local} to ${host}:${dir}`
  const rsync = [
    'rsync',
    '-a',
    '-u',
    '--filter=:- .gitignore',
    `--rsync-path=mkdir -p ${shQuote(target)} && rsync`,
    `${local}/`,
    `${host}:${target}/`
  ]
  return `printf '%s\\n' ${shQuote(note)} && ${rsync.map(shQuote).join(' ')}`
}

export interface RemoteCommandOptions {
  /** Passed to ssh as is; validHost has checked it. */
  host: string
  /** The directory on the remote machine. */
  dir: string
  /** The agent's command line, flags and all. Omit for an interactive shell. */
  command: string | undefined
  /** Set for the command on the remote machine. */
  env: Record<string, string>
  /** Cockpit's event socket, and where to forward it to on the remote machine. */
  forward: { local: string; remote: string } | null
}

/**
 * The local command that runs `command` on the host. It's read four times:
 * by the local login shell; by the remote user's shell, which ssh hands the
 * command to and which only has to start `sh -c`; by that sh; and by a
 * remote login shell (`$SHELL -lc`), started so the agent is on the PATH the
 * user's profile sets. The login shell's part holds in sh, bash, zsh, and fish.
 */
export function remoteCommand(o: RemoteCommandOptions): string {
  const run = o.command ?? 'exec "$SHELL" -l'
  const inner = `cd ${remoteDir(o.dir)} && ${run}`
  const env = Object.entries(o.env).map(([k, v]) => `${k}=${shQuote(v)}`)
  const login = ['env', ...env, '"$SHELL"', '-lc', shQuote(inner)].join(' ')
  // sshd leaves the forwarded socket behind when the session ends.
  const script = o.forward
    ? `${login}; s=$?; rm -f ${shQuote(o.forward.remote)}; exit $s`
    : `exec ${login}`
  const remote = `sh -c ${shQuote(script)}`
  const args = ['ssh', '-t']
  // An ssh config that sets ExitOnForwardFailure would end the session
  // over a forward the agent can do without.
  if (o.forward)
    args.push('-o', 'ExitOnForwardFailure=no', '-R', `${o.forward.remote}:${o.forward.local}`)
  args.push('--', o.host, remote)
  return args.map(shQuote).join(' ')
}
