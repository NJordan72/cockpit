# Cockpit

A personal macOS app for running Claude Code and Codex side by side: a
terminal host with tabs, splits, presets, and a sidebar of sandboxed widgets.
See `INSTRUCTIONS.md` for the build plan and current status.

## Install

Requires macOS, [bun](https://bun.sh), and Xcode Command Line Tools (for the
`node-pty` native build).

```sh
bun install
```

`postinstall` downloads the Electron binary and rebuilds `node-pty` against
Electron's ABI. If the terminal fails to start after an Electron upgrade, run
`bun run postinstall` again.

## Run

```sh
bun run dev     # electron-vite dev server with hot reload
bun run build   # production build into out/
bun run start   # run the production build
```

Panes run their commands through a login shell (`$SHELL -l`), so `claude`,
`codex`, and anything else on your login PATH work as usual.

## Start screen

Cockpit opens on a list of your projects: the folders in `~/dev`, plus recent
directories elsewhere, most recently used first. "Used" counts a Cockpit pane
started there, and Claude Code or Codex run there from anywhere (Cockpit reads
when each last wrote to its transcripts in `~/.claude/projects/` and its
session logs in `~/.codex/sessions/`). Each row says which agent ran last and
how long ago.

The switch at the top picks the agent (`Tab` flips it), and `Enter` or a click
opens the selected project in a new tab with that agent. The switch remembers
the agent you launched last. Type to filter, or type a path starting with `~`
or `/`. The switch lists every preset with a command (Claude Code and Codex by
default).

If the last session left tabs open, **Restore last session** brings them back
instead. Launching a project starts fresh, and the old layout is gone. Closing
the last tab returns to the start screen.

## Tabs, splits, presets

`Cmd+T` opens a picker: choose a preset with `Tab` (Shell, Claude Code, Codex
by default), pick a directory (the current pane's, then the start screen's
list), and press `Enter`. Type to filter, or type a path starting with `~` or
`/`. Split keys open the same picker, starting in the focused pane's directory
and preset.

The layout (tabs, splits, sizes, each pane's preset and directory) is saved to
`~/.cockpit/config.json`, and the start screen offers to restore it on
relaunch. Processes and scrollback are not restored; each pane starts its
preset fresh in the directory it was last in. When a pane's process exits, the
pane shows the exit status; press `Enter` to restart it.

| Key (default)       | Action                      |
| ------------------- | --------------------------- |
| Cmd+T               | New tab (picker)            |
| Cmd+D / Cmd+Shift+D | Split right / down (picker) |
| Cmd+W               | Close pane (last pane: tab) |
| Cmd+Alt+Arrow       | Move focus between panes    |
| Cmd+Shift+] / [     | Next / previous tab         |
| Cmd+1 … Cmd+9       | Go to tab                   |
| Cmd+B               | Show or hide the sidebar    |

## Agent awareness

Every pane has a status: **idle**, **working**, **needs input**, **done**
(finished a turn you haven't looked at), or **exited**. A tab shows a dot for
the most urgent status among its panes (idle gets none), and the **Sessions**
list at the top of the sidebar shows every pane with its status, Claude Code's
title for the conversation, and how many tokens its context holds. Click a
session to jump to it. When a pane goes to needs input or done while
Cockpit's window isn't focused, macOS shows a notification; clicking it
focuses that pane. The Dock icon's badge counts the panes that need you.

How each kind of pane is followed:

- **Claude Code** (a preset whose command starts with `claude`): Cockpit adds
  `--settings ~/.cockpit/agents/claude-settings.json`, which registers hooks
  (SessionStart, UserPromptSubmit, PreToolUse, PermissionRequest, PostToolUse,
  Notification, Stop, and a few more) that run `~/.cockpit/agents/cockpit-hook`.
  The script sends each hook's payload to a Unix socket under
  `~/.cockpit/run/` and prints nothing, so Claude behaves exactly as before.
  These hooks add to your own; `~/.claude/settings.json` isn't touched.
  Claude holds hooks back in a folder you haven't trusted yet.
- **Codex** (a command starting with `codex`): Cockpit adds `-c` overrides
  that make Codex put its run state in the terminal title and send OSC 9
  notifications when a turn ends or it wants approval, and reads both from the
  pane's output. `~/.codex/config.toml` isn't touched. Any `-c` makes Codex
  run without its shared background server (it says so in a startup warning),
  so these sessions don't show up in `codex agents`.
- **Anything else**: a pane that keeps printing for a second is working, and
  one that has been quiet for a few seconds is idle. Typing and redraws after
  a resize don't count.

Agent awareness needs the preset's command to start with `claude` or `codex`
(optionally after `VAR=value` settings). Running `claude` by hand in a Shell
pane gets the output heuristic only. Interrupting a turn with Esc sends no
hook, so an interrupted Claude turn turns idle once its spinner has been still
for 10 seconds.

Notifications need macOS to allow them for the app. The unsigned development
build (`bun run dev`, `bun run start`) runs as "Electron", which macOS 27
refuses ("UNErrorDomain error 1"); Cockpit then bounces the Dock icon instead
and logs a warning once.

Set `COCKPIT_AGENT_LOG=/path/to/file` to log every agent event and what it
did to the pane's status (event names and statuses only; no payloads or
message text).

## Activity

The **Activity** panel under the Sessions list shows what the focused pane's
agent has been doing. Click a session to switch to it. The panel has four
tabs, each with a count:

- **Log**: one line per event, newest at the bottom. It lists sessions
  starting and ending, your prompts, tool calls with their command or file,
  permission requests, failures, subagents starting and finishing,
  notifications, and finished turns. Calls made inside a subagent are marked
  ↳. Click a line to read all of it, such as a multi-line command or Claude's
  whole reply. **Events** and **Tools** filter the list.
- **Files**: the files Claude read or changed, most recent first, with lines
  added and removed. `A` marks a new file, `M` an edited one, and `R` one that
  was only read.
- **Agents**: the subagents Claude started, with the description Claude gave
  each one, its tool calls, how long it ran, and the first line of its result.
  `bg` marks a subagent that ran in the background.
- **Git**: the branch, how far it is ahead of or behind its upstream, changed
  and untracked files, and the last five commits. Cockpit reads them from the
  directory the agent works in (a shell's current directory, for Shell panes)
  a second after the agent does something, every 10 seconds while the sidebar
  shows, and when the window comes forward.

Claude Code panes fill every tab, from the same hooks that drive their status
plus SubagentStart and SubagentStop. Codex panes log the start and end of each
turn and its approval requests, which is all Codex reports through the
terminal, so their Files and Agents tabs stay empty. Shell panes only have
Git. The log is kept in memory, never written to disk, and never shown to
widgets. Each pane keeps its newest 1,000 entries until the pane closes or
Cockpit quits.

Drag the line under the panel to resize it, or fold it with ▾. Its height,
tab, and folded state are saved in `config.json` under `sidebar.activity`.
When no widget takes up height, the panel fills the sidebar.

## Widgets

The sidebar on the right holds widgets: small HTML pages, each in its own
sandboxed iframe, that reach the network, secrets, and storage only through an
API that checks their manifest. Put a widget folder (or a symlink to one) in
`~/.cockpit/widgets/`; Cockpit picks it up and reloads it whenever its files
change. To install the examples:

```sh
examples/widgets/install.sh                    # all of them
examples/widgets/install.sh shortcut-stories   # just one
```

`hello` calls every API and is the place to start a new widget.
`shortcut-stories` lists your Shortcut stories. The first time it runs,
Cockpit asks for a Shortcut API token and keeps it encrypted; see
[its README](examples/widgets/shortcut-stories/README.md).

Widgets stack by default. Each one collapses from its header, and the line
between two widgets drags to resize them. The button at the top of the
sidebar switches to one widget per tab, and the sidebar's left edge drags to
change its width. All of that is saved in `config.json` under `sidebar`.

Writing a widget, the manifest, and the full API: [docs/widgets.md](docs/widgets.md).

## Config

`~/.cockpit/config.json` is created on first launch with every option filled
in. Edits are picked up while the app runs (keybindings, presets, font).
Invalid values fall back to defaults; a file that isn't valid JSON is copied
to `config.json.broken-<time>` before being replaced.

```jsonc
{
  "presets": [
    { "id": "shell", "name": "Shell", "cwd": "~" },
    { "id": "claude", "name": "Claude Code", "command": "claude", "cwd": "~/dev" },
    { "id": "codex", "name": "Codex", "command": "codex", "cwd": "~/dev" }
  ],
  "keybindings": { "newTab": "Cmd+T", "splitRight": "Cmd+D" /* ... */ },
  "terminal": { "fontFamily": "...", "fontSize": 13 },
  "theme": { "accent": "#ff9e64" },
  "sidebar": {
    "visible": true,
    "width": 320,
    "mode": "stack",
    "activity": { "collapsed": false, "height": 320, "tab": "log" },
    "widgets": [/* ... */]
  },
  "projectsDir": "~/dev",
  "launcher": { "presetId": "claude" }
}
```

Preset commands run as `$SHELL -l -c <command>`, so they get the PATH from
your login files (`.zprofile`, `.zshenv`), even when Cockpit is started from
the Dock. Keybindings take `Cmd`, `Ctrl`, `Alt`/`Option`, `Shift` plus a key
(`A`–`Z`, `0`–`9`, `F1`–`F20`, `Left`/`Right`/`Up`/`Down`, `Enter`, `Tab`,
`Esc`, `[`, `]`, and other punctuation); an empty string unbinds an action.
`theme` overrides any of the app's colors and fonts by name (`bg`, `bgRaised`,
`fg`, `muted`, `border`, `accent`, `red`, `green`, ...; see
`src/shared/theme.ts`). The chrome, the terminals, and widgets all follow it.
Set `COCKPIT_HOME` to use a different directory than `~/.cockpit`.

## Terminal keys

| Key           | Does                                                      |
| ------------- | --------------------------------------------------------- |
| Shift+Enter   | Newline without submitting (sends ESC CR, like Opt+Enter) |
| Option        | Acts as Meta (Alt+b, Alt+f, ...)                          |
| Cmd+C / Cmd+V | Copy selection / paste (bracketed paste when enabled)     |
| Cmd+K         | Clear the screen and scrollback                           |

## Checks

```sh
bun run check   # typecheck + lint + format:check + test
bun run format  # apply Prettier
```

TypeScript runs in strict mode with `noUncheckedIndexedAccess`, and ESLint
uses typescript-eslint's `strictTypeChecked` rules with zero warnings allowed.

## Driving the app from a script

`scripts/drive.mjs` launches the built app through Playwright and takes
commands on stdin (`launch`, `relaunch`, `type`, `press`, `nkey`, `click`,
`drag`, `sleep`, `screen`, `panes`, `launcher`, `layout`, `size`, `ss`, `resize`,
`clipboard`, `eval`, `widgets`, `weval`, `wclick`, `wtext`, `secret`,
`stubopen`, `opened`, `sessions`, `stubnotify`, `watchnotify`, `notes`,
`clicknote`, `badge`, `blur`, `focus`, `focused`, `hide`, `unhide`, `quit`).
The `w` commands act inside a widget's frame, and `secret` answers the host's
secret prompt (`secret $VAR` reads the value from the environment without
printing it). `launcher` prints the start screen's agent and first rows.
`sessions` prints each pane's status. `stubnotify` records
notifications instead of showing them, `watchnotify` records them and shows
them for real (noting whether macOS did), `notes` lists them, and
`clicknote 0` clicks one. `blur` and `hide` take focus away from the window,
the way switching apps does. It starts the app with a bare, Dock-like environment
(`DRIVE_INHERIT_ENV=1` passes yours through; `COCKPIT_HOME` and
`COCKPIT_AGENT_LOG` always pass). Point `COCKPIT_HOME` at a scratch directory
to keep your real config out of it:

```sh
bun run build && COCKPIT_HOME=/tmp/cockpit-test node scripts/drive.mjs
driver> launch
driver> launcher
driver> press Meta+t
driver> press Enter
driver> type echo hi
driver> press Enter
driver> screen
```

The app opens on the start screen; `Meta+t` then `Enter` opens a shell in the
top project. Screenshots go to `out/shots/`.
