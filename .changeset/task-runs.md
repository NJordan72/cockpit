---
'cockpit': minor
---

Runs work through a set of tasks in dependency order. Hand Cockpit a run's items and the items each waits on, from the Shortcut widget's Burn down epic, a widget's `cockpit.runs.submit`, or `cockpit-run submit plan.json` in any pane, and confirm it once in the dialog that lists every item and prompt. Cockpit starts every item that waits on nothing in a task of its own, then each of the rest once its blockers merge, or, in stack mode, once a blocker's pull request is open, on that blocker's branch. The new Runs panel shows each item waiting, working, in review, done, or stuck, with Start now, Mark done, and Retry, and runs survive a restart.
