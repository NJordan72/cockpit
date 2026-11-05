// Launches the built app, opens a shell from the start screen, and checks that
// a command's output reaches the terminal. Exits non-zero on a timeout or on
// any renderer error. Run `bun run build` first.
//
//   node scripts/smoke.mjs                              # out/, through electron
//   node scripts/smoke.mjs dist/mac-arm64/Cockpit.app   # a packaged app
//
// The app runs with a scratch HOME, COCKPIT_HOME, and Chromium profile, so it
// never reads or writes your real config.
import { _electron as electron } from 'playwright-core'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

const APP_DIR = path.resolve(import.meta.dirname, '..')
const scratch = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'cockpit-smoke-')))
const home = path.join(scratch, 'home')
const userData = path.join(scratch, 'user-data')
// One project for the start screen to list, and empty zsh startup files so
// zsh doesn't open its first-run setup wizard.
fs.mkdirSync(path.join(home, 'dev', 'smoke'), { recursive: true })
for (const f of ['.zshenv', '.zprofile', '.zshrc']) fs.writeFileSync(path.join(home, f), '')

// The shell computes this, so it only appears once the command has run: the
// typed command line shows `$((6 * 7))`, not 42.
const COMMAND = 'echo cockpit-smoke-$((6 * 7))'
const EXPECTED = 'cockpit-smoke-42'

const errors = []
const step = (msg) => console.log(`smoke: ${msg}`)

const bundle = process.argv[2] ? path.resolve(process.argv[2]) : null
const target = bundle
  ? {
      executablePath: path.join(bundle, 'Contents', 'MacOS', 'Cockpit'),
      args: [`--user-data-dir=${userData}`],
      cwd: home
    }
  : { args: [APP_DIR, `--user-data-dir=${userData}`], cwd: APP_DIR }
if (bundle && !fs.existsSync(target.executablePath)) {
  throw new Error(`no app at ${target.executablePath}; run bun run package:app first`)
}
step(bundle ? `launching ${bundle}` : 'launching out/')

const app = await electron.launch({
  ...target,
  env: {
    PATH: '/usr/bin:/bin:/usr/sbin:/sbin',
    HOME: home,
    USER: os.userInfo().username,
    LOGNAME: os.userInfo().username,
    SHELL: '/bin/zsh',
    TMPDIR: os.tmpdir(),
    LANG: 'en_US.UTF-8',
    COCKPIT_HOME: path.join(home, '.cockpit')
  },
  timeout: 60_000
})
try {
  const ud = await app.evaluate(({ app }) => app.getPath('userData'))
  if (!fs.realpathSync(ud).startsWith(userData)) {
    throw new Error(`the app is using ${ud}, not the scratch profile`)
  }
  if (bundle) {
    // An icon that fails to load is just an empty image, with no error.
    const info = await app.evaluate(({ app, nativeImage }) => ({
      packaged: app.isPackaged,
      version: app.getVersion(),
      icon: !nativeImage
        .createFromPath(`${process.resourcesPath}/app.asar/resources/icon.png`)
        .isEmpty()
    }))
    if (!info.packaged) throw new Error('the app does not say it is packaged')
    if (!info.icon) throw new Error('the app could not load resources/icon.png from app.asar')
    step(`packaged app ${info.version} is up`)
  }

  const page = await app.firstWindow()
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(`console: ${msg.text()}`)
  })
  page.on('pageerror', (err) => errors.push(`page: ${err.message}`))

  // The start screen focuses its filter box once it has mounted, so wait for
  // that before pressing any key.
  await page.waitForFunction(
    () => document.querySelector('.launcher')?.contains(document.activeElement) ?? false,
    null,
    { timeout: 30_000 }
  )
  step('start screen is up')

  // Cmd+Shift+T opens a shell tab in one step. Cmd+T would also need an Enter
  // in the picker.
  await page.keyboard.press('Meta+Shift+T')
  await page.waitForFunction(() => (window.__cockpitDebug?.ids().length ?? 0) > 0, null, {
    timeout: 15_000
  })
  step('a pane opened')

  // Give the login shell a moment to print its prompt before typing.
  await page.waitForTimeout(1500)
  await page.keyboard.type(COMMAND, { delay: 10 })
  await page.keyboard.press('Enter')
  try {
    await page.waitForFunction(
      (expected) => {
        const d = window.__cockpitDebug
        return d?.ids().some((id) => (d.screen(id) ?? '').includes(expected)) ?? false
      },
      EXPECTED,
      { timeout: 15_000 }
    )
  } catch (err) {
    const screen = await page.evaluate(() => {
      const d = window.__cockpitDebug
      return (
        d
          ?.ids()
          .map((id) => d.screen(id))
          .join('\n----\n') ?? '(no panes)'
      )
    })
    console.error(`smoke: the terminal never showed ${EXPECTED}. It shows:\n${screen}`)
    throw err
  }
  step('the shell ran a command and the terminal showed its output')

  // xterm's WebGL renderer sets canvas fonts with a leading space. If the
  // canvas ignores them, terminal text draws in 10px sans-serif.
  const font = await page.evaluate(() => {
    const ctx = document.createElement('canvas').getContext('2d')
    ctx.font = ' normal 26px monospace'
    return ctx.font
  })
  if (font !== '26px monospace') {
    throw new Error(`the canvas ignored a font with a leading space and kept ${font}`)
  }
  step('the canvas accepts the fonts xterm sets')

  if (errors.length > 0) {
    throw new Error(`renderer errors:\n${errors.join('\n')}`)
  }
  step('ok')
} finally {
  await app.close()
  fs.rmSync(scratch, { recursive: true, force: true })
}
