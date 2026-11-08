---
'cockpit': minor
---

A pane whose git branch names a Shortcut story, such as `nick/sc-1234/fix-login`, shows the story in a line at the top of the pane: its number, title, points, workflow state, and owners. Hover the line for the story's type, epic, iteration, labels, deadline, and whether it's blocked, and click it to open the story in Shortcut. It follows the agent: when the agent switches to another story's branch or moves to another worktree, the line changes within a few seconds. The Shortcut widget supplies it, so your token stays with the widget. Widgets now see each session's branch, and a widget with the new `"sessions": "label"` permission can put a line of its own at the top of a pane.
