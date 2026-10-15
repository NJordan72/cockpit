# Cockpit

A personal macOS app for running Claude Code and Codex side by side: a
terminal host with (soon) tabs, splits, agent status, and a sandboxed widget
sidebar. See `INSTRUCTIONS.md` for the build plan and current status.

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

The window opens a login shell (`$SHELL -l`), so `claude`, `codex`, and
anything else on your login PATH work as usual.

## Tabs, splits, presets

`Cmd+T` opens a picker: choose a preset with `Tab` (Shell, Claude Code, Codex
by default), pick a directory (the current pane's, recent ones, then
subdirectories of `~/dev` by last change), and press `Enter`. Type to filter,
or type a path starting with `~` or `/`. Split keys open the same picker,
starting in the focused pane's directory and preset.

The layout (tabs, splits, sizes, each pane's preset and directory) is saved to
`~/.cockpit/config.json` and restored on relaunch. Processes and scrollback are
not restored; each pane starts its preset fresh in the directory it was last
in. When a pane's process exits, the pane shows the exit status; press `Enter`
to restart it.

| Key (default)       | Action                      |
| ------------------- | --------------------------- |
| Cmd+T               | New tab (picker)            |
| Cmd+D / Cmd+Shift+D | Split right / down (picker) |
| Cmd+W               | Close pane (last pane: tab) |
| Cmd+Alt+Arrow       | Move focus between panes    |
| Cmd+Shift+] / [     | Next / previous tab         |
| Cmd+1 … Cmd+9       | Go to tab                   |

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
  "projectsDir": "~/dev"
}
```

Preset commands run as `$SHELL -l -c <command>`, so they get the PATH from
your login files (`.zprofile`, `.zshenv`), even when Cockpit is started from
the Dock. Keybindings take `Cmd`, `Ctrl`, `Alt`/`Option`, `Shift` plus a key
(`A`–`Z`, `0`–`9`, `F1`–`F20`, `Left`/`Right`/`Up`/`Down`, `Enter`, `Tab`,
`Esc`, `[`, `]`, and other punctuation); an empty string unbinds an action.
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
commands on stdin (`launch`, `relaunch`, `type`, `press`, `click`, `drag`,
`screen`, `panes`, `layout`, `size`, `ss`, `resize`, `clipboard`, `eval`,
`quit`). It starts the app with a bare, Dock-like environment
(`DRIVE_INHERIT_ENV=1` passes yours through). Point `COCKPIT_HOME` at a scratch
directory to keep your real config out of it:

```sh
bun run build && COCKPIT_HOME=/tmp/cockpit-test node scripts/drive.mjs
driver> launch
driver> type echo hi
driver> press Enter
driver> screen
```

Screenshots go to `out/shots/`.
