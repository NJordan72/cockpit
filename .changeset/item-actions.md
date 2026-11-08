---
'cockpit': minor
---

Right-click menus in the Pull requests, Tasks, Runs, and Activity Files panels can send prompts you configure in `config.json`'s `itemActions`. A command fills in the item's fields, so `/propose-ship {number}` on pull request #123 sends `/propose-ship 123`, and a `target` sends it to the focused pane's agent, a new agent tab, or the agent in a task's or run item's worktree in one click. `prActions` moves to `itemActions.pr`, and the config version goes from 6 to 7.
