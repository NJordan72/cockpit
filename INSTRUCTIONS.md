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

Next: M3.
