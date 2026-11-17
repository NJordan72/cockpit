---
'cockpit': minor
---

Codex panes follow Codex's OSC 7501 status reports instead of its terminal title and notifications, so Cockpit no longer passes Codex any `-c` settings. Codex keeps its shared background server, and its sessions show up in `codex agents`. Codex doesn't say what it's asking or what it finished with, so its notifications now say only that it's waiting or done.
