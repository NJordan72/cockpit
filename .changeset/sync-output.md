---
'cockpit': patch
---

Claude Code no longer flickers while it redraws: every pane, remote panes included, sets `CLAUDE_CODE_FORCE_SYNC_OUTPUT=1`, so Claude uses synchronized output, which Cockpit's terminal supports but Claude doesn't detect on its own.
