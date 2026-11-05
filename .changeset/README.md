# Changesets

Each file here describes one change for the next release's notes. A pull
request that changes the app (anything under `src/` or `resources/`, the
dependencies, or the build and packaging config) needs one; CI fails without
it. Add one with:

```sh
bun run changeset
```

Pick `patch` for a fix, `minor` for a new feature, or `major` for a change
that breaks existing config or widgets, then write a line or two for the
release notes. Write it for someone using Cockpit, saying what changed for
them. Commit the file it creates with the rest of the PR.

A change that doesn't need a release note can take an empty changeset:
`bun run changeset --empty`.

When changesets land on `main`, the `release` workflow opens a "Version
Packages" pull request that bumps the version and writes `CHANGELOG.md`.
Merging it cuts the release. See [Releases](../README.md#releases) in the
README.
