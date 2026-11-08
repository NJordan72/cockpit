# Shortcut Stories

A Cockpit widget that lists your open Shortcut stories, grouped by workflow
state, and starts an agent on one. It calls the Shortcut API itself through
`cockpit.fetch` and keeps your API token in `cockpit.secrets`.

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
- **Tabs of your own** come after those, one for each line in the gear's
  "More tabs" box, written `Label = search`. For example,
  `FE Defined = team:frontend state:"Backlog: Defined" !is:archived` adds an
  **FE Defined** tab with that team's defined stories, whoever owns them. Each
  tab runs its own search and lists its stories in board order, so the gear's
  query for your stories doesn't affect it. Up to 8 tabs.
- **Search** appears when you type in the search box. The text runs as a
  Shortcut search across every story you can see, not just the ones in the
  other tabs, and the first 25 results are grouped by state like the rest.
  Search operators and `{me}` work as in the gear's query. Archived stories
  are left out unless the text mentions `is:archived`. The search runs once
  you pause typing, or at once on Enter, and Escape clears it and goes back
  to the tab you were on.
- **🎰** in the header spins a wheel of the stories in the tab you're on
  (search results included) and starts the one it lands on in a new agent
  session, the same as right-click > Start story. Blocked stories are left off the wheel, so it never picks one,
  and the button is disabled when every story in the tab is blocked. The pick
  is random and made before the wheel spins. The winner
  shows for a moment first, and Escape or × during the spin or that moment
  stops it without starting anything. The panels show story numbers, and the
  title of the one under the pointer shows below the wheel. The wheel clicks
  quietly as it turns, and with Reduce motion on in macOS it lands at once.
- Click a story to open it in your browser. The ▸ on the right of a row shows
  its full title, type, and when it was last updated, without opening it.
- Right-click a story to start it: in a new agent session, in any agent pane
  that's open, or **in a new task**, a branch in a git worktree of its own.
  That opens Cockpit's New task dialog with the start prompt and the story's
  branch filled in: the branch name Shortcut gives the story, or else
  `<your mention name>/sc-<id>/<title>` cut to 50 characters, the way
  Shortcut's own tools make one. Nothing is made until you confirm it there.
- The gear opens the settings, and Enter (or save) applies them right away
  (Cmd+Enter in the tabs box):
  - **Your stories**: the search behind Doing, Next, and All. `{me}` expands
    to your mention name, because `owner:me` returns nothing through the API.
    The default is `owner:{me} !is:done !is:archived !is:backlog`.
  - **More tabs**: see above.
  - **Start story sends**: the prompt that right-click > Start story and the
    wheel send to the agent, and that **Start story in a new task** fills in. `{id}`, `{name}`, and `{url}` are the story's
    number, title, and link. The default is
    `Work on Shortcut story sc-{id}: {name} ({url})`. If you have a skill or
    slash command for picking up a story, put it here, such as
    `/start-story sc-{id}`.
- The dot next to the sync age is green when the last sync is under 5 minutes
  old, yellow when it's older, and red when the last sync failed. On failure
  the widget keeps showing the last good data. Click the age to sync now.
- If Shortcut rejects the token, the widget stops polling and offers a button
  to enter a new one.

At most 50 stories are fetched for your query and 250 for each tab of your own.
The header count is Shortcut's total for the selected tab's query.

## Polling

The widget syncs every 60 seconds while it's visible. While it's collapsed, in
a background sidebar tab, hidden with the sidebar, or the window is minimized,
it syncs every 15 minutes instead, and showing it again syncs at once if the
last sync is more than a minute old. After a failure it waits twice as long
each time, up to 15 minutes, and honors Shortcut's `Retry-After`.

The last result, the tab you were on, and your settings are kept in `cockpit.storage`
(`~/.cockpit/data/shortcut-stories.json`), so a relaunch shows the last stories
immediately.
