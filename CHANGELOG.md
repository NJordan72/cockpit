# cockpit

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
