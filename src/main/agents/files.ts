// Files Cockpit writes under ~/.cockpit/agents/ for Claude Code to use: the
// hook script and a settings file that registers it. They're rewritten at
// every launch, so they always match the running version.
import fs from 'node:fs'
import path from 'node:path'
import { CLAUDE_HOOK_EVENTS } from './events'
import { shQuote } from './launch'

export interface AgentFiles {
  hook: string
  claudeSettings: string
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
  writeIfChanged(hook, HOOK_SCRIPT, 0o755)
  writeIfChanged(settings, JSON.stringify(claudeSettings(hook), null, 2) + '\n', 0o644)
  return { hook, claudeSettings: settings }
}
