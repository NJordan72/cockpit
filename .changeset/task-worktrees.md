---
'cockpit': minor
---

Tasks give an agent a branch in a git worktree of its own, so several agents can work in one repository without editing the same files. Press Cmd+Shift+N (or click the toolbar's ⎇ Task) to name a branch and pick a repository; Cockpit fetches, makes the worktree under `~/.cockpit/worktrees/`, and opens the agent in it with your first prompt. `tasks` in `config.json` copies files such as `.env` into each new worktree and runs a setup command before the agent starts. A new Tasks panel lists every task with its pull request, uncommitted files, and unpushed commits, and the Sessions list shows a task's branch and pull request. Removing a task asks first when work would be lost, and Clean up merged removes every task whose pull request has merged. In the Shortcut widget, right-click a story and choose Start story in a new task.
