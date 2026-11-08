# Widgets

A widget is a folder of HTML, JavaScript, and CSS with a `widget.json` manifest.
Cockpit shows each widget in a panel of the window's layout, inside a
sandboxed iframe. A widget
reaches the network, secrets, and storage only through the `cockpit` object,
and only as far as its manifest allows.

`examples/widgets/hello/` calls every API below and is a good starting point.

## Installing a widget

Cockpit loads every folder in `~/.cockpit/widgets/`. The folder name is the
widget's id and must match `id` in `widget.json`. A folder can be a symlink;
Cockpit follows it and watches the real folder, so a widget can live in its own
repo:

```sh
ln -s ~/dev/my-widget ~/.cockpit/widgets/my-widget
examples/widgets/install.sh hello    # links an example the same way
```

Symlinks inside a widget's folder are followed only when they point somewhere
inside that folder.

When any file in a widget's folder changes, Cockpit reloads that widget. Files
whose names start with a dot are ignored. A widget that can't be loaded (bad
JSON, a missing entry file, an id that doesn't match the folder) still shows up
in its panel, with the reason in place of the widget.

Where things live:

| Path                                    | Holds                                                                          |
| --------------------------------------- | ------------------------------------------------------------------------------ |
| `~/.cockpit/widgets/<id>/`              | The widget's files                                                             |
| `~/.cockpit/data/<id>.json`             | `cockpit.storage`, one JSON object per widget                                  |
| `~/.cockpit/secrets/<id>/<name>.bin`    | `cockpit.secrets`, encrypted                                                   |
| `~/.cockpit/config.json` → `appearance` | Where each widget sits, folded or not, its size (see [layouts.md](layouts.md)) |

## widget.json

```json
{
  "id": "shortcut-stories",
  "name": "Shortcut Stories",
  "version": "1.0.0",
  "description": "Your open Shortcut stories.",
  "entry": "index.html",
  "sizing": "fill",
  "permissions": {
    "network": ["api.app.shortcut.com"],
    "openExternal": ["https://app.shortcut.com/*"],
    "secrets": ["shortcut-token"],
    "storage": true,
    "sessions": "read"
  }
}
```

| Field         | Required | Meaning                                                                                                                |
| ------------- | -------- | ---------------------------------------------------------------------------------------------------------------------- |
| `id`          | yes      | Lowercase letters, digits, and dashes, starting with a letter (at most 63). Must equal the folder name.                |
| `name`        | yes      | Shown in the widget's panel title and in secret prompts.                                                               |
| `version`     | no       | Shown to the widget as `cockpit.widget.version`. Default `0.0.0`.                                                      |
| `description` | no       | For people reading the manifest.                                                                                       |
| `entry`       | no       | HTML file to load, relative to the folder. Default `index.html`.                                                       |
| `sizing`      | no       | `fill` (default) takes the room its panel gets and scrolls inside. `content` makes the widget as tall as its document. |
| `permissions` | no       | What the widget may do. Anything left out is refused.                                                                  |

Unknown permission names are an error, so a typo like `netwrok` fails loudly
instead of silently granting nothing.

### permissions

**`network`**: hosts `cockpit.fetch` may reach. A bare host means HTTPS on port 443. Write the scheme and port to allow anything else.

| Entry                   | Allows                                                                                     |
| ----------------------- | ------------------------------------------------------------------------------------------ |
| `api.example.com`       | `https://api.example.com/...`                                                              |
| `*.example.com`         | `https://a.example.com/...`, `https://a.b.example.com/...`, but not `https://example.com/` |
| `http://localhost:3000` | `http://localhost:3000/...` only                                                           |

Redirects are followed only while every hop stays on a listed host.

**`openExternal`**: URL patterns `cockpit.openExternal` may open in the
browser. The scheme and host work as for `network`, and the path is required.
In the path, `*` matches anything, including `/` and the query string.
`https://app.shortcut.com/*` allows any page on that host;
`https://example.com/docs/*` allows only pages under `/docs/`.

**`secrets`**: names the widget may read and write, such as `"shortcut-token"`.
Each widget has its own set, so two widgets that both declare `api-token` get
separate values.

**`storage`**: `true` to use `cockpit.storage`.

**`sessions`**: `"read"` to use `cockpit.sessions.list` and `subscribe`.
`"prompt"` allows those too, plus `cockpit.sessions.start` and `send`, which
type into Claude Code or Codex, and `startTask`, which fills in the New task
dialog. An agent can run commands, so give `"prompt"`
only to widgets you trust as much as the terminal.

## What the sandbox allows

The iframe has `sandbox="allow-scripts"` and no `allow-same-origin`, so the
widget runs with an opaque origin. Every widget response carries this CSP
(with the widget's own id):

```
default-src 'none'; script-src cockpit-widget://<id> 'unsafe-inline';
style-src cockpit-widget://<id> 'unsafe-inline'; img-src cockpit-widget://<id> data: blob:;
font-src cockpit-widget://<id> data:; media-src cockpit-widget://<id> data: blob:;
worker-src cockpit-widget://<id> blob:; connect-src 'none'; frame-src 'none';
form-action 'none'; base-uri 'none'; object-src 'none'
```

In practice:

- Scripts, styles, fonts, and images load from the widget's own folder, or
  inline. Module scripts (`<script type="module">`) work.
- Nothing loads from the network. `fetch`, `XMLHttpRequest`, WebSockets,
  remote images, and remote fonts are all blocked. Use `cockpit.fetch`.
- WebRTC connects nowhere. CSP doesn't cover it, so Cockpit sends the
  browser side of the app through a proxy that doesn't exist (the main
  process, where `cockpit.fetch` runs, isn't affected).
- `localStorage`, `sessionStorage`, IndexedDB, and cookies are unavailable
  because the origin is opaque. Use `cockpit.storage`.
- Forms can't be submitted, and pressing Enter in an input doesn't fire
  `submit`. Listen for `keydown` instead.
- `alert`, `confirm`, `prompt`, and `window.open` do nothing. Use
  `cockpit.openExternal` for links.
- The widget can't navigate its frame to a web page. Cockpit cancels any frame
  load that isn't a `cockpit-widget://` URL.
- Camera, microphone, notifications, and other browser permissions are denied.

App shortcuts (Cmd+T, Cmd+1, and the rest) still work while a widget has
keyboard focus.

The sandbox keeps a widget from reaching anything its manifest doesn't list.
It isn't a guarantee against every side channel a browser engine has, so
install widgets you trust not to be hostile.

## The `cockpit` API

Cockpit injects `/cockpit-widget.js` ahead of the widget's own scripts, and
that script defines `window.cockpit`. Every call returns a promise. A call that
fails rejects with a `cockpit.CockpitError`, which has a `code` and a message
saying what to change:

```js
try {
  await cockpit.fetch('https://example.org/')
} catch (err) {
  err.code // 'permission_denied'
  err.message // 'fetch to https://example.org is not allowed. Add "example.org" to permissions.network in widget.json (it lists: example.com).'
}
```

| `code`              | When                                                                   |
| ------------------- | ---------------------------------------------------------------------- |
| `permission_denied` | The manifest doesn't allow the call.                                   |
| `invalid_argument`  | A bad URL, key, method, header, or value.                              |
| `cancelled`         | The user dismissed a secret prompt.                                    |
| `timeout`           | The call or the HTTP request took too long.                            |
| `network_error`     | The HTTP request failed (DNS, refused connection, too many redirects). |
| `too_large`         | A response over 10 MB, or storage over 5 MB.                           |
| `unavailable`       | Secret storage can't reach the Keychain.                               |
| `not_found`         | The widget is no longer loaded.                                        |
| `internal`          | Anything else.                                                         |

### cockpit.ready and cockpit.widget

`await cockpit.ready` resolves once the host has sent the widget its details,
theme, and visibility. Calls don't need to wait for it, but
`cockpit.visibility.visible` and `cockpit.theme.vars` are only accurate after
it. `cockpit.widget` is `{ id, name, version, sizing }`, or `null` before ready.

### cockpit.fetch(url, init?)

Makes an HTTP request from the main process, so CORS doesn't apply. The host
must be listed in `permissions.network`.

`init` takes `method`, `headers` (an object, a list of pairs, or a `Headers`),
`body` (a string or `URLSearchParams`), and `timeoutMs` (default 30 000, at most
120 000). The result has `ok`, `status`, `statusText`, `headers` (lowercase
names), `body` (the response as text), `url` (after redirects), `redirected`,
and `json()`, which parses `body`.

```js
const res = await cockpit.fetch('https://api.app.shortcut.com/api/v3/member', {
  headers: { 'Shortcut-Token': token }
})
if (!res.ok) throw new Error(`Shortcut said ${res.status}`)
const me = res.json()
```

Non-2xx responses resolve normally; check `res.ok`. No cookies are sent or
kept.

### cockpit.storage

Backed by `~/.cockpit/data/<id>.json`. Values are anything JSON can hold.

```js
await cockpit.storage.set('prefs', { view: 'doing' })
await cockpit.storage.get('prefs') // { view: 'doing' }
await cockpit.storage.keys() // ['prefs']
await cockpit.storage.set('prefs', undefined) // removes the key

const stop = cockpit.storage.subscribe(({ key, value }) => {
  // runs for every change, including this widget's own sets
})
```

Edits to the data file made by anything else, such as a script or an editor,
reach `subscribe` too.

### cockpit.secrets

Values are encrypted with Electron's `safeStorage`, which keeps its key in the
macOS Keychain.

- `get(name)` resolves with the stored value. If there is none, Cockpit shows
  its own prompt over the window asking the user for it, stores what they type,
  and resolves with that. If the user cancels, `get` rejects with `cancelled`.
  The widget can trigger the prompt but never draws it, and `get` waits for as
  long as the prompt stays open.
- The prompt only appears while the widget is visible. A hidden widget's
  prompt waits until the widget is shown.
- For 10 seconds after the user cancels a prompt, that widget's `get` calls
  that would prompt reject with `cancelled` straight away, so a widget can't
  ask in a loop.
- `get(name, { prompt: false })` resolves with `null` instead of prompting.
- `set(name, value)` stores a value the widget got some other way.
- `delete(name)` removes it, so the next `get` prompts again. Use this when a
  service rejects a token.

### cockpit.openExternal(url)

Opens the URL in the default browser if it matches a pattern in
`permissions.openExternal`.

### cockpit.sessions

`list()` resolves with one entry per terminal pane, in tab order;
`subscribe(cb)` calls `cb` with the full list whenever it changes.

With `"sessions": "prompt"`:

- `start(prompt)` opens a new agent tab in the focused pane's directory that
  starts with `prompt`. It uses the focused pane's preset if that runs an
  agent, and otherwise the first Claude Code preset.
- `send(id, prompt)` pastes `prompt` into the pane `id` and presses Enter. It
  rejects with `invalid_argument` if that pane isn't running Claude Code or
  Codex.
- `startTask(prompt, branch)` opens Cockpit's New task dialog with the branch
  and the first prompt filled in, suggesting the focused pane's repository
  (see "Tasks" in the README). It resolves once the dialog is up. The
  worktree is made, and the agent started, only when the user confirms there,
  and they can change any of it first. A branch over 200 characters or a
  prompt over 20,000 rejects with `invalid_argument`.

```js
await cockpit.sessions.start('Work on Shortcut story sc-1234')
await cockpit.sessions.startTask('/start-story sc-1234', 'nick/sc-1234/fix-the-login')
```

```js
{
  id: 'pane-c233f1a8',    // pane id
  tabId: 'tab-609af0a0',
  presetId: 'claude',
  name: 'Claude Code',    // preset name
  cwd: '~/dev/cockpit',
  status: 'needs-input',
  since: 1760703361000,   // when status last changed (ms since the epoch)
  agent: 'claude',        // 'claude', 'codex', or null for anything else
  title: 'Fix the login redirect', // Claude Code's name for the conversation, or null
  tokens: 48213,          // tokens in Claude Code's context after the last turn, or null
  focused: true           // the focused pane of the active tab
}
```

| `status`      | Means                                                                                 |
| ------------- | ------------------------------------------------------------------------------------- |
| `idle`        | Nothing running, or an agent waiting for the next prompt.                             |
| `working`     | An agent is on a turn, or a program keeps printing.                                   |
| `needs-input` | An agent is blocked on the user: a permission prompt, an approval, a question.        |
| `done`        | An agent finished a turn nobody has looked at yet. Focusing the pane makes it `idle`. |
| `exited`      | The pane's process has ended.                                                         |

Claude Code and Codex panes report through hooks and terminal events, so all
five statuses apply to them. Any other program only gets `idle`, `working`,
and `exited`, from how recently it printed. What an agent is waiting for
isn't shared with widgets, since it can quote the command it wants to run. See "Agent awareness" in the
README for how each agent is followed.

### cockpit.theme

The theme is a set of CSS variables, already set on the widget's `:root` before
its first paint:

| Variable                                                        | Use                                      |
| --------------------------------------------------------------- | ---------------------------------------- |
| `--bg`, `--bg-raised`, `--bg-hover`                             | Backgrounds                              |
| `--fg`, `--muted`                                               | Text                                     |
| `--border`, `--accent`, `--accent-fg`, `--danger`               | Lines and highlights; text on the accent |
| `--red`, `--green`, `--yellow`, `--blue`, `--magenta`, `--cyan` | The terminal's colors                    |
| `--font-ui`, `--font-mono`, `--font-size`                       | Font stacks and the base UI size         |
| `--header-case`, `--header-tracking`, `--header-weight`         | How the chrome styles section titles     |
| `--radius`, `--color-scheme`                                    | Corner radius; `dark` or `light`         |
| `--scanlines`, `--glow`, `--vignette`                           | The theme's effects, 0 to 1              |

The page also starts with the chrome's background, text color, UI font, and
color scheme. Those defaults have no specificity, so any rule in the widget's
own CSS replaces them. The chrome draws scanlines and vignettes over widgets
itself; a widget that wants to glow can use `--glow`.

`cockpit.theme.vars` holds the current values, and
`cockpit.theme.subscribe(cb)` runs when they change: when the user picks
another theme, edits one, or changes `appearance.overrides` in `config.json`.
See [themes.md](themes.md).

### cockpit.visibility

`cockpit.visibility.visible` is `false` while the widget is collapsed, in a
background tab, or hidden with the other panels (Cmd+B), and while the
window is minimized. `subscribe(cb)` calls `cb({ visible })` when it changes.
Use it to stop polling while nobody can see the widget.

## A minimal widget

`~/.cockpit/widgets/clock/widget.json`:

```json
{ "id": "clock", "name": "Clock", "sizing": "content" }
```

`~/.cockpit/widgets/clock/index.html`:

```html
<!doctype html>
<body style="margin: 8px; color: var(--fg); font: 24px var(--font-mono)">
  <span id="t"></span>
  <script>
    const tick = () => (document.getElementById('t').textContent = new Date().toLocaleTimeString())
    let timer = setInterval(tick, 1000)
    cockpit.visibility.subscribe(({ visible }) => {
      clearInterval(timer)
      if (visible) timer = setInterval(tick, 1000)
    })
    tick()
  </script>
</body>
```

## How calls travel

The SDK sends each call to the chrome window with `postMessage`. The chrome
identifies the calling widget by the window the message came from, never by
anything in the message, and forwards the call to the main process over IPC.
The main process checks the call against that widget's manifest, runs it, and
sends the result back the same way. Each call has an id and a timeout on the
widget side (10 s for most calls, 130 s for `fetch`, none for `secrets.get`).
