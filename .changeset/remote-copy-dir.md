---
'cockpit': minor
---

Picking a directory in the launcher for a remote preset copies it with rsync into `~/.cockpit/remote/<this Mac's name>` on that machine (`~/dev/app` goes to `~/.cockpit/remote/<name>/dev/app`), then starts the agent in the copy. The copy leaves out what `.gitignore` ignores and files that are newer on the remote machine, and never deletes anything. Restarting the pane or restoring the layout reopens the same remote directory without copying again.
