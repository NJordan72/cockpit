---
'cockpit': minor
---

Smart session continuity: Cockpit now captures each Claude Code pane's `session_id` from hooks and persists it on the pane in `config.json`. On the start screen, **Restore & resume** appears next to **Restore last session** whenever saved agent panes exist, resuming each agent's previous conversation (`claude --resume <id>`, `codex resume --last`, `agy --continue`) and falling back cleanly to a fresh session if a conversation no longer exists. In the Runs panel, clicking a **No agent running** item resumes its last session in that worktree (and the right-click menu offers both **Resume last session** and **Open fresh session**).
