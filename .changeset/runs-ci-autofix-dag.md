---
'cockpit': minor
---

Autonomous Runs: add an optional `autoFixCi` flag on Runs (off by default, toggleable in the Run confirmation dialog and run menu, persisted in `~/.cockpit/runs/<id>.json`) that fetches failing GitHub Actions log tails for `In review` items and sends them to the item's worktree agent (capped at 2 attempts per PR head commit SHA), plus a compact **List** / **Graph** dependency DAG toggle in `RunDialog` and `RunsPanel` with topological tiers, dependency edges, and live phase colors.
