# cockpit

## 0.8.1

### Patch Changes

- Enforce `runGit` timeouts directly instead of waiting on `execFile`'s pipe close, so a hung git process or a grandchild holding stdout/stderr open cannot stall status refreshes. ([#104](https://github.com/NJordan72/cockpit/pull/104))

## 0.8.0

### Minor Changes

- Attention queue and quick triage: press Cmd+Shift+U (`nextAttention`) or click the **N waiting** badge in the toolbar to jump to the oldest pane waiting for input across windows and background runs, then done panes, cycling on repeated presses. Waiting panes in the Sessions panel also show inline Approve (Enter), Deny (Esc), Reply, and Focus actions (plus a context menu) so simple prompts can be answered without switching tabs. ([#92](https://github.com/NJordan72/cockpit/pull/92))

- Unified command palette: press `Cmd+P` (or click **⌕ Palette** in the toolbar) to fuzzy-search and jump to any open session, task, run, quick command, slash command, layout, theme, or core app action. Searches everything by default, with optional `>` (commands/actions) and `@` (sessions) prefixes or `Tab` scope cycling. ([#94](https://github.com/NJordan72/cockpit/pull/94))

- Context-window pressure bar and session/task telemetry: the Sessions panel and bottom toolbar now show a compact context-window pressure bar beside token counts (amber at 70%, red at 85% against a 200k default context limit) with one-click **Compact** (`/compact`) and **Fresh** pane actions when pressure is elevated or from the right-click menu. Cockpit also tracks cumulative active working time and tool-call counts per session and rolls them up alongside token counts on Tasks and Runs rows. ([#101](https://github.com/NJordan72/cockpit/pull/101))

- Add cross-agent handoff and side-by-side comparison: ask another agent to review a plan from the plan dialog, right-click selected terminal output to send it to another agent pane or a new split, and compare two agent presets side by side with the same prompt from the toolbar. ([#96](https://github.com/NJordan72/cockpit/pull/96))

- Dev-server and port awareness: Cockpit scans terminal output for local server URLs (`http(s)://localhost:<port>`, `127.0.0.1:<port>`, `[::1]:<port>`) and shows clickable `:port` pills in the toolbar, Sessions, and Tasks panels. Clicking a pill opens (or focuses) a split web pane beside that terminal, and ports shared across different panes or worktrees are highlighted with a collision warning. ([#95](https://github.com/NJordan72/cockpit/pull/95))

- Diff review pane: open a `review` pane from a Tasks row's right-click menu, the Activity panel's Git or Files tabs, or the toolbar (**± Diff** / `Cmd+Shift+G`). It shows the branch's changes since its merge-base with the remote's default branch plus uncommitted and untracked files, collapses large or binary files, lets you click lines (or Shift+click a range) to collect draft comments, and sends all comments to the task's agent (or a chosen agent pane) as one prompt — waiting until idle if the agent is working, and refreshing as files change. ([#100](https://github.com/NJordan72/cockpit/pull/100))

- Autonomous Runs: add an optional `autoFixCi` flag on Runs (off by default, toggleable in the Run confirmation dialog and run menu, persisted in `~/.cockpit/runs/<id>.json`) that fetches failing GitHub Actions log tails for `In review` items and sends them to the item's worktree agent (capped at 2 attempts per PR head commit SHA), plus a compact **List** / **Graph** dependency DAG toggle in `RunDialog` and `RunsPanel` with topological tiers, dependency edges, and live phase colors. ([#99](https://github.com/NJordan72/cockpit/pull/99))

- Smart session continuity: Cockpit now captures each Claude Code pane's `session_id` from hooks and persists it on the pane in `config.json`. On the start screen, **Restore & resume** appears next to **Restore last session** whenever saved agent panes exist, resuming each agent's previous conversation (`claude --resume <id>`, `codex resume --last`, `agy --continue`) and falling back cleanly to a fresh session if a conversation no longer exists. In the Runs panel, clicking a **No agent running** item resumes its last session in that worktree (and the right-click menu offers both **Resume last session** and **Open fresh session**). ([#98](https://github.com/NJordan72/cockpit/pull/98))

- Add an in-app Settings dialog (`Cmd+,` or **Cockpit > Settings…**) for editing General/Editor/Terminal settings, Presets, Quick Commands, Item Actions, per-repo Tasks setup, and Keybindings, plus auto-detection of untracked `.env*` files and package lockfiles when creating a task in a repository without a `tasks` entry yet. ([#97](https://github.com/NJordan72/cockpit/pull/97))

- Terminal search and Activity log filtering: press Cmd+F (configurable as `findInPane`) to open a floating find bar in any terminal pane with Enter/Cmd+G for next match, Shift+Enter/Cmd+Shift+G for previous match, Esc to close, case-sensitive and regex toggles, and a live match counter. The Activity panel's Log tab now includes a compact text filter alongside the Events and Tools chips to filter entries by tool name, command, file path, or text. ([#93](https://github.com/NJordan72/cockpit/pull/93))

## 0.7.0

### Minor Changes

- Quick commands: list prompts you run often in `quickCommands` in `config.json`, each with the preset, model, and effort to run it with, and an optional input such as a Slack link. Cmd+Shift+J (or **⚡ Quick** in the toolbar) runs one. By default it runs in the background, in a tab the tab bar leaves out: the Sessions panel lists it under Background, and macOS notifies you when it needs input or finishes, even while Cockpit is focused. Click it to open it as a tab, or dismiss it with ×. ([#78](https://github.com/NJordan72/cockpit/pull/78))

### Patch Changes

- Claude Code no longer flickers while it redraws: every pane, remote panes included, sets `CLAUDE_CODE_FORCE_SYNC_OUTPUT=1`, so Claude uses synchronized output, which Cockpit's terminal supports but Claude doesn't detect on its own. ([#82](https://github.com/NJordan72/cockpit/pull/82))

## 0.6.0

### Minor Changes

- Codex panes follow Codex's OSC 7501 status reports instead of its terminal title and notifications, so Cockpit no longer passes Codex any `-c` settings. Codex keeps its shared background server, and its sessions show up in `codex agents`. Codex doesn't say what it's asking or what it finished with, so its notifications now say only that it's waiting or done. ([#73](https://github.com/NJordan72/cockpit/pull/73))

- The Mac doesn't go to sleep on its own while Cockpit is open, so agents keep working when you step away. The display still turns off on its usual schedule, and closing the lid or choosing Sleep still sleeps. ([#75](https://github.com/NJordan72/cockpit/pull/75))

- Picking a directory in the launcher for a remote preset copies it with rsync into `~/.cockpit/remote/<this Mac's name>` on that machine (`~/dev/app` goes to `~/.cockpit/remote/<name>/dev/app`), then starts the agent in the copy. The copy leaves out what `.gitignore` ignores and files that are newer on the remote machine, and never deletes anything. Restarting the pane or restoring the layout reopens the same remote directory without copying again. ([#74](https://github.com/NJordan72/cockpit/pull/74))

- The System panel shows disk space: how full the volume holding your home folder is, and how much is free. It doesn't count purgeable space, so the free figure can be lower than what Finder shows as available. ([#70](https://github.com/NJordan72/cockpit/pull/70))

### Patch Changes

- The launcher's preset buttons stay on one line. Names no longer wrap, and when the presets don't fit, the row scrolls sideways and keeps the chosen one in view. ([#74](https://github.com/NJordan72/cockpit/pull/74))

## 0.5.0

### Minor Changes

- Antigravity CLI (`agy`) is the third agent next to Claude Code and Codex. Cockpit sets `AGY_CLI_OSC7501=on` in `agy` panes and reads the OSC 7501 status agy sends, so a pane shows working, needs input (with the command or question), and done, with notifications and Activity log entries. Resume continues the folder's latest conversation (`agy --continue`), a first prompt starts the session with `--prompt-interactive`, and the start screen counts folders agy last ran in. New configs get an Antigravity CLI preset; an existing `config.json` keeps its presets, so add `{ "id": "agy", "name": "Antigravity CLI", "command": "agy", "cwd": "~/dev" }` to `presets` to get one. ([#60](https://github.com/NJordan72/cockpit/pull/60))

- Right-click menus in the Pull requests, Tasks, Runs, and Activity Files panels can send prompts you configure in `config.json`'s `itemActions`. A command fills in the item's fields, so `/propose-ship {number}` on pull request [#123](https://github.com/NJordan72/cockpit/issues/123) sends `/propose-ship 123`, and a `target` sends it to the focused pane's agent, a new agent tab, or the agent in a task's or run item's worktree in one click. `prActions` moves to `itemActions.pr`, and the config version goes from 6 to 7. ([#56](https://github.com/NJordan72/cockpit/pull/56))

- Presets can run on another machine. Give one a `host` (an ssh destination, or a `Host` from `~/.ssh/config`) and its command runs there over `ssh -t`, in the preset's `cwd` on that machine, through the remote login shell. Claude Code panes answer Claude's OSC 7501 probe and follow its status from the terminal stream, and Cockpit forwards its event socket with `ssh -R` and passes the hooks inline, so the Activity panel and plans work too where the server allows socket forwarding. Codex and Antigravity CLI report through the terminal as they do locally. Remote panes don't show a branch, PRs, tasks, or Claude's transcript title and token count. ([#65](https://github.com/NJordan72/cockpit/pull/65))

### Patch Changes

- Selecting text in a terminal with the mouse copies it to the clipboard, as in iTerm2. In Claude Code, Codex and Antigravity CLI panes, hold Option while dragging to select. Set `terminal.copyOnSelect` to `false` in `config.json` to copy only with Cmd+C. ([#62](https://github.com/NJordan72/cockpit/pull/62))

- Programs running in a terminal can use the microphone and camera. macOS asks for access for Cockpit the first time, and Cockpit then shows up under Privacy & Security → Microphone and Camera. Before, macOS refused without asking. ([#67](https://github.com/NJordan72/cockpit/pull/67))

## 0.4.0

### Minor Changes

- Cockpit keeps Claude Code's plans. When Claude finishes planning, a Plan button appears in the toolbar; click it or press Cmd+Shift+P to read the plan over the window as formatted Markdown, with whether you approved it and buttons to open the plan file or copy it. Plans stay for the rest of the session, through `/clear`, and a session with several plans can switch between them. ([#23](https://github.com/NJordan72/cockpit/pull/23))

- Click a pull request in the Pull requests panel to open it in a pane of its own instead of on GitHub. The pane shows the review threads with the lines they're about, the comments and reviews, and the checks. Reply to a thread and resolve it, comment, approve or request changes, mark a draft ready, merge, or close, all through your own `gh` login, and Cockpit asks before merging or closing. **→ Agent** sends a thread, a comment, a review, or a failing check (with the end of its log) to an agent: the one working in the pull request's task, a new task on its branch, or any other agent pane. Tick several to send them together. ([#47](https://github.com/NJordan72/cockpit/pull/47))

- A pane whose git branch names a Shortcut story, such as `nick/sc-1234/fix-login`, shows the story in a line at the top of the pane: its number, title, points, workflow state, and owners. Hover the line for the story's type, epic, iteration, labels, deadline, and whether it's blocked, and click it to open the story in Shortcut. It follows the agent: when the agent switches to another story's branch or moves to another worktree, the line changes within a few seconds. The Shortcut widget supplies it, so your token stays with the widget. Widgets now see each session's branch, and a widget with the new `"sessions": "label"` permission can put a line of its own at the top of a pane. ([#48](https://github.com/NJordan72/cockpit/pull/48))

- Runs work through a set of tasks in dependency order. Hand Cockpit a run's items and the items each waits on, from the Shortcut widget's Burn down epic, a widget's `cockpit.runs.submit`, or `cockpit-run submit plan.json` in any pane, and confirm it once in the dialog that lists every item and prompt. Cockpit starts every item that waits on nothing in a task of its own, then each of the rest once its blockers merge, or, in stack mode, once a blocker's pull request is open, on that blocker's branch. The new Runs panel shows each item waiting, working, in review, done, or stuck, with Start now, Mark done, and Retry, and runs survive a restart. ([#54](https://github.com/NJordan72/cockpit/pull/54))

- Tasks give an agent a branch in a git worktree of its own, so several agents can work in one repository without editing the same files. Press Cmd+Shift+N (or click the toolbar's ⎇ Task) to name a branch and pick a repository; Cockpit fetches, makes the worktree under `~/.cockpit/worktrees/`, and opens the agent in it with your first prompt. `tasks` in `config.json` copies files such as `.env` into each new worktree and runs a setup command before the agent starts. A new Tasks panel lists every task with its pull request, uncommitted files, and unpushed commits, and the Sessions list shows a task's branch and pull request. Removing a task asks first when work would be lost, and Clean up merged removes every task whose pull request has merged. In the Shortcut widget, right-click a story and choose Start story in a new task. ([#25](https://github.com/NJordan72/cockpit/pull/25))

## 0.3.1

### Patch Changes

- Terminal text draws at its normal size again. Since 0.2.0, terminals drew letters in a tiny sans-serif font spread across each cell, while box drawing and the cursor looked fine. ([#20](https://github.com/NJordan72/cockpit/pull/20))

## 0.3.0

### Minor Changes

- Cockpit checks for new versions, downloads them in the background, and asks before restarting into one. The dialog says how many terminals a restart would close and which agents are still working. Choose Cockpit > Check for Updates… to check right away. Releases are also signed with a Developer ID and notarized by Apple now, so macOS opens them without the Open Anyway step. Install this version by hand once; the versions after it arrive on their own. ([#17](https://github.com/NJordan72/cockpit/pull/17))

## 0.2.0

### Minor Changes

- Cockpit now comes as a packaged Mac app for Apple silicon. Each release on GitHub has a `.dmg` and a `.zip`, so you no longer have to build it from source. ([#6](https://github.com/NJordan72/cockpit/pull/6))
