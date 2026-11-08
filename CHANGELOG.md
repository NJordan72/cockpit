# cockpit

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
