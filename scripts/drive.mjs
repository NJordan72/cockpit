// REPL driver for Cockpit. Launches the built app with Playwright's Electron
// support and reads commands from stdin, one per line. Run `bun run build` first.
//
//   node scripts/drive.mjs
//   driver> launch
//   driver> type echo hi
//   driver> press Enter
//   driver> screen main
//
// Wrap it in tmux to drive it from another process.
import { _electron as electron } from 'playwright-core'
import * as readline from 'node:readline'
import * as fs from 'node:fs'
import * as path from 'node:path'

const APP_DIR = path.resolve(import.meta.dirname, '..')
const SHOT_DIR = process.env.SCREENSHOT_DIR ?? path.join(APP_DIR, 'out', 'shots')
fs.mkdirSync(SHOT_DIR, { recursive: true })

let app = null
let page = null

/**
 * The environment a Dock/Finder launch gets: a bare PATH and no terminal or
 * agent-session variables. DRIVE_INHERIT_ENV=1 passes this shell's env instead.
 */
function launchEnv() {
  if (process.env.DRIVE_INHERIT_ENV === '1') return process.env
  const keep = [
    'HOME',
    'USER',
    'LOGNAME',
    'SHELL',
    'TMPDIR',
    'LANG',
    '__CF_USER_TEXT_ENCODING',
    'COCKPIT_HOME',
    'COCKPIT_AGENT_LOG'
  ]
  const env = { PATH: '/usr/bin:/bin:/usr/sbin:/sbin' }
  for (const k of keep) if (process.env[k] !== undefined) env[k] = process.env[k]
  return env
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

function widgetFrame(id) {
  const frame = page.frames().find((f) => f.url().startsWith(`cockpit-widget://${id}/`))
  if (!frame) throw new Error(`no frame for widget ${id}`)
  return frame
}

const COMMANDS = {
  async launch() {
    if (app) return console.log('already launched')
    app = await electron.launch({
      args: [APP_DIR],
      cwd: APP_DIR,
      env: launchEnv(),
      timeout: 30_000
    })
    page = await app.firstWindow()
    // It opens on the start screen, or on terminals once something is open.
    await page.waitForFunction(
      () => (window.__cockpitDebug?.ids().length ?? 0) > 0 || document.querySelector('.launcher'),
      null,
      { timeout: 15_000 }
    )
    console.log('launched:', page.url())
  },

  async ss(name) {
    const f = path.join(SHOT_DIR, (name || `ss-${Date.now()}`) + '.png')
    await page.screenshot({ path: f })
    console.log('screenshot:', f)
  },

  async type(text) {
    await page.keyboard.type(text, { delay: 15 })
  },

  // Playwright key names, e.g. Enter, Shift+Enter, Meta+k, Control+c, Alt+b
  async press(key) {
    await page.keyboard.press(key)
  },

  // A key sent through Electron's input path (sendInputEvent), which, unlike
  // `press`, goes through before-input-event: nkey Meta+t
  async nkey(chord) {
    const parts = chord.split('+')
    const keyCode = parts.pop()
    const modifiers = parts.map((m) => m.toLowerCase())
    await app.evaluate(
      ({ BrowserWindow }, { keyCode, modifiers }) => {
        const wc = BrowserWindow.getAllWindows()[0].webContents
        wc.sendInputEvent({ type: 'keyDown', keyCode, modifiers })
        wc.sendInputEvent({ type: 'keyUp', keyCode, modifiers })
      },
      { keyCode, modifiers }
    )
  },

  // Mouse drag in CSS pixels: drag 640,400 500,400
  async drag(arg) {
    const [[x1, y1], [x2, y2]] = arg.split(' ').map((p) => p.split(',').map(Number))
    await page.mouse.move(x1, y1)
    await page.mouse.down()
    await page.mouse.move(x2, y2, { steps: 8 })
    await page.mouse.up()
  },

  async click(arg) {
    const [x, y] = arg.split(',').map(Number)
    await page.mouse.click(x, y)
  },

  async sleep(ms) {
    await sleep(Number(ms) || 1000)
  },

  // Print the visible text of a pane (default: first pane).
  async screen(id) {
    const text = await page.evaluate((id) => {
      const d = window.__cockpitDebug
      return d.screen(id || d.ids()[0])
    }, id || null)
    console.log('----- screen -----\n' + text + '\n------------------')
  },

  async size(id) {
    console.log(
      JSON.stringify(
        await page.evaluate((id) => {
          const d = window.__cockpitDebug
          return d.size(id || d.ids()[0])
        }, id || null)
      )
    )
  },

  // Resize the window: resize 900x600
  async resize(arg) {
    const [w, h] = arg.split('x').map(Number)
    await app.evaluate(
      ({ BrowserWindow }, [w, h]) => BrowserWindow.getAllWindows()[0].setSize(w, h),
      [w, h]
    )
    await sleep(300)
    console.log('resized to', w, h)
  },

  async clipboard(text) {
    if (text) {
      await app.evaluate(({ clipboard }, t) => clipboard.writeText(t), text)
      console.log('clipboard set')
    } else {
      console.log(JSON.stringify(await app.evaluate(({ clipboard }) => clipboard.readText())))
    }
  },

  async relaunch() {
    await COMMANDS.quit()
    await COMMANDS.launch()
  },

  // The start screen: the selected agent, the restore offer, and the first rows
  // (`launcher 30` for more). `>` marks the selected row.
  async launcher(n) {
    const view = await page.evaluate(
      (n) => {
        const el = document.querySelector('.launcher')
        if (!el) return null
        const text = (sel) => el.querySelector(sel)?.textContent?.trim() ?? null
        const rows = [...el.querySelectorAll('.launcher-list li')].slice(0, n).map((li) => {
          const cell = (sel) => li.querySelector(sel)?.textContent ?? ''
          const mark = li.classList.contains('selected') ? '>' : ' '
          return `${mark} ${cell('.dir-name')}  ${cell('.dir-path')}  ${cell('.launcher-used')}`
        })
        return { agent: text('.launcher-agents .on'), restore: text('.launcher-restore'), rows }
      },
      Number(n) || 15
    )
    if (!view) return console.log('no start screen')
    console.log(`agent: ${view.agent}${view.restore ? `  | ${view.restore}` : ''}`)
    console.log(view.rows.join('\n'))
  },

  // Print the saved layout from $COCKPIT_HOME/config.json as an indented tree.
  async layout() {
    const home = process.env.COCKPIT_HOME ?? path.join(process.env.HOME, '.cockpit')
    const cfg = JSON.parse(fs.readFileSync(path.join(home, 'config.json'), 'utf8'))
    const show = (n, depth) => {
      const pad = '  '.repeat(depth)
      if (n.type === 'pane') return [`${pad}${n.id} ${n.presetId} ${n.cwd}`]
      return [
        `${pad}${n.direction} [${n.sizes.map((x) => x.toFixed(2)).join(', ')}]`,
        ...n.children.flatMap((c) => show(c, depth + 1))
      ]
    }
    for (const t of cfg.layout.tabs) {
      const mark = t.id === cfg.layout.activeTabId ? '*' : ' '
      console.log(`${mark}${t.id} (focus ${t.activePaneId})`)
      console.log(show(t.root, 1).join('\n'))
    }
  },

  // Pane ids currently rendered, with each one's first non-empty screen line.
  async panes() {
    const rows = await page.evaluate(() => {
      const d = window.__cockpitDebug
      return d.ids().map((id) => {
        const first = (d.screen(id) ?? '').split('\n').find((l) => l.trim()) ?? ''
        return `${id} ${JSON.stringify(d.size(id))} ${first.trim().slice(0, 60)}`
      })
    })
    console.log(rows.join('\n'))
  },

  async eval(expr) {
    console.log(JSON.stringify(await page.evaluate(expr)))
  },

  // Widget frames: list them, or run an expression inside one.
  //   widgets
  //   weval hello document.querySelector('#count').textContent
  //   weval hello await cockpit.storage.keys()
  async widgets() {
    const urls = await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0]
        .webContents.mainFrame.framesInSubtree.filter((f) => f.parent)
        .map((f) => f.url)
    )
    for (const url of urls) console.log('frame:', url)
    console.log(JSON.stringify(await page.evaluate(() => window.__cockpitWidgets?.())))
  },

  async weval(arg) {
    const sp = arg.indexOf(' ')
    const frame = widgetFrame(arg.slice(0, sp))
    const body = arg.slice(sp + 1)
    const fn = `(async () => { return (${body}) })()`
    console.log(JSON.stringify(await frame.evaluate(fn)))
  },

  // Click an element inside a widget: wclick hello #fetch-allowed
  async wclick(arg) {
    const [id, selector] = [arg.slice(0, arg.indexOf(' ')), arg.slice(arg.indexOf(' ') + 1)]
    await widgetFrame(id).click(selector)
  },

  // Text of an element inside a widget: wtext hello #fetch-out
  async wtext(arg) {
    const [id, selector] = [arg.slice(0, arg.indexOf(' ')), arg.slice(arg.indexOf(' ') + 1)]
    console.log(await widgetFrame(id).locator(selector).innerText())
  },

  // Record shell.openExternal calls instead of opening the browser.
  async stubopen() {
    await app.evaluate(({ shell }) => {
      globalThis.__opened = []
      shell.openExternal = async (url) => {
        globalThis.__opened.push(url)
      }
    })
  },

  async opened() {
    console.log(JSON.stringify(await app.evaluate(() => globalThis.__opened ?? null)))
  },

  // Pane statuses as the chrome sees them: id status agent name · cwd, then details.
  async sessions() {
    const list = await page.evaluate(() => window.__cockpitSessions?.() ?? [])
    for (const s of list) {
      const extra = [s.message, s.title, s.tokens !== null ? `${s.tokens} tokens` : null]
        .filter(Boolean)
        .join(' | ')
      console.log(
        `${s.focused ? '*' : ' '}${s.id} ${s.status} ${s.agent ?? '-'} ${s.name} · ${s.cwd}` +
          (extra ? `  [${extra}]` : '')
      )
    }
  },

  // Record notifications instead of showing them (stubnotify), or record them
  // and show them for real, noting whether macOS showed them (watchnotify).
  // Then list them (notes) or click one (clicknote 0).
  async stubnotify() {
    await COMMANDS.watchnotify('stub')
  },

  async watchnotify(mode) {
    await app.evaluate(({ Notification }, stub) => {
      globalThis.__notes = []
      globalThis.__realShow ??= Notification.prototype.show
      Notification.prototype.show = function () {
        globalThis.__notes.push(this)
        if (stub) return
        this.__events = []
        for (const ev of ['show', 'failed', 'click', 'close']) {
          this.on(ev, (_e, err) => this.__events.push(err ? `${ev}: ${err}` : ev))
        }
        globalThis.__realShow.call(this)
      }
    }, mode === 'stub')
  },

  async notes() {
    const notes = await app.evaluate(() =>
      (globalThis.__notes ?? []).map((n) => ({
        title: n.title,
        subtitle: n.subtitle,
        body: n.body,
        events: n.__events
      }))
    )
    notes.forEach((n, i) =>
      console.log(
        `${i}: ${n.title} | ${n.subtitle} | ${n.body}` +
          (n.events ? `  (${n.events.join(', ')})` : '')
      )
    )
    if (notes.length === 0) console.log('no notifications')
  },

  async clicknote(i) {
    await app.evaluate((_e, i) => globalThis.__notes[i].emit('click'), Number(i) || 0)
  },

  // The Dock icon's badge (how many panes need attention).
  async badge() {
    console.log('badge:', JSON.stringify(await app.evaluate(({ app }) => app.dock?.getBadge())))
  },

  // Take focus away from the window (as switching apps does), or give it back.
  async blur() {
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].blur())
    await sleep(200)
    await COMMANDS.focused()
  },

  async focus() {
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].focus())
    await sleep(200)
    await COMMANDS.focused()
  },

  // Hide the app (as Cmd+H does) or bring it back.
  async hide() {
    await app.evaluate(({ app }) => app.hide())
    await sleep(300)
    await COMMANDS.focused()
  },

  async unhide() {
    await app.evaluate(({ app, BrowserWindow }) => {
      app.show()
      BrowserWindow.getAllWindows()[0].focus()
    })
    await sleep(300)
    await COMMANDS.focused()
  },

  async focused() {
    const f = await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].isFocused()
    )
    console.log('window focused:', f)
  },

  // Answer the host's secret prompt: `secret value`, `secret $ENV_VAR` (the
  // value is read from the driver's environment and never printed), or
  // `secret` alone to cancel.
  async secret(arg) {
    const dialog = page.locator('.secret-prompt')
    await dialog.waitFor({ timeout: 5000 })
    console.log('prompt:', (await dialog.locator('.secret-title').innerText()).trim())
    if (!arg) {
      await dialog.locator('button', { hasText: 'Cancel' }).click()
      return
    }
    const value = arg.startsWith('$') ? process.env[arg.slice(1)] : arg
    if (!value) throw new Error(`${arg} is empty`)
    await dialog.locator('input').fill(value)
    await dialog.locator('button[type=submit]').click()
  },

  async quit() {
    if (app) await app.close().catch(() => undefined)
    app = null
    page = null
  },

  help() {
    console.log('commands:', Object.keys(COMMANDS).join(', '))
  }
}

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  prompt: 'driver> '
})
const queue = []
let busy = false
// Commands can be piped in; stdin may close while they are still running.
let inputClosed = false
async function drain() {
  if (busy) return
  busy = true
  while (queue.length) {
    const line = queue.shift()
    const sp = line.indexOf(' ')
    const cmd = sp === -1 ? line : line.slice(0, sp)
    const rest = sp === -1 ? '' : line.slice(sp + 1)
    const fn = COMMANDS[cmd]
    if (!fn) console.log('unknown:', cmd, '- try: help')
    else if (cmd !== 'launch' && cmd !== 'help' && cmd !== 'quit' && !page)
      console.log('ERROR: launch first')
    else {
      try {
        await fn(rest)
      } catch (e) {
        console.log('ERROR:', e.message)
      }
    }
    if (cmd === 'quit') process.exit(0)
    console.log('ok')
    if (!inputClosed) rl.prompt()
  }
  busy = false
}
rl.on('line', (line) => {
  if (line.trim()) queue.push(line.trimStart())
  void drain()
})
rl.on('close', async () => {
  inputClosed = true
  while (busy || queue.length) await sleep(100)
  await COMMANDS.quit()
  process.exit(0)
})
console.log('cockpit driver - "help" for commands, "launch" to start')
rl.prompt()
