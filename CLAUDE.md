# Cockpit

A personal Electron app that hosts Claude Code and Codex in terminals, with a
sandboxed widget sidebar.

Planned work and known gaps are GitHub issues in NJordan72/cockpit. Read the
issue before starting a change, and close it from the pull request. When a
change leaves something unfinished or unchecked, open an issue for it.

The original build plan, with a status note for each feature as it landed,
was `INSTRUCTIONS.md` until #46 removed it. It records what Claude Code and
Codex sent when each feature was built, so read it from git history
(`git show 322e3cd:INSTRUCTIONS.md`) when changing agent awareness, the
Activity panel, plans, or tasks.

Build from public libraries. Don't read, unpack, or copy code or assets from
other apps.

## Working agreements

- Use Conventional Commit messages.
- Keep `README.md` up to date with how to install, run, and add a widget.
- Add tests where they're cheap and catch real bugs: manifest permission
  checks, the URL allowlist matcher, config migration, hook event parsing.
  The terminals themselves get checked by hand.
- If a library or CLI behaves differently from what the code or an issue
  says, trust the current docs and the installed version.
- Say in the pull request how the change was checked and what wasn't, using
  the template's sections.
