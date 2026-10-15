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

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const COMMANDS = {
  async launch() {
    if (app) return console.log('already launched')
    app = await electron.launch({
      args: [APP_DIR],
      cwd: APP_DIR,
      timeout: 30_000
    })
    page = await app.firstWindow()
    await page.waitForFunction(() => (window.__cockpitDebug?.ids().length ?? 0) > 0, null, {
      timeout: 15_000
    })
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

  async eval(expr) {
    console.log(JSON.stringify(await page.evaluate(expr)))
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
    rl.prompt()
  }
  busy = false
}
rl.on('line', (line) => {
  if (line.trim()) queue.push(line.trimStart())
  void drain()
})
rl.on('close', async () => {
  while (busy || queue.length) await sleep(100)
  await COMMANDS.quit()
  process.exit(0)
})
console.log('cockpit driver - "help" for commands, "launch" to start')
rl.prompt()
