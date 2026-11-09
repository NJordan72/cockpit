---
'cockpit': minor
---

Antigravity CLI (`agy`) is the third agent next to Claude Code and Codex. Cockpit sets `AGY_CLI_OSC7501=on` in `agy` panes and reads the OSC 7501 status agy sends, so a pane shows working, needs input (with the command or question), and done, with notifications and Activity log entries. Resume continues the folder's latest conversation (`agy --continue`), a first prompt starts the session with `--prompt-interactive`, and the start screen counts folders agy last ran in. New configs get an Antigravity CLI preset; an existing `config.json` keeps its presets, so add `{ "id": "agy", "name": "Antigravity CLI", "command": "agy", "cwd": "~/dev" }` to `presets` to get one.
