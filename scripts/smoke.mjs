// Launches the built app, opens a shell from the start screen, and checks that
// a command's output reaches the terminal. Then makes a task in a scratch git
// repository, checks its worktree, its setup, and the label a widget puts on
// its pane, and removes it. Exits non-zero on a timeout or on any renderer
// error. Run `bun run build` first.
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

// A widget that labels every pane on a branch with the branch's name.
const labeler = path.join(home, '.cockpit', 'widgets', 'smoke-labels')
fs.mkdirSync(labeler, { recursive: true })
fs.writeFileSync(
  path.join(labeler, 'widget.json'),
  JSON.stringify({
    id: 'smoke-labels',
    name: 'Smoke labels',
    permissions: { sessions: 'label', openExternal: ['https://example.com/*'] }
  })
)
fs.writeFileSync(
  path.join(labeler, 'index.html'),
  `<!doctype html>
<script>
  const label = (list) => {
    for (const s of list) {
      if (!s.branch) continue
      const l = { key: 'SMOKE', title: s.branch, facts: ['42'], url: 'https://example.com/' }
      cockpit.sessions.label(s.id, l).catch((err) => {
        // A pane that closed meanwhile.
        if (err.code !== 'not_found') console.error('label failed: ' + err.message)
      })
    }
  }
  cockpit.sessions.subscribe(label)
  cockpit.sessions.list().then(label)
</script>
`
)
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

  // What main prints, shown when a step fails.
  const mainOutput = []
  app.process().stdout?.on('data', (d) => mainOutput.push(String(d)))
  app.process().stderr?.on('data', (d) => mainOutput.push(String(d)))

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
  try {
    await page.waitForFunction(() => (window.__cockpitDebug?.ids().length ?? 0) > 1, null, {
      timeout: 30_000
    })
  } catch (err) {
    // The dialog's error line says why git or main refused the task.
    const dialog = await page.evaluate(
      () => document.querySelector('.task-dialog .secret-hint')?.textContent ?? '(dialog closed)'
    )
    console.error(`smoke: no task tab opened. The dialog says: ${dialog}`)
    console.error(`smoke: main printed:\n${mainOutput.join('') || '(nothing)'}`)
    throw err
  }
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

  // Main reads the branch from the worktree's HEAD, and the widget's label
  // shows in a strip above the pane, with the terminal refit under it.
  await page.waitForFunction(
    (b) => window.__cockpitSessions?.().some((s) => s.branch === b) ?? false,
    TASK_BRANCH,
    { timeout: 15_000 }
  )
  try {
    await page.waitForFunction(
      (b) =>
        [...document.querySelectorAll('.label-strip')].some((strip) => {
          const text = strip.textContent ?? ''
          const host = strip.parentElement?.querySelector('.terminal-host')
          const screen = host?.querySelector('.xterm-screen')
          return (
            text.includes('SMOKE') &&
            text.includes(b) &&
            !!screen &&
            screen.getBoundingClientRect().bottom <= host.getBoundingClientRect().bottom + 1
          )
        }),
      TASK_BRANCH,
      { timeout: 15_000 }
    )
  } catch (err) {
    const strips = await page.evaluate(() =>
      [...document.querySelectorAll('.label-strip')].map((el) => el.textContent)
    )
    console.error(
      `smoke: no label strip for ${TASK_BRANCH} that fits. Strips: ${JSON.stringify(strips)}`
    )
    throw err
  }
  step('main read the task branch, and a widget labeled its pane above the terminal')

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

  // A pull request pane, opened through main the way a window of panels asks
  // for one. The scratch HOME may have no gh login, so the pane shows the
  // pull request or gh's error; either means it read gh's answer.
  await page.evaluate(() =>
    window.cockpit.prs.openPane({
      pr: { repo: 'NJordan72/cockpit', number: 25 },
      cwd: '~/dev/smoke',
      where: 'tab'
    })
  )
  await page.waitForFunction(
    () => {
      const pane = document.querySelector('.pr-pane')
      if (!pane) return false
      return pane.querySelector('.pr-head') !== null || !pane.textContent?.startsWith('Reading')
    },
    null,
    { timeout: 30_000 }
  )
  const prShown = await page.evaluate(
    () =>
      document.querySelector('.pr-title-text')?.textContent ??
      document.querySelector('.pr-pane .pr-empty')?.textContent ??
      ''
  )
  step(`a pull request pane opened and showed: ${prShown.slice(0, 120)}`)

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
