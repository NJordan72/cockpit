// Launches the built app, opens a shell from the start screen, and checks that
// a command's output reaches the terminal. Exits non-zero on a timeout or on
// any renderer error. Run `bun run build` first.
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

const app = await electron.launch({
  args: [APP_DIR, `--user-data-dir=${userData}`],
  cwd: APP_DIR,
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

  const page = await app.firstWindow()
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(`console: ${msg.text()}`)
  })
  page.on('pageerror', (err) => errors.push(`page: ${err.message}`))

  await page.waitForSelector('.launcher', { timeout: 30_000 })
  step('start screen is up')

  await page.keyboard.press('Meta+t')
  await page.keyboard.press('Enter')
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

  if (errors.length > 0) {
    throw new Error(`renderer errors:\n${errors.join('\n')}`)
  }
  step('ok')
} finally {
  await app.close()
  fs.rmSync(scratch, { recursive: true, force: true })
}
