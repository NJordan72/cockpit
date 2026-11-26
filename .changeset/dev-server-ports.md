---
'cockpit': minor
---

Dev-server and port awareness: Cockpit scans terminal output for local server URLs (`http(s)://localhost:<port>`, `127.0.0.1:<port>`, `[::1]:<port>`) and shows clickable `:port` pills in the toolbar, Sessions, and Tasks panels. Clicking a pill opens (or focuses) a split web pane beside that terminal, and ports shared across different panes or worktrees are highlighted with a collision warning.
