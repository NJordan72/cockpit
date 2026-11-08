// Launches the built app, opens a shell from the start screen, and checks that
// a command's output reaches the terminal. Then makes a task in a scratch git
// repository, checks its worktree and setup, and removes it. Exits non-zero
// on a timeout or on any renderer error. Run `bun run build` first.
//
//   node scripts/smoke.mjs                              # out/, through electron
//   node scripts/smoke.mjs dist/mac-arm64/Cockpit.app   # a packaged app
//
// The app runs with a scratch HOME, COCKPIT_HOME, and Chromium profile, so it
// never reads or writes your real config.
import { _electron as electron } from 'playwright-core'
import { execFileSync } from 'node:child_process'
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

// The project is a git repository for the task check, with a file git
// ignores that config.json says to copy into each task, and a setup command.
const repo = path.join(home, 'dev', 'smoke')
const git = (...args) =>
  execFileSync(
    'git',
    [
      '-c',
      'user.email=smoke@cockpit',
      '-c',
      'user.name=smoke',
      '-c',
      'commit.gpgsign=false',
      '-C',
      repo,
      ...args
    ],
    { encoding: 'utf8', env: { ...process.env, HOME: home, GIT_CONFIG_NOSYSTEM: '1' } }
  )
git('init', '-q', '-b', 'main')
fs.writeFileSync(path.join(repo, '.gitignore'), '.env\n')
git('add', '.')
git('commit', '-qm', 'first')
fs.writeFileSync(path.join(repo, '.env'), 'SMOKE=1\n')
fs.mkdirSync(path.join(home, '.cockpit'))
fs.writeFileSync(
  path.join(home, '.cockpit', 'config.json'),
  JSON.stringify({
    tasks: { '~/dev/smoke': { setup: 'echo cockpit-setup-$((6 * 7))', copy: ['.env'] } }
  })
)
const TASK_BRANCH = 'smoke/task'
const worktree = path.join(home, '.cockpit', 'worktrees', 'smoke', 'smoke-task')

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

  /** Waits for a pane to show `expected`, and prints every pane's screen if none does. */
  const waitForScreen = async (expected, what) => {
    try {
      await page.waitForFunction(
        (text) => {
          const d = window.__cockpitDebug
          return d?.ids().some((id) => (d.screen(id) ?? '').includes(text)) ?? false
        },
        expected,
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
      console.error(`smoke: ${what} never showed ${expected}. It shows:\n${screen}`)
      throw err
    }
  }

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
  await waitForScreen(EXPECTED, 'the terminal')
  step('the shell ran a command and the terminal showed its output')

  // A task, through the New task dialog, running a Shell so no agent needs to
  // be installed. Its first terminal runs the repository's setup.
  await page.keyboard.press('Meta+Shift+N')
  await page.waitForSelector('#task-branch', { timeout: 10_000 })
  await page.fill('#task-branch', TASK_BRANCH)
  await page.fill('#task-repo', '~/dev/smoke')
  await page.click('.task-dialog [role="radio"]:text-is("Shell")')
  await page.press('#task-branch', 'Enter')
  await page.waitForFunction(() => (window.__cockpitDebug?.ids().length ?? 0) > 1, null, {
    timeout: 30_000
  })
  await waitForScreen('cockpit-setup-42', 'the task')
  step('a task opened and ran its setup')
  if (git('-C', worktree, 'branch', '--show-current').trim() !== TASK_BRANCH) {
    throw new Error(`${worktree} is not on ${TASK_BRANCH}`)
  }
  if (!fs.existsSync(path.join(worktree, '.env'))) throw new Error('.env was not copied')
  await page.waitForTimeout(1000)
  // The path is too long to fit on one line of the screen, so the shell
  // prints a marker when it's there instead.
  await page.keyboard.type(`[ "$PWD" = '${worktree}' ] && echo task-cwd-$((6 * 7))`, { delay: 5 })
  await page.keyboard.press('Enter')
  await waitForScreen('task-cwd-42', 'the task')
  await page.waitForFunction(
    (b) => document.querySelector('.session-list')?.textContent?.includes(`⎇ ${b}`) ?? false,
    TASK_BRANCH,
    { timeout: 10_000 }
  )
  step('its shell is in the worktree, with .env copied, and Sessions names the branch')

  // Removing it asks first (the branch is kept, a terminal closes); say yes.
  await app.evaluate(({ dialog }) => {
    dialog.showMessageBox = () => Promise.resolve({ response: 0, checkboxChecked: false })
  })
  const removed = await page.evaluate(
    (p) => window.cockpit.tasks.remove(p),
    '~/.cockpit/worktrees/smoke/smoke-task'
  )
  if (removed !== true) throw new Error('removing the task did not say it was removed')
  if (fs.existsSync(worktree)) throw new Error(`${worktree} is still there`)
  await page.waitForFunction(() => (window.__cockpitDebug?.ids().length ?? 0) === 1, null, {
    timeout: 10_000
  })
  if (!git('branch', '--list', TASK_BRANCH).includes(TASK_BRANCH)) {
    throw new Error('removing the task deleted its unmerged branch')
  }
  step('removing it closed its terminal and deleted the worktree, keeping the branch')

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
