## What and why

<!--
What this PR changes and the problem it solves, in two or three sentences.
Then point the reviewer at where to start: the file or function the change
centers on, and what else it touches.
-->

## How it was tested

<!--
What was run and what it showed: `bun run verify`, the tests added or
changed, the smoke test, and anything checked by hand in the built app (with
a scratch COCKPIT_HOME, so your own config isn't touched). Then list what
wasn't checked, such as a real agent session, or a button that would have
opened a file or replaced the clipboard. "CI only" is an answer.
-->

## Risks

<!--
What could break, who would see it, and how they'd notice. Check these
three:
- A new default keybinding takes over a user's binding of the same keys on
  any action listed after it in DEFAULT_KEYBINDINGS.
- A config.json change: a new key, a migration, or a version bump.
- Anything that writes or deletes the user's files or git state.
"None: docs only" is an answer.
-->

## Rollback plan

<!--
How to undo this after it merges. Usually that's reverting the merge commit.
Name anything a revert leaves behind: a config.json an older build reads
differently, files written under ~/.cockpit, or a release that already
shipped the change. Taking a released change back out needs a revert with
its own changeset, then a new release.
-->
