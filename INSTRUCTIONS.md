# Cockpit: build instructions

Cockpit is a personal macOS desktop app for running Claude Code and Codex
side by side. It's a terminal host with a widget sidebar. The agents run in
their normal terminal interfaces. Cockpit adds the parts around them: tabs and
splits, awareness of what each agent is doing, and widgets that can call out
to services like Shortcut.

It's for one user on one Mac. Signing, auto-update, Windows/Linux, and skins
are out of scope until the milestones below are done.

Work through the milestones in order. Each one should leave the app runnable
(`bun run dev`) and end with a commit. Check each milestone's "done when" items
by actually running the app, not just by type-checking.

## Background

The user had a Shortcut widget for another terminal app, where widgets get
`connect-src 'none'` and no HTTP channel. That widget needed a launchd job that
wrote Shortcut data into the app's config file, and the widget polled the file
every 5 seconds. Cockpit's widget API should make that kind of workaround
unnecessary.

Build Cockpit from public libraries only. Don't read, unpack, or copy code or
assets from other apps.

## Stack

- Electron (current stable), TypeScript throughout, built with `electron-vite`.
- Terminals: `@xterm/xterm` with `addon-fit`, `addon-webgl`, `addon-unicode11`,
  `addon-search`, `addon-web-links`. PTYs come from `node-pty` in the main
  process. `node-pty` is native, so rebuild it against Electron with
  `@electron/rebuild` (wire this into `postinstall`).
- Package manager and script runner: bun (`bun install`, `bun run <script>`).
  Electron 44 downloads its binary lazily, so `postinstall` runs
  `install-electron` before the rebuild.
- Strict TypeScript (`strict`, `noUncheckedIndexedAccess`), typescript-eslint
  `strictTypeChecked` with `--max-warnings 0`, and Prettier.
- App chrome UI: React. Keep the chrome small. The terminals and widgets are
  the point.
- Secrets: Electron `safeStorage` (the key lives in the macOS Keychain). No
  native keychain module.
- Config and widgets live in `~/.cockpit/`:
  - `config.json`: layout, presets, keybindings, widget placement
  - `widgets/<id>/`: one folder per widget
  - `data/<id>.json`: per-widget storage
  - `secrets/`: safeStorage-encrypted blobs

Electron security baseline, on every window: `contextIsolation: true`,
`nodeIntegration: false`, `sandbox: true`, a preload that exposes a narrow
typed API through `contextBridge`, and a strict CSP. No `remote` module.

## Milestones

### M0: one working terminal

- Scaffold the electron-vite + React + TS app, `.gitignore`, and package
  scripts (`dev`, `build`, `typecheck`, `lint`).
- The main process spawns a login shell (`$SHELL -l`) in a PTY. The renderer
  shows it in xterm.js with the WebGL renderer, falling back to xterm's DOM
  renderer. (xterm 6 has no canvas addon; `@xterm/addon-canvas` stopped at
  xterm 5.)
- Handle resize: fit addon → IPC → `pty.resize`.
- Get the keys right for the agent interfaces: Shift+Enter inserts a newline
  in Claude Code, Option works as Meta, Cmd+C/Cmd+V copy and paste, Cmd+K
  clears the screen.

Done when: `claude` and `codex` both run inside it, render correctly (colors,
box drawing, spinners), survive window resizing, and accept multi-line input.

### M1: tabs, splits, presets

- Tabs and horizontal/vertical splits, each pane with its own PTY.
- New-pane presets defined in `config.json`. Defaults: Shell, Claude Code
  (`claude`), and Codex (`codex`), each with a working directory. Cmd+T opens
  a picker that offers recent directories from `~/dev`.
- Keybindings for new tab, split, close, move focus, and switch tab, all
  configurable in `config.json`.
- Restore the layout (tabs, splits, cwd, preset) on relaunch. Don't try to
  restore scrollback or processes.
- When a PTY exits, show the exit status in the pane and offer to restart.

Done when: you can run Claude Code in one split and Codex in another in the
same repo, quit, relaunch, and get the same layout back.

### M2: widget host

Widgets are folders of HTML/JS/CSS with a manifest:

```json
{
  "id": "shortcut-stories",
  "name": "Shortcut Stories",
  "version": "1.0.0",
  "entry": "index.html",
  "sizing": "fill",
  "permissions": {
    "network": ["api.app.shortcut.com"],
    "openExternal": ["https://app.shortcut.com/*"],
    "secrets": ["shortcut-token"],
    "storage": true,
    "sessions": "read"
  }
}
```

- Serve each widget from a custom protocol (`cockpit-widget://<id>/...`),
  registered as privileged and secure, so widgets never get `file://`.
- Render each widget in an `<iframe sandbox="allow-scripts">`. Leave out
  `allow-same-origin`, so the widget gets an opaque origin and can't reach the
  host's DOM or storage. Set a CSP with `connect-src 'none'`. Widgets reach
  the outside world only through the broker.
- The broker: the widget calls `cockpit.*` (a small script injected into the
  widget or shipped as `cockpit-widget.js`). It talks `postMessage` to the
  host renderer, which forwards to the main process over IPC. The main process
  checks each call against the manifest before running it. Calls are
  request/response with ids, timeouts, and typed errors.
- First version of the widget API:
  - `cockpit.fetch(url, init)`: only hosts listed in `permissions.network`.
    It runs in the main process, so CORS doesn't apply. Return status,
    headers, and body as text.
  - `cockpit.storage.get(key)` / `set(key, value)` / `subscribe(cb)`: backed
    by `~/.cockpit/data/<id>.json`.
  - `cockpit.secrets.get(name)` / `set(name, value)`: only names the manifest
    declares. When a secret is missing, the host shows its own prompt for it,
    not the widget, so widgets can trigger the prompt but never render it.
  - `cockpit.openExternal(url)`: must match an `openExternal` pattern.
  - `cockpit.sessions.list()` / `subscribe(cb)`: read-only agent session state
    (filled in by M4; return what exists for now).
  - `cockpit.theme`: CSS variables pushed into the widget, plus an event when
    they change.
- The sidebar holds widgets stacked or in tabs, resizable and collapsible.
  Placement goes in `config.json`.
- Hot reload: watch `~/.cockpit/widgets/` and reload a widget's iframe when
  its files change. Follow symlinks.
- Write a `hello` example widget that exercises every API call. Document the
  API in `docs/widgets.md`.

Done when: the example widget can fetch from an allowed host, is refused for a
host that isn't listed (with a clear error), stores and reads data, and reloads
when you edit its file.

### M3: port the Shortcut widget

Port the user's existing Shortcut widget to Cockpit as
`examples/widgets/shortcut-stories/`, with an install script that symlinks it
into `~/.cockpit/widgets/`.

- Fold the logic in `sync/shortcut-sync.mjs` (the search query with `{me}`
  expansion, the `FEEDS` tabs, the 50/250 limits) into the widget itself, using
  `cockpit.fetch` and `cockpit.secrets`. No launchd job, no Keychain step in
  the install script.
- Keep the UI behavior described in that repo's README: Doing / Next / All
  tabs, the FE Defined feed, the search gear, and the freshness dot.
- Clicking a story opens it in the browser through `cockpit.openExternal`.
- Poll Shortcut every 60 seconds while the widget is visible and back off
  when it's hidden.

Done when: the widget shows the user's real stories, and the only setup was
pasting a Shortcut token into the host prompt once.

### M4: agent awareness

Give each pane a status, `idle | working | needs-input | done | exited`,
shown as a badge on its tab, in a sidebar session list, and through
`cockpit.sessions`.

- Run a local event server in the main process (a Unix socket under
  `~/.cockpit/`). Give each PTY `COCKPIT_SESSION_ID` and `COCKPIT_SOCKET` env
  vars so events can be matched to panes.
- Claude Code: use hooks (Notification, Stop, UserPromptSubmit, PreToolUse,
  SessionStart, and others) that run a small `cockpit-hook` script. The script
  forwards the hook's JSON payload plus the session id to the socket. Don't
  write into the user's global `~/.claude/settings.json`. Pass the hooks when
  launching instead, for example with a `--settings` file if the current CLI
  supports one. Check `claude --help` and the hooks docs first. Hook names and
  flags change between versions, so verify them against the installed CLI.
- Codex: check what the installed version provides (the `notify` program in
  `~/.codex/config.toml`, `codex exec --json`, app-server mode) and use the
  lightest option that reports "turn finished" and "needs approval". Verify
  against `codex --help` and the current docs. Don't rely on memory.
  (codex-cli 0.162.1: `notify` only reports a finished turn and a `-c notify`
  replaces the user's own; hooks passed with `-c` need a trust entry saved to
  config.toml. The TUI's terminal title and OSC 9 notifications, pinned with
  `-c tui.*`, report both events without either problem.)
- Fallback for both: an output-silence heuristic. A PTY that printed recently
  is `working`, and quiet after output means `idle`.
- When a pane goes to `needs-input` or `done` and the window isn't focused,
  send a macOS notification. Clicking it focuses that pane.
- Optional: read `~/.claude/projects/**/*.jsonl` to show each Claude session's
  title and token use in the session list.

Done when: starting a Claude Code task in one pane and switching away results
in a notification when it needs permission and another when it finishes, and
the tab badge matches each time.

### M5 (optional): worktree per task

A "New task" action that asks for a repo and a branch name, creates a git
worktree under `~/.cockpit/worktrees/`, and opens a Claude Code or Codex pane
in it. Show worktree and branch in the session list, and add a "clean up"
action that removes merged worktrees.

## Working agreements

- Commit at the end of each milestone, plus whenever a step is worth keeping.
  Use Conventional Commit messages.
- Keep a `README.md` with how to install, run, and add a widget. Update it
  as features land.
- Add tests where they're cheap and catch real bugs: manifest permission
  checks, the URL allowlist matcher, config migration, hook event parsing.
  The terminals themselves get checked by hand.
- If a library or CLI behaves differently from what this file says, trust the
  current docs and installed version, and update this file to match.
- After each milestone, add a short "Status" note at the bottom of this file
  saying what's done, what's left, and any decisions that changed.

## Status

### M0: done (2026-10-15)

- electron-vite 6 + Electron 44 + React 19 + xterm 6, managed with bun.
  Strict TS, type-checked ESLint, Prettier; `bun run check` runs all of it
  plus vitest.
- One pane: a `$SHELL -l` PTY in xterm with WebGL (DOM renderer fallback),
  unicode11, search, and web-links (links open in the browser via the main
  process's window-open handler).
- Keys: Shift+Enter sends ESC CR, which Claude Code, Codex, and zsh all treat
  as "insert newline". Option is Meta. Cmd+C/Cmd+V go through main-process
  clipboard IPC (sandboxed preloads can't use `clipboard`; Electron 44's
  `clipboard` API is async). Cmd+K clears. Other Cmd shortcuts are kept away
  from the PTY for the app to use.
- Security: contextIsolation, sandbox, no nodeIntegration on the window; IPC
  only accepted from the top-level chrome frame; navigation and window.open
  blocked (http(s) links go to the browser); all permission requests denied.
  CSP is strict in the build and loosened in dev only for Vite's inline React
  refresh preamble and HMR websocket.
- Verified by driving the built app with `scripts/drive.mjs` (Playwright):
  `claude` and `codex` both render (colors, box drawing, braille/block art,
  the Claude spinner), multi-line input works in both and in zsh, a resize
  from 158x47 to 100x32 reflows correctly, Cmd+V pastes, Cmd+C copies the
  selection, Cmd+K clears. Dev mode also checked over CDP: renders with no
  CSP violations.
- Not tested: Codex past its folder-trust prompt (testing in the command
  center avoided saving a trust decision to `~/.codex/config.toml`). Copy and
  paste were tested with synthesized key events, which skip the macOS menu.
  With a physical keyboard the Edit menu's Cmd+C/Cmd+V also exist; the
  renderer calls preventDefault, which should stop the menu from firing too.
  If paste ever doubles, that's where to look.
- Seen once and not reproduced in five more cold launches: a stray `ions`
  command typed into a fresh shell at startup. Watch for it in M1. (M1: not
  seen again across about ten launches.)

### M1: done (2026-10-15)

- Config: `~/.cockpit/config.json` (or `$COCKPIT_HOME`), versioned, read
  through `migrateConfig`, which repairs bad values field by field instead of
  rejecting the file. Atomic writes; hand edits are watched and applied live
  (keybindings, presets, font). The live layout always wins over a hand-edited
  one.
- Layout is a split tree per tab. Every pane of every tab renders in one flat
  keyed list positioned from the tree, so splitting, closing a neighbour, or
  switching tabs never remounts a terminal (which would kill its PTY).
- Presets are resolved in the main process: the renderer sends a preset id,
  never a command line.
- Cmd+T and the split keys open one picker: preset (Tab cycles), then a
  directory from the focused pane's live cwd, recent dirs, and `~/dev`
  subdirectories by mtime. Splitting without a picker felt too limited for
  "Claude left, Codex right in the same repo".
- Restore: on quit, each live pane's cwd is read with `lsof` and saved, so a
  shell you `cd`'d in reopens there.
- PTY env: variables describing the parent terminal (TMUX, iTerm, VS Code ...)
  and a parent Claude Code session (CLAUDECODE, CLAUDE_CODE_SESSION_*, ...)
  are stripped. Without that, Claude Code inside Cockpit warned about tmux
  focus events and turned off transcript saving whenever Cockpit was started
  from a terminal or from Claude Code.
- Verified with the driver, using a scratch COCKPIT_HOME and a Dock-like env:
  Claude Code and Codex in a 40/60 split of `~/dev/cockpit` plus a shell tab
  that had `cd /tmp`; quit and relaunch brought back both tabs, the split
  sizes, the presets, and `/private/tmp`. Also checked: exit status bar and
  Enter-to-restart, Cmd+W closing a split, Cmd+Alt+Left/Right focus, tab
  cycling, divider drag, and rebinding newTab to Cmd+N plus a font size change
  in config.json while running.
- Tests: config migration, split tree ops and focus geometry, the layout
  reducer, keybinding parsing, and picker ranking (45 tests).
- Left for later: a "rename tab" action, and showing the OSC window title
  (Claude Code sets one) in tabs. Panes in a hidden tab start at 80x24 and
  resize when first shown.

### M2: done (2026-10-17)

- Widgets load from `~/.cockpit/widgets/<id>/` (symlinks followed; the real
  folder is watched recursively) and are served over `cockpit-widget://<id>/`,
  registered as standard and secure. Each runs in an
  `<iframe sandbox="allow-scripts">` with a CSP response header that has
  `connect-src 'none'` and only allows loads from the widget's own origin.
- The SDK (`src/widget-sdk/cockpit-widget.ts`) is compiled into the main
  bundle by a small Vite plugin and served at `/cockpit-widget.js`, injected
  ahead of the widget's scripts along with the theme variables. The chrome
  attributes each postMessage to a widget by its source window, then the main
  process checks the call against that widget's manifest. Calls carry ids,
  timeouts, and typed error codes.
- API as planned, plus `storage.keys()`, `secrets.delete()`,
  `secrets.get(name, { prompt: false })`, `cockpit.ready`, `cockpit.widget`,
  and `cockpit.visibility` (false when collapsed, in a background tab, or the
  window is hidden), which M3's polling needs. Manifests also take
  `"sizing": "content"`. Documented in `docs/widgets.md`.
- Decisions: the manifest id must equal the folder name, so ids are unique.
  Secrets are namespaced per widget (`secrets/<id>/<name>.bin`). Unknown
  permission keys are a manifest error. Session `status` is `running` or
  `exited` until M4. Theme colors moved to `src/shared/theme.ts`, and
  `config.json`'s `theme` overrides them live for the chrome, the terminals,
  and widgets.
- Changed from the plan's assumptions: Electron 44 doesn't emit
  `will-frame-navigate` for widget frames (they are out-of-process iframes),
  so a widget could navigate its frame to `https://...?data`. A
  `webRequest.onBeforeRequest` filter now cancels every subframe load that
  isn't `cockpit-widget:`; checked against a local server that no request
  arrives. data: navigations don't commit, and mailto: is refused by the
  sandbox.
- Cmd shortcuts pressed while a widget has focus are forwarded from
  `before-input-event`. Playwright's `keyboard.press` bypasses that event, so
  the driver gained `nkey`, which uses `sendInputEvent`.
- Verified in the built app with a scratch COCKPIT_HOME: `hello` fetches
  example.com, is refused example.org with an error naming the fix, stores and
  reads data (and the file on disk), reloads when a file in the symlinked repo
  folder changes, prompts for a secret in the host UI (cancel, persist across
  relaunch, encrypted at rest), opens allowed URLs only, lists sessions and
  updates on split, follows a theme edit in config.json, and reports
  visibility through collapse, tabs mode, and Cmd+B. Direct fetch and remote
  images from inside the widget are blocked by CSP. Sidebar width and widget
  sizes persist. Dev mode loads widgets with no CSP errors.
- Tests: permission matchers, manifest parsing, the broker's permission
  checks, fetch (allowlist, redirects off the list, size cap, timeout),
  storage, the registry (symlinks, broken links, reload on edit), serving
  helpers, sidebar placement, and config migration (132 total).
- Hardened after a review of the M2 commit:
  - WebRTC reached arbitrary hosts. A widget's TURN-over-TCP connection
    arrived at a test listener, including from a `srcdoc` frame, and CSP
    `webrtc 'block'` isn't implemented. The renderer session now goes
    through a proxy that doesn't exist (loopback included, except in dev).
    UDP was already off through `setWebRTCIPHandlingPolicy`. Both were
    re-tested against LAN and loopback listeners.
  - Widget files are served only if their real path stays inside the
    widget folder.
  - Widget ids must start with a letter and can't start with `xn--`, since
    Chromium rewrites numeric and punycode hosts.
  - Secret prompts appear only while the asking widget is visible, refuse
    that widget for 10 s after a cancel, and don't focus their input.
  - Storage reads the file before each write, so it can't overwrite an
    outside edit or a corrupt file, and it treats keys like `__proto__` as
    plain keys.
  - Smaller fixes: unique temp files for secrets, fetch error codes, keyed
    sidebar sections (a reorder no longer reloads widgets), and a race in
    the first widget list.

### M3: done (2026-10-17)

- `examples/widgets/shortcut-stories/` ports the old widget, installed
  with `examples/widgets/install.sh shortcut-stories` (a symlink, no launchd,
  no Keychain step). The sync script's logic now lives in the widget: the
  search with `{me}` expansion, the `FEEDS` tabs, the 50/250 limits, paging,
  and the state ordering, all through `cockpit.fetch` with the token from
  `cockpit.secrets`.
- Same UI as before (Doing / Next / All, FE Defined, the search gear, the
  freshness dot). Clicking a story opens it through `cockpit.openExternal`;
  the details the click used to show moved to a ▸ button on the row. Changes
  to the query apply at once, and clicking the age syncs now.
- Polling: every 60 s while visible, every 15 min while hidden, and an
  immediate sync when shown if the last one is over a minute old. Failures
  back off exponentially up to 15 min and honor `Retry-After`. A 401 stops
  polling and offers a button to enter a new token through the host prompt.
- Verified with the real Shortcut API in a fresh COCKPIT_HOME, where the
  only setup was pasting the token into the host prompt once (the driver read
  it from SHORTCUT_API_TOKEN without printing it): 50 of 52 stories in
  Awaiting Deployment, QA, In Development order, FE Defined with 194 stories
  paged in full, opening a story, the ▸ details, editing and resetting the
  query, the tab surviving a relaunch with no second prompt, the 15 min
  interval while collapsed and an immediate sync when shown after a minute,
  and recovering from a rejected token.
- Not covered: the 429 path (Shortcut never rate limited these runs).

### M4: done (2026-10-17), except real notifications from the dev build

- Every pane has a status (idle, working, needs-input, done, exited), shown
  as a dot on its tab (the most urgent pane's; idle gets none), in a Sessions
  list at the top of the sidebar (click to focus), as a Dock badge counting
  panes that need the user, and through `cockpit.sessions`, which gained
  `since`, `agent`, `title`, and `tokens`. `running` is gone. The chrome also
  gets `message` (what the agent is waiting for); widgets don't, since it can
  quote a command waiting for approval.
- Event server: HTTP over a Unix socket, `~/.cockpit/run/cockpit-<pid>.sock`
  (one per process, so a dev build doesn't take over the installed app's;
  stale ones are removed; a home too long for a socket path falls back to
  `$TMPDIR`). Mode 0600. Each PTY spawn gets a fresh random
  `COCKPIT_SESSION_ID`, so a restarted pane ignores its old process's events.
- Claude Code: a preset whose command starts with `claude` gets
  `--settings ~/.cockpit/agents/claude-settings.json`, which registers 15
  hooks (names checked against 2.1.302 and the current hooks docs) running
  `~/.cockpit/agents/cockpit-hook`, a sh + curl script that prints nothing
  and always exits 0. Hooks are synchronous so they arrive in order.
  PermissionRequest (fires as the dialog opens) is the needs-input signal; it
  is keyed by tool name and input, so a parallel tool finishing doesn't clear
  an open dialog. Esc fires no hook, so a hooked turn that goes 10 s without
  output turns idle (Claude's spinner keeps printing while the window is
  blurred; checked with a 15 s tool call).
- Codex: `-c` overrides for `tui.terminal_title` (activity + run-state),
  `tui.notifications`, `notification_method="osc9"`, and
  `notification_condition="always"`; main reads OSC 0 and OSC 9 from the
  pane's output. Title changes give working/waiting/ready, OSC 9 gives
  "turn complete" and the approval text. Cost: any `-c` puts the TUI in
  embedded mode (no shared app-server daemon; Codex shows a startup warning).
- Everything else: output for 1 s without a gap means working, 2.5 s quiet
  means idle; output within 250 ms of input or a resize doesn't count.
- done turns idle when the pane is focused in a focused window or typed into,
  so a turn that ends while you watch goes straight to idle.
  Notifications wait 250 ms (so Codex's approval text arrives first), skip a
  focused window, and close when their pane is focused.
- Title and tokens come from the tail (1 MB) of the transcript path in each
  hook payload, read on turn end and at most every 10 s otherwise, and only
  under `~/.claude` (or `$CLAUDE_CONFIG_DIR`).
- Verified in the built app with a scratch COCKPIT_HOME: Claude Code (Haiku,
  `--permission-mode default`) in a background tab with the window blurred
  went working, needs-input with a notification ("Claude needs permission to
  use Bash"), and the tab badge matched; clicking the notification focused
  the window and pane; approving went working through a 15 s command, then
  done with a second notification ("ok"); focusing made it idle. Codex
  (`-s read-only`) did the same with its own approval text. The output
  heuristic, the hook script, a fake hook from a shell, and the Dock badge
  were checked too. Notifications were recorded by stubbing
  `Notification.prototype.show` from the driver.
- Not working: a real macOS notification. macOS 27 refuses them for the
  ad-hoc-signed development Electron (`UNErrorDomain error 1`, the same when
  launched through LaunchServices; Electron never appears in System Settings
  > Notifications). Cockpit bounces the Dock icon instead and logs a warning
  > once. Real notifications need a signed build, which is out of scope here.
- Fixed on the way: after the window regained focus, Chromium could put
  keyboard focus on the first tab's close button, so Enter closed a tab. The
  chrome's buttons are now out of the tab order and the terminal takes focus
  back. A startup failure (an unusable COCKPIT_HOME) used to throw again in
  `will-quit`; it now shows an error and exits.
- Tests: hook parsing, Codex OSC scanning and title states, the status
  tracker (heuristic, hooks, dialogs, timeouts), launch flags, the transcript
  tail, the socket server, the hook script through curl, the monitor over a
  real socket, and the session list (205 total).
- A fresh-context review of the diff found no high-severity problem. Fixed
  from it: curl now skips `~/.curlrc` (`-q`), whose `write-out` would have
  put text into Claude's context; SessionStart from a compaction no longer
  ends a turn; a turn that ends while watched no longer stays done; typing
  ahead during a long tool call no longer times the turn out; the Dock badge
  drops panes when the window closes; the event log leaves out message text;
  widgets no longer get `message`; and the window-focus handler leaves an
  open prompt alone.
- M2's storage test for outside edits wrote the file the instant the watcher
  started and failed about one run in seven under the heavier suite; it now
  waits 200 ms for the watcher first.
- Left for later: real notifications (needs signing), agent awareness for
  `claude` typed by hand in a Shell pane, and showing the OSC title in tabs.

### Start screen (added 2026-10-17, not in the original plan)

- Cockpit opens on a start screen instead of restoring the layout directly:
  `~/dev`'s folders plus recent dirs elsewhere, most recently used first, an
  agent switch (presets with a command; `Tab` flips it) that remembers the
  last agent launched (`config.json` `launcher.presetId`), and a filter that
  also takes a typed path. Enter or a click opens a tab. Closing the last tab
  returns to it.
- "Most recently used" is the latest of: a Cockpit pane started there
  (`recentDirs` entries now carry `at` and `presetId`; config version 2,
  version 1's bare paths are read as entries with no time), the newest
  `*.jsonl` mtime in Claude Code's `~/.claude/projects/<dir with
non-alphanumerics as ->/`, and the newest mtime among the 500 newest Codex
  session files whose first line's `cwd` is that dir. Each row names the
  preset of that use and how long ago. The Cmd+T picker uses the same list
  (current dir first), so its "recent" tag is gone.
- The saved layout becomes a "Restore last session" button. Nothing is saved
  over it until a project is launched or it's restored, so quitting from the
  start screen keeps it. Main lists no sessions until the chrome sends a
  layout, so the sidebar doesn't show the saved panes as exited.
- Verified in the built app with a scratch COCKPIT_HOME and harmless presets
  (`claude --version; exec zsh` and the Codex equivalent): the list matched
  real Claude/Codex use, Tab and Enter opened Codex in the top project,
  closing the tab came back with Codex still selected and the row marked
  "Codex · now", filtering opened another project, relaunch offered Restore
  (also after quitting from the start screen), Restore brought the tab back,
  the selection scrolls into view, and Cmd+T still works.

### Activity panel (added 2026-10-17, not in the original plan)

- The sidebar has an Activity panel between Sessions and the widgets. It
  follows the focused pane and has four tabs. Log lists hook events, and
  tool calls with their command or file. Files lists the files Claude read or
  changed, with lines added and removed from the Edit and Write patches.
  Agents lists subagents with their description, tool calls, duration, and
  result. Git shows branch, upstream, changes, and the last five commits.
  It's chrome-only; widgets get none of it, since the log quotes commands.
- Main keeps the log in memory (`src/main/agents/activity.ts`): the newest
  1,000 entries per pane, sent to the chrome in 100 ms batches with the
  file and agent lists only when they changed. The renderer takes a snapshot
  when the focused pane changes and appends entries by sequence number.
- Claude Code now gets 17 hooks, adding SubagentStart and SubagentStop.
  They feed only the panel, and the status tracker ignores them. Payload fields
  were checked against 2.1.302 by recording real hook runs. What the
  recordings showed and the code relies on:
  - SubagentStart carries only `agent_id` and `agent_type`, so a run is
    matched to the oldest waiting Agent call of the same type, then corrected
    from the call's result, whose `tool_response.agentId` names it.
  - Agents run in the background by default. The Agent call's result says
    `isAsync: true` and `async_launched` even without `run_in_background` in
    the input, and it can arrive before SubagentStart.
  - A finished background task reaches Claude as a `<task-notification>`
    prompt through UserPromptSubmit. The log shows its summary as a NOTE row,
    and its `<task-id>` and `<tool-use-id>` complete and name the run.
  - Claude Code's own helpers (the prompt suggester, for one) send
    SubagentStop with an empty `agent_type` and no SubagentStart. They're
    left out.
  - Answering No to a permission dialog sends no hook, so the log shows the
    request and nothing after it.
- Git runs with `--no-optional-locks` (never takes `index.lock` from an agent)
  and `-c core.fsmonitor=false`, because a repository's config can name an
  fsmonitor program and Cockpit runs git in whatever directory a pane is in.
  The working directory comes from the latest main-thread hook payload, then
  `lsof` on the pane's process, then the layout.
- Verified in the built app with a scratch COCKPIT_HOME and Claude Code on
  Haiku in a scratch repo: a turn with a background Explore agent, a Read, an
  Edit, a Write, and Bash; two parallel agents; a permission prompt for a
  Write outside the project (ASK row, highlighted); every tab's contents and
  counts; expanding a row; the divider drag and fold, saved to config.json;
  the panel filling the sidebar with no widgets and returning to its height
  when one came back; a Shell split showing the empty-log note and Git from
  its `cd`'d directory; focus moving between panes switching the panel.
- Not run against a live Codex session (it would save a trust decision to
  `~/.codex/config.toml`); Codex entries are covered by unit tests on the
  signals CodexWatcher already produces.
- Tests: tool descriptions, path display, patch counts, the hook sequences
  recorded above, batching, the entry cap, Codex entries, task notifications,
  git porcelain v2 parsing and a real repository (including the fsmonitor
  guard), sidebar settings migration, and the renderer's merge and filters
  (250 total).

### Kids mode (added 2026-10-17, not in the original plan)

- A pretend terminal for the user's toddler, who wants to work too. Cmd+Shift+K
  (the `kidsMode` keybinding) or View > Kids Mode turns it on. An overlay
  covers the whole window with a tab bar and an xterm in the user's font and
  theme, at twice the font size, and takes every key in the capture phase.
  Letters show big and bring out a character, digits show that many
  characters to count, Enter runs a pretend agent turn with Claude's spinner,
  and every key plays a note. Typing `kids.exitWord` (default `grownup`) leaves.
- Main owns the on/off state (`setKids` in `src/main/index.ts`), so it survives
  a chrome reload. While it's on, main ignores `pty:write` and `pty:kill`,
  puts the window in kiosk mode (Electron's `SetKiosk` disables process
  switching, force quit, session termination, and hiding), swaps in a menu
  with only About, and reports the window as unfocused to the status tracker
  and as focused to the notifier. The first keeps finished turns marked done
  for later. The second shows no notifications over the child's screen.
- Sound is Web Audio (a bell from three oscillators through a compressor).
  `songs` mode plays five public-domain nursery rhymes one note per key, at
  most one note per 110 ms so a palm on the keyboard still plays the tune.
  `notes` mode maps keyboard rows to a pentatonic scale. Speech uses
  `speechSynthesis` 450 ms after the last letter or digit.
- Characters are emoji by default (one per letter, "B is for bear"). Image
  files in `~/.cockpit/kids/` replace the emoji for their name's first letter.
  Main reads them as data: URLs (the chrome's CSP already allows data: images),
  8 MB per file and 64 MB in total.
- Verified in the built app with a scratch COCKPIT_HOME and a `cat` preset, so
  anything reaching a PTY would echo: kiosk on and off, the kids menu holding
  only About, the welcome box with the configured name, big letters, the cat
  emoji for C and a test SVG for B, a row of sprites for 3, 12 oscillators for
  4 keys, speech queued after a pause (180 voices), the cat pane receiving
  neither the typed keys nor a direct `pty.write`, Cmd+W/T/B doing nothing,
  the spinner and answer, the tab's working dot, a click spawning a sprite,
  the exit word restoring the menu and the cat pane taking keys again, the
  View menu item, kids mode staying on through a chrome reload, a full line
  submitting itself, quitting while it's on, and no console errors or
  warnings.
- Not checked by hand: physical Cmd+Q and Cmd+Tab presses while in kiosk mode
  (synthesized key events skip the macOS menu, and a scripted Cmd+Q would quit
  whichever app was in front if the lock failed). They rest on the kids menu
  having no Quit item and on Electron's kiosk options. Also unchecked:
  hearing the notes and voice, `notes` mode in the app (unit tested), the
  notification suppression, and a second display, which kiosk mode doesn't
  cover.
- Tests: kids settings migration and exit word validation, the letter table,
  picking pictures, the exit word watcher, songs, key-to-note mapping, and
  reading the pictures folder (268 total).

### Icon, themes, layouts (added 2026-10-17, not in the original plan)

The user asked for a more distinct look, panels they can arrange, and their
own artwork as the app icon. The intro's "skins are out of scope" predates
that request.

- Icon: `resources/icon.png`, set as the Dock icon at startup (the app is
  unpackaged, so the Dock shows it only while Cockpit runs).
  `resources/icon.icns` is there for a future packaged build. macOS's
  standard About panel always shows the bundle's icon (Electron's here), and
  `setAboutPanelOptions({ iconPath })` only works on Linux and Windows, so
  About Cockpit is a dialog of its own.
- Themes (`src/shared/theme.ts`, `themes.ts`, `src/main/themes.ts`, documented
  in `docs/themes.md`):
  - A theme is a set of flat tokens (colors, fonts, header style, radius,
    panel gap, CRT effects), each a CSS variable in the chrome and in widgets,
    plus an xterm palette. Themes can extend another, up to four deep.
  - Built in: Midnight (the old colors, still the default), Amber (from the
    icon), and Paper (light).
  - User themes are folders in `~/.cockpit/themes/` with an optional
    stylesheet, images, and fonts, watched for edits. They're served over
    `cockpit-asset://`. That scheme is registered in the same
    `registerSchemesAsPrivileged` call as `cockpit-widget://`, since Electron
    keeps only the last call's list. It serves only stylesheets, images, and
    fonts whose real path is inside the folder. The widget CSP doesn't allow
    it.
  - Glow is a text shadow on the chrome's text only. xterm's WebGL canvas is
    opaque, so a `drop-shadow` on it outlined the whole canvas.
- Config version 3 moves the old `theme` overrides and `sidebar` into
  `appearance` (theme, overrides, layout, saved layouts, panelsHidden).
  - Fields are read one by one, so an older file's sidebar becomes the user's
    copy of the Classic layout.
  - The first rewrite of an older file keeps it as `config.v2.json`.
  - The chrome is the only writer of `appearance`. View menu choices go to the
    chrome over IPC; main follows the saved value for the menu checkmarks,
    widget injection, and the window background.
- Layouts (`src/shared/frame.ts`, `layouts.ts`, `src/renderer/src/frame/`,
  documented in `docs/layouts.md`):
  - The window is a tree of splits, tabs, and panels, drawn as nested
    flexboxes. Built in: Classic (the old window) and Cockpit (banner and
    clock on top, Activity left, sessions, System, and widgets right).
  - Dragging, folding, and switching a group between stacked and tabs save a
    copy of the layout; Reset Layout drops it. `readFrame` repairs hand-written
    trees and always keeps one workspace, one tab bar, and a group for
    unplaced widgets. Cmd+B (still the `toggleSidebar` action) hides every
    panel but those two.
  - The terminals and every widget iframe render once, in a fixed order, in a
    layer placed over empty slots in the tree with CSS anchor positioning
    (Chromium has it; no JS sync needed). A layout change, a hand reorder of
    widgets, or switching stacked and tabs therefore remounts no terminal and
    reloads no widget. React moves reordered keyed siblings with
    `insertBefore`, which reloads an iframe; the old sidebar did that when
    widgets were reordered in config.json. The widget host now looks up each
    iframe's window per message instead of keeping it from registration.
- New panels: Clock, Image (a file in `~/.cockpit/images/`, with
  extensionless names tried as .gif, .png, and so on; reloads on edit), and
  System. System shows CPU from `os.cpus()` deltas, memory used counted like
  Activity Monitor (anonymous minus purgeable, plus wired and compressed, from
  `vm_stat`), load, and uptime, sampled every 2 s only while a System panel is
  visible.
- Verified in the built app with scratch COCKPIT_HOMEs:
  - All three themes. A user theme extending Amber, with a stylesheet whose
    relative `url()` loads an SVG, and live edits reaching the chrome and the
    widgets.
  - Asset requests refused for a symlink out of the folder, a `.json`, `%2e%2e`
    traversal, an unknown theme, and from inside a widget.
  - Both layouts. The banner GIF, the clock, and System numbers that match
    `vm_stat`.
  - A shell's screen and a marker inside a widget's frame surviving layout
    switches, stacked ↔ tabs, and a hand reorder in config.json. Widgets still
    answered calls afterwards.
  - Divider drags (including the banner against the tab bar) saved and
    restored after relaunch.
  - A content-sized widget's slot following its reported height. Visibility
    events on fold.
  - A secret prompt waiting while its widget was folded.
  - Cmd+B hiding panels and giving the terminal the keyboard.
  - A hand edit switching the layout live. Kids mode keeping its menu through
    an appearance change.
  - A v2 config with sidebar settings opening as the same Classic window.
  - Dev mode with no CSP errors.
- Not done: dragging panels between places (layouts are rearranged in
  config.json), and dropping the traffic-light inset in full screen.
- Tests: theme resolution and folders, asset paths, the frame tree (repairs,
  idempotence, widget placement, visibility, edges, drags, mode switching),
  migration of the v2 sidebar, cell sizing, and vm_stat parsing (328 total).

Next: M5 (optional).
