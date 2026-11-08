// Files Cockpit writes under ~/.cockpit/agents/: the hook script and a
// settings file that registers it with Claude Code, and cockpit-run. The
// folder is on every pane's PATH. The files are rewritten at every launch,
// so they always match the running version.
import fs from 'node:fs'
import path from 'node:path'
import { CLAUDE_HOOK_EVENTS } from './events'
import { shQuote } from './launch'

export interface AgentFiles {
  /** The folder the files are in. */
  dir: string
  hook: string
  claudeSettings: string
  run: string
}

/**
 * Forwards one hook to Cockpit's event socket. It prints nothing and always
 * exits 0: Claude Code reads stdout from some hooks as context, and exit
 * code 2 would block the action the hook is about. curl's -q (first) skips
 * ~/.curlrc, which could otherwise make it print.
 */
export const HOOK_SCRIPT = `#!/bin/sh
# Written by Cockpit, which replaces it at every launch.
#
#   cockpit-hook claude <HookEvent>    (the hook's JSON payload on stdin)
#
# Claude Code runs it through the hooks Cockpit passes with --settings. It
# sends the payload to Cockpit's socket, prints nothing, and always exits 0,
# so it never changes what Claude does. Outside a Cockpit pane it does nothing.
[ -n "$COCKPIT_SOCKET" ] && [ -n "$COCKPIT_SESSION_ID" ] || exit 0
/usr/bin/curl -q -s -o /dev/null --max-time 2 --unix-socket "$COCKPIT_SOCKET" \\
  -H "X-Cockpit-Session: $COCKPIT_SESSION_ID" -H 'Content-Type: application/json' \\
  --data-binary @- "http://cockpit/v1/events/$1/$2" 2>/dev/null
exit 0
`

/**
 * Submits a run to Cockpit, lists runs, or marks an item done, through the
 * event socket. In a Cockpit pane it uses that Cockpit's socket; elsewhere,
 * the one Cockpit that's running. curl's -q (first) skips ~/.curlrc.
 */
export const RUN_SCRIPT = `#!/bin/sh
# Written by Cockpit, which replaces it at every launch.
#
#   cockpit-run submit [file]       Submit a run's JSON, from the file or stdin.
#                                   Cockpit asks you to confirm it before
#                                   starting anything.
#   cockpit-run list                Print each run and its items' states.
#   cockpit-run done <run> <item>   Mark an item done.
usage() {
  echo 'usage: cockpit-run submit [file] | cockpit-run list | cockpit-run done <run> <item>' >&2
  exit 2
}
sock=\${COCKPIT_SOCKET:-}
if [ -z "$sock" ]; then
  for s in "\${COCKPIT_HOME:-$HOME/.cockpit}"/run/cockpit-*.sock; do
    [ -S "$s" ] || continue
    if [ -n "$sock" ]; then
      echo 'cockpit-run: more than one Cockpit is running; set COCKPIT_SOCKET to one of their sockets' >&2
      exit 1
    fi
    sock=$s
  done
  if [ -z "$sock" ]; then
    echo 'cockpit-run: Cockpit is not running' >&2
    exit 1
  fi
fi
req() {
  /usr/bin/curl -q -s --fail-with-body --max-time 30 --unix-socket "$sock" "$@"
  code=$?
  [ "$code" -eq 0 ] && return 0
  [ "$code" -eq 22 ] || echo "cockpit-run: could not reach Cockpit at $sock" >&2
  exit 1
}
case "\${1:-}" in
  submit)
    file=\${2:--}
    if [ "$file" != - ] && [ ! -f "$file" ]; then
      echo "cockpit-run: there's no file $file" >&2
      exit 1
    fi
    req -H 'Content-Type: application/json' --data-binary "@$file" http://cockpit/v1/runs
    ;;
  list)
    req http://cockpit/v1/runs
    ;;
  done)
    [ $# -eq 3 ] || usage
    req -X POST "http://cockpit/v1/runs/$2/items/$3/done"
    ;;
  *)
    usage
    ;;
esac
`

/**
 * Hooks for every event the status needs. They run synchronously (not
 * `async`) so they reach Cockpit in the order Claude fires them; each one
 * takes a few milliseconds.
 */
export function claudeSettings(hook: string): object {
  const hooks = Object.fromEntries(
    CLAUDE_HOOK_EVENTS.map((event) => [
      event,
      [{ hooks: [{ type: 'command', command: `${shQuote(hook)} claude ${event}`, timeout: 5 }] }]
    ])
  )
  return { hooks }
}

function writeIfChanged(file: string, text: string, mode: number): void {
  try {
    if (fs.readFileSync(file, 'utf8') === text) {
      fs.chmodSync(file, mode)
      return
    }
  } catch {
    // missing; write it
  }
  const tmp = `${file}.${process.pid.toString()}.tmp`
  fs.writeFileSync(tmp, text, { mode })
  fs.renameSync(tmp, file)
}

export function installAgentFiles(home: string): AgentFiles {
  const dir = path.join(home, 'agents')
  fs.mkdirSync(dir, { recursive: true })
  const hook = path.join(dir, 'cockpit-hook')
  const settings = path.join(dir, 'claude-settings.json')
  const run = path.join(dir, 'cockpit-run')
  writeIfChanged(hook, HOOK_SCRIPT, 0o755)
  writeIfChanged(settings, JSON.stringify(claudeSettings(hook), null, 2) + '\n', 0o644)
  writeIfChanged(run, RUN_SCRIPT, 0o755)
  return { dir, hook, claudeSettings: settings, run }
}
