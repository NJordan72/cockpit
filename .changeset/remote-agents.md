---
'cockpit': minor
---

Presets can run on another machine. Give one a `host` (an ssh destination, or a `Host` from `~/.ssh/config`) and its command runs there over `ssh -t`, in the preset's `cwd` on that machine, through the remote login shell. Claude Code panes answer Claude's OSC 7501 probe and follow its status from the terminal stream, and Cockpit forwards its event socket with `ssh -R` and passes the hooks inline, so the Activity panel and plans work too where the server allows socket forwarding. Codex and Antigravity CLI report through the terminal as they do locally. Remote panes don't show a branch, PRs, tasks, or Claude's transcript title and token count.
