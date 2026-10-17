// Hello: one button per widget API call, each printing what came back.
// `cockpit` is defined by the host before this script runs.

const $ = (id) => document.getElementById(id)

function show(id, value, kind) {
  const el = $(id)
  el.textContent = typeof value === 'string' ? value : JSON.stringify(value, null, 2)
  el.className = 'out' + (kind ? ' ' + kind : '')
}

function showError(id, err) {
  // Errors from the host are CockpitErrors with a code.
  show(id, `${err.code ?? err.name}: ${err.message}`, 'error')
}

function on(id, fn) {
  $(id).addEventListener('click', () => {
    fn().catch((err) => console.error(err))
  })
}

// fetch

on('fetch-allowed', async () => {
  try {
    const res = await cockpit.fetch('https://example.com/')
    const title = /<title>([^<]*)<\/title>/i.exec(res.body)?.[1] ?? '(no title)'
    show(
      'fetch-out',
      `${res.status} ${res.statusText}, ${res.body.length} chars\ntitle: ${title}`,
      'ok'
    )
  } catch (err) {
    showError('fetch-out', err)
  }
})

on('fetch-refused', async () => {
  try {
    const res = await cockpit.fetch('https://example.org/')
    show('fetch-out', `unexpectedly allowed: ${res.status}`, 'error')
  } catch (err) {
    showError('fetch-out', err)
  }
})

// storage

async function renderCount() {
  const count = await cockpit.storage.get('count')
  $('count').textContent = String(count ?? 0)
}

on('count-up', async () => {
  const count = (await cockpit.storage.get('count')) ?? 0
  await cockpit.storage.set('count', count + 1)
})

$('note').addEventListener('keydown', (e) => {
  // Sandboxed widgets can't submit forms, so listen for Enter instead.
  if (e.key !== 'Enter') return
  cockpit.storage.set('note', e.target.value).catch((err) => showError('storage-out', err))
})

cockpit.storage.subscribe(({ key, value }) => {
  show('storage-out', `changed: ${key} = ${JSON.stringify(value)}`)
  if (key === 'count') $('count').textContent = String(value ?? 0)
})

// secrets

on('secret-get', async () => {
  try {
    // Prompts in the host if it isn't stored yet.
    const value = await cockpit.secrets.get('hello-secret')
    show('secret-out', `got a secret of ${value.length} characters`, 'ok')
  } catch (err) {
    showError('secret-out', err)
  }
})

on('secret-forget', async () => {
  await cockpit.secrets.delete('hello-secret')
  show('secret-out', 'forgotten; the next get prompts again')
})

on('secret-undeclared', async () => {
  try {
    await cockpit.secrets.get('github-token')
    show('secret-out', 'unexpectedly allowed', 'error')
  } catch (err) {
    showError('secret-out', err)
  }
})

// openExternal

on('open-allowed', async () => {
  try {
    await cockpit.openExternal('https://example.com/')
    show('open-out', 'opened in the browser', 'ok')
  } catch (err) {
    showError('open-out', err)
  }
})

on('open-refused', async () => {
  try {
    await cockpit.openExternal('https://example.org/')
    show('open-out', 'unexpectedly allowed', 'error')
  } catch (err) {
    showError('open-out', err)
  }
})

// sessions

function renderSessions(list) {
  const ul = $('sessions')
  ul.textContent = ''
  for (const s of list) {
    const li = document.createElement('li')
    const detail = s.title
    li.textContent = `${s.focused ? '▸ ' : ''}${s.name} · ${s.cwd} · ${s.status}${detail ? ` · ${detail}` : ''}`
    if (s.status === 'exited') li.className = 'exited'
    ul.appendChild(li)
  }
  if (list.length === 0) ul.textContent = 'no panes'
}

cockpit.sessions.subscribe(renderSessions)

// theme and visibility

const SWATCHES = [
  '--bg',
  '--bg-raised',
  '--fg',
  '--muted',
  '--accent',
  '--red',
  '--green',
  '--yellow',
  '--blue',
  '--magenta',
  '--cyan'
]

function renderTheme(vars) {
  const box = $('swatches')
  box.textContent = ''
  for (const name of SWATCHES) {
    const span = document.createElement('span')
    span.style.background = `var(${name})`
    span.title = `${name}: ${vars[name]}`
    box.appendChild(span)
  }
}

let themeChanges = 0
cockpit.theme.subscribe((vars) => {
  themeChanges++
  $('theme-events').textContent = `theme: ${themeChanges} change${themeChanges === 1 ? '' : 's'}`
  renderTheme(vars)
})

cockpit.visibility.subscribe(({ visible }) => {
  $('visible').textContent = visible ? 'visible' : 'hidden'
})

await cockpit.ready
$('visible').textContent = cockpit.visibility.visible ? 'visible' : 'hidden'
renderTheme(cockpit.theme.vars)
await renderCount()
renderSessions(await cockpit.sessions.list())
