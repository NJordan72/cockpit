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

## Keys

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
commands on stdin (`launch`, `type`, `press`, `screen`, `ss`, `resize`,
`clipboard`, `eval`, `quit`). It's how the milestones get checked without
clicking around:

```sh
bun run build && node scripts/drive.mjs
driver> launch
driver> type echo hi
driver> press Enter
driver> screen
```

Screenshots go to `out/shots/`.
