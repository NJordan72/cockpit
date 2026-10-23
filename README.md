# Cockpit

A personal macOS app for running Claude Code and Codex side by side: a
terminal host with tabs, splits, presets, and panels of sandboxed widgets,
arranged by a layout and styled by a theme.
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
and preset. Drag a tab along the tab bar to move it.

The layout (tabs, splits, sizes, each pane's preset and directory) is saved to
`~/.cockpit/config.json`, and the start screen offers to restore it on
relaunch. Processes and scrollback are not restored; each pane starts its
preset fresh in the directory it was last in. When a pane's process exits, the
pane shows the exit status; press `Enter` to restart it.

A pane can also show a web page: Cmd+L (or Web in the toolbar) takes a URL, a
bare host (`example.com`, `localhost:5173`), or a file path
(`/Users/me/deck/dist/index.html`). The pane has back, forward, reload, an
address field, and ↗ to open the page in your browser. Pages run sandboxed
with no access to Cockpit, keep their cookies in their own partition, open
new windows in the browser, and are reopened on restore at the page they were
on. Cmd+R reloads the focused page. The Cmd+T picker's Web option lists the 20
pages most recently loaded in web panes; type to filter them, or type a new
address.

| Key (default)       | Action                                     |
| ------------------- | ------------------------------------------ |
| Cmd+T               | New tab (picker)                           |
| Cmd+Shift+T         | New shell tab, no agent, in the same dir   |
| Cmd+L               | Open a web page (new tab, or ⇧⏎ to split)  |
| Cmd+R               | Reload the focused web page                |
| Cmd+D / Cmd+Shift+D | Split right / down (picker)                |
| Cmd+W               | Close pane (last pane: tab)                |
| Cmd+Shift+Backspace | Clear pane: restart its preset fresh       |
| Cmd+Shift+R         | Resume: pick an old session for the pane   |
| Cmd+Alt+Arrow       | Move focus between panes                   |
| Cmd+Shift+] / [     | Next / previous tab                        |
| Cmd+1 … Cmd+9       | Go to tab                                  |
| Cmd+B               | Hide or show every panel but the terminals |

The toolbar along the bottom of the window shows the focused pane: its status,
preset (or Claude Code's name for the conversation), directory, and git branch
with commits ahead and behind and the number of changed files. Its buttons open
a new tab, a plain shell tab (no agent) in the focused pane's directory, split right or down, clear the pane, and hide or show the panels, and its menu
switches layouts. Clear ends the pane's process and starts its preset again in
the same directory, with a new terminal and an empty status, activity log, and
file list; the old conversation stays in Claude Code's or Codex's own history.
Resume does the same, but starts the agent at its own list of past sessions
in that directory (`claude --resume`, `codex resume`) so you can pick one up again.
Hover a button to see its shortcut. The toolbar stays put
when Cmd+B hides the panels, so the Panels button can bring them back.

## Agent awareness

Every pane has a status: **idle**, **working**, **needs input**, **done**
(finished a turn you haven't looked at), or **exited**. A tab shows a dot for
the most urgent status among its panes (idle gets none), and the **Sessions**
panel shows every pane with its status, Claude Code's
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

A dialog counts as answered when you press Enter, Esc, or a number key (which
picks that option in Claude Code's dialogs), and a reminder Claude sends after
you answered doesn't bring needs input back.

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
  a second after the agent does something, every 10 seconds while the panel
  shows, and when the window comes forward.

Claude Code panes fill every tab, from the same hooks that drive their status
plus SubagentStart and SubagentStop. Codex panes log the start and end of each
turn and its approval requests, which is all Codex reports through the
terminal, so their Files and Agents tabs stay empty. Shell panes only have
Git. The log is kept in memory, never written to disk, and never shown to
widgets. Each pane keeps its newest 1,000 entries until the pane closes or
Cockpit quits.

Drag the line under the panel to resize it, or fold it with ▾. Its size, tab,
and folded state are saved with the layout (see [Themes and
layouts](#themes-and-layouts)). When no widget below it takes up height, the
panel fills its column.

Right-click a line in the Log for what you can do with it:

- A Bash call: **Copy command** copies the whole command. **Run in a new
  terminal** opens a Shell tab in the directory Claude ran it in and runs it
  there, as if you had pasted it at the prompt. If that directory is gone, the
  tab says so and runs nothing.
- One of your prompts: save it as a slash command (see below), or copy it.

## Pull requests and commands

Two panels share a tab group under Activity.

**Pull requests** lists the open pull requests of the focused pane's
repository, read with `gh pr list` every minute while it shows, so it uses your
own `gh` login. The dot is the checks (green passing, yellow running, red
failing), and the second line shows the author, draft, review state, and age.
**All**, **Mine**, **To review** (you're a requested reviewer), **Others**,
and **Bots** (authors gh marks as bots, or with `[bot]` or `app/` in the
name) filter it. Click a pull request to open it on GitHub. Right-click it to
run a skill on it, in a new agent tab or in the focused pane: Review
(`/review-pr`), Prep review, Propose ship, Approve ship, or Ship. Each gets
the PR's URL. The list is in `PR_ACTIONS` in `src/shared/prs.ts`.

**Commands** lists Claude Code slash commands from the repository's
`.claude/commands/` and from `~/.claude/commands/`. Click one to run it in the
focused pane (or in a new tab, when the focused pane runs no agent);
right-click for more. **+ Save a prompt** offers the focused pane's last dozen
prompts. Saving opens a form for the name, an optional description (shown in
Claude's `/` menu), the prompt itself, and where it goes: everywhere or just
this repository. Cockpit writes an ordinary command file, so the command also
works in Claude Code outside Cockpit. The Activity log keeps the first 4,000
characters of a prompt, so a longer one is saved cut short.

A new agent tab opens in the focused pane's directory with its preset when
that pane runs an agent, and with the first Claude Code preset otherwise. It
starts with the prompt already sent. Sending to an existing pane pastes the
prompt and presses Enter.

These panels came after the built-in layouts were saved, so a layout you've
changed doesn't have them until View > Reset Layout (or until you add them by
hand; see [docs/layouts.md](docs/layouts.md)).

## Widgets

Widgets are small HTML pages, each in its own sandboxed iframe, that reach the network, secrets, and storage only through an
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
[its README](examples/widgets/shortcut-stories/README.md). Right-click a story
to run `/start-story` on it in a new agent tab or in any open agent pane.

New widgets go into the layout's Widgets group, stacked by default. Each one
collapses from its header, and the line between two widgets drags to resize
them. The button at the right of the group's title switches it to one widget
per tab. All of that is saved with the layout, and a layout can put any
widget somewhere else.

Writing a widget, the manifest, and the full API: [docs/widgets.md](docs/widgets.md).

## Themes and layouts

View > Theme switches between themes: Midnight (the default), Amber (cream
and amber on black, with CRT scanlines), Paper (light), and any in
`~/.cockpit/themes/`. A theme sets colors, fonts, corners, panel spacing, and
the terminal's palette, and can bring a stylesheet, images, and fonts of its
own. [docs/themes.md](docs/themes.md) explains how to make one.

View > Layout arranges the window:

- **Classic**: the tab bar across the top, the terminals, and on the right
  Sessions, Activity, and widgets.
- **Cockpit**: an image banner and a clock across the top, Activity on the
  left, and Sessions, a System monitor, and widgets on the right.

Every line between two panels drags, and panels in a column fold from their
title. Changes are saved as your own copy of that layout; View > Layout >
Reset Layout goes back to the built-in one. Layouts can also be written in
`config.json`, from these panels: the terminals, the tab bar, Sessions,
Activity, any widget, a clock, an image or GIF from `~/.cockpit/images/`, and
a System monitor (CPU, memory, load, uptime). Hand edits apply while Cockpit
runs, and terminals and widgets keep running when the layout changes.
[docs/layouts.md](docs/layouts.md) has the format.

View > Open Cockpit Folder opens `~/.cockpit` in Finder.

## Kids mode

Kids mode turns the window into a pretend terminal for a small child who wants
to work like you. Press Cmd+Shift+K or choose View > Kids Mode. The window goes
full screen in macOS kiosk mode, and a terminal in your font and colors takes
the terminals' place, with a welcome box and a `>` prompt. It has its own tab in
the tab bar. The rest of the window stays on screen but can't be clicked.

What the keys do:

- A letter shows big in the middle of the terminal, appears at the prompt in a
  random color, and brings out a character for that letter (B is a bear 🐻).
  The character walks, jumps, spins, dances, floats up, or zooms. After a
  pause in typing, a voice says "B is for bear".
- A digit shows that many of one character in a row, so 3 shows three of them
  to count. 0 shows ten.
- Enter submits the line. A spinner like Claude Code's runs for a second or two
  (`✻ Giggling…`), then the answer lists what was typed and those characters
  parade across the screen. A full line submits by itself.
- Space sends a character walking across, Backspace deletes, and other keys
  make sparkles. A click brings out a character where the pointer is.

Every key also plays a note. With `"sound": "songs"` (the default), each key
plays the next note of a nursery rhyme, so mashing keys plays Twinkle Twinkle,
then Mary Had a Little Lamb, Old MacDonald, Row Row Row Your Boat, and Itsy
Bitsy Spider. With `"notes"`, each key has its own note on a pentatonic scale,
rising from left to right like a xylophone.

To leave, type the exit word, `grownup` unless you change it. It's printed
small at the right end of the tab bar.

### Favorite characters

Put image files (PNG, JPEG, GIF, WebP, AVIF, or SVG) in `~/.cockpit/kids/`.
The file name is the character's name, and its first letter is the key that
brings it out. With `bluey.png` there, B brings out Bluey instead of the bear,
the voice says "B is for Bluey", and the answer line names Bluey. Animated GIFs
play. Space, digits, clicks, and empty-line parades pick from your pictures
most of the time. The folder is read each time kids mode starts, and files over
8 MB are skipped.

### What stays safe

Your panes keep running behind it. While kids mode is on:

- The main process drops all input to PTYs, so nothing typed reaches Claude
  Code, Codex, or a shell, even if a key got past kids mode.
- Kiosk mode turns off Cmd+Tab, force quit, hiding, and the Dock. The menu is
  replaced by one with no shortcuts, so Cmd+Q, Cmd+H, and Cmd+M do nothing, and
  Cockpit ignores its own shortcuts such as Cmd+W and Cmd+T.
- Panels and widgets stay on screen and keep updating, but they can't be
  clicked or focused, and a widget's secret prompt waits until you leave.
- Notifications aren't shown. A pane that finished or asked for permission
  meanwhile still has its badge when you leave.

Keys that macOS handles itself still work in kiosk mode, such as the volume
and brightness keys, Spotlight, and the power button. Kiosk mode covers only
the display the window is on.

### Settings

Under `kids` in `config.json`, read each time kids mode starts:

- `name`: shown in the welcome box ("Welcome, Ava!") and on the tab.
- `exitWord`: 5 to 32 lowercase letters. Anything shorter or invalid falls
  back to `grownup`, since a child mashing keys could type a short word by
  chance.
- `volume`: 0 to 1, for both the notes and the voice.
- `sound`: `songs` or `notes`.
- `speak`: `false` turns the voice off.

The `kidsMode` keybinding changes the shortcut.

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
  "appearance": {
    "theme": "midnight",
    "overrides": { "accent": "#ff9e64" },
    "layout": "classic",
    "layouts": {/* your changed or hand-written layouts */},
    "panelsHidden": false
  },
  "projectsDir": "~/dev",
  "launcher": { "presetId": "claude" },
  "kids": { "name": "", "exitWord": "grownup", "volume": 0.6, "sound": "songs", "speak": true }
}
```

Preset commands run as `$SHELL -l -c <command>`, so they get the PATH from
your login files (`.zprofile`, `.zshenv`), even when Cockpit is started from
the Dock. Keybindings take `Cmd`, `Ctrl`, `Alt`/`Option`, `Shift` plus a key
(`A`–`Z`, `0`–`9`, `F1`–`F20`, `Left`/`Right`/`Up`/`Down`, `Enter`, `Tab`,
`Esc`, `[`, `]`, and other punctuation); an empty string unbinds an action.
`terminal.fontFamily` is a CSS font stack. 0xProto Nerd Font Mono ships with
the app and is the default, and Symbols Nerd Font Mono is added to the end of
every stack, so Nerd Font prompt icons (Starship, Powerlevel10k) show up in
whatever font you pick.
`appearance.theme` picks a theme (also in View > Theme), and
`appearance.overrides` changes single tokens of it (`bg`, `fg`, `accent`,
`radius`, ...); see [docs/themes.md](docs/themes.md). `appearance.layout`
picks a layout, and `appearance.layouts` holds the ones you changed or wrote;
see [docs/layouts.md](docs/layouts.md). A config from before version 3 is kept
as `config.v2.json` when Cockpit first rewrites it; its sidebar settings become
your copy of the Classic layout.
Set `COCKPIT_HOME` to use a different directory than `~/.cockpit`.

## Terminal keys

| Key           | Does                                                      |
| ------------- | --------------------------------------------------------- |
| Shift+Enter   | Newline without submitting (sends ESC CR, like Opt+Enter) |
| Option        | Acts as Meta (Alt+b, Alt+f, ...)                          |
| Cmd+C / Cmd+V | Copy selection / paste (bracketed paste when enabled)     |
| Cmd+K         | Clear the screen and scrollback                           |

Click a URL to open it in the browser. Click a file path (`~/deck/index.html`,
`/etc/hosts`, `src/app.ts:12`, `slides/`) to open it in its default app, or a
folder in Finder. Relative paths resolve against the pane's current directory,
and only paths that exist get underlined.

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
