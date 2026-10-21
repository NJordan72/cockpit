# Shortcut Stories

A Cockpit widget that lists your open Shortcut stories, grouped by workflow
state. It calls the Shortcut API itself through `cockpit.fetch`
and keeps the token in `cockpit.secrets`.

## Install

```sh
examples/widgets/install.sh shortcut-stories
```

The script links this folder into `~/.cockpit/widgets/`, so edits here reload
the widget. The first time the widget runs, Cockpit asks for a Shortcut API
token (create one at <https://app.shortcut.com/settings/account/api-tokens>).
Paste it once; Cockpit keeps it encrypted and the widget reads it from then on.

## Using it

- **Doing / Next / All** filter your stories by state type: started, not
  started, or everything.
- **FE Defined** shows Frontend team stories in Backlog: Defined, in board
  order, whoever owns them. It runs its own search
  (`team:frontend state:"Backlog: Defined" !is:archived`), so the gear's query
  doesn't affect it. To add or change tabs like this, edit `FEEDS` in
  `shortcut.js`.
- **Search** appears when you type in the search box. The text runs as a
  Shortcut search across every story you can see, not just the ones in the
  other tabs, and the first 25 results are grouped by state like the rest.
  Search operators and `{me}` work as in the gear's query. Archived stories
  are left out unless the text mentions `is:archived`. The search runs once
  you pause typing, or at once on Enter, and Escape clears it and goes back
  to the tab you were on.
- Click a story to open it in your browser. The ▸ on the right of a row shows
  its full title, type, and when it was last updated, without opening it.
- The gear edits the Shortcut search query, and Enter (or save) applies it
  right away. `{me}` expands to your mention name, because `owner:me` returns
  nothing through the API. The default is
  `owner:{me} !is:done !is:archived !is:backlog`.
- The dot next to the sync age is green when the last sync is under 5 minutes
  old, yellow when it's older, and red when the last sync failed. On failure
  the widget keeps showing the last good data. Click the age to sync now.
- If Shortcut rejects the token, the widget stops polling and offers a button
  to enter a new one.

At most 50 stories are fetched for your query and 250 for each `FEEDS` tab.
The header count is Shortcut's total for the selected tab's query.

## Polling

The widget syncs every 60 seconds while it's visible. While it's collapsed, in
a background sidebar tab, hidden with the sidebar, or the window is minimized,
it syncs every 15 minutes instead, and showing it again syncs at once if the
last sync is more than a minute old. After a failure it waits twice as long
each time, up to 15 minutes, and honors Shortcut's `Retry-After`.

The last result and your tab and query are kept in `cockpit.storage`
(`~/.cockpit/data/shortcut-stories.json`), so a relaunch shows the last stories
immediately.
