// Shortcut Stories: lists your open Shortcut stories, grouped by workflow
// state. Fetches through cockpit.fetch with a token from cockpit.secrets, and
// keeps the last result and your preferences in cockpit.storage.
;(function () {
  var API = 'https://api.app.shortcut.com'
  var TOKEN = 'shortcut-token'
  var TOKEN_PAGE = 'https://app.shortcut.com/settings/account/api-tokens'

  // {me} is replaced with your Shortcut mention name; `owner:me` doesn't work in the API.
  var DEFAULT_QUERY = 'owner:{me} !is:done !is:archived !is:backlog'
  var MAX_STORIES = 50
  // Extra tabs, each fed by its own fixed search. Their stories show in board
  // order (Shortcut's position). Search results come back in relevance order,
  // so a feed is fetched in full, up to FEED_MAX_STORIES, before sorting.
  var FEED_MAX_STORIES = 250
  var FEEDS = [
    {
      id: 'fe-defined',
      label: 'FE Defined',
      query: 'team:frontend state:"Backlog: Defined" !is:archived'
    }
  ]

  // The search box runs its text as a Shortcut search and lists the results in
  // a Search tab, up to SEARCH_MAX_STORIES of them.
  var SEARCH_VIEW = 'search'
  var SEARCH_MAX_STORIES = 25
  // Searching waits for a pause in typing this long.
  var SEARCH_DEBOUNCE_MS = 400

  // What right-click > Start story sends to an agent. {id} is the story's number.
  var START_STORY = '/start-story sc-{id}'

  // The wheel (🎰) picks a story from the tab and starts it. Its panels are
  // filled from the tab's stories: repeated when there are fewer, a random
  // sample when there are more. style.css lays out 20 panels, 18° apart.
  var WHEEL_SEGMENTS = 20
  var WHEEL_TURNS = 4
  // The box style.css draws the wheel in, before it's scaled to fit.
  var WHEEL_WIDTH = 580
  var WHEEL_HEIGHT = 650
  var SPIN_MS = 5000
  // How long the winner shows before its session starts.
  var REVEAL_MS = 1800

  var POLL_MS = 60 * 1000
  // While the widget can't be seen, poll this rarely; showing it refreshes at once if stale.
  var HIDDEN_POLL_MS = 15 * 60 * 1000
  // After failures, wait POLL_MS * 2^failures, up to this.
  var MAX_BACKOFF_MS = 15 * 60 * 1000
  // A sync older than this turns the dot yellow.
  var STALE_MS = 5 * 60 * 1000

  var STATE_TYPE_RANK = { started: 0, unstarted: 1, backlog: 2, done: 3 }
  var VIEWS = [
    {
      id: 'doing',
      label: 'Doing',
      match: function (s) {
        return s.stateType === 'started'
      }
    },
    {
      id: 'next',
      label: 'Next',
      match: function (s) {
        return s.stateType !== 'started'
      }
    },
    {
      id: 'all',
      label: 'All',
      match: function () {
        return true
      }
    }
  ]

  // ---- Shortcut API ----

  function ShortcutError(message, status, retryAfterMs) {
    var err = new Error(message)
    err.status = status
    err.retryAfterMs = retryAfterMs
    return err
  }

  function api(token, pathOrUrl) {
    var url = pathOrUrl.indexOf('http') === 0 ? pathOrUrl : API + pathOrUrl
    return cockpit
      .fetch(url, {
        headers: { 'Shortcut-Token': token, Accept: 'application/json' },
        timeoutMs: 15000
      })
      .then(function (res) {
        if (res.ok) return res.json()
        var hint =
          res.status === 401 ? ' (bad token?)' : res.status === 429 ? ' (rate limited)' : ''
        var retry = Number(res.headers['retry-after'])
        throw ShortcutError(
          'Shortcut API ' + res.status + hint,
          res.status,
          retry > 0 ? retry * 1000 : 0
        )
      })
  }

  function searchStories(token, query, max) {
    var params = new URLSearchParams({ query: query, page_size: '25', detail: 'slim' })
    var stories = []
    var total = 0
    function page(next) {
      return api(token, next).then(function (p) {
        total = typeof p.total === 'number' ? p.total : total
        stories = stories.concat(p.data || [])
        if (p.next && stories.length < max) return page(p.next)
        return { stories: stories.slice(0, max), total: total }
      })
    }
    return page('/api/v3/search/stories?' + params)
  }

  function toWidgetStory(story, states) {
    var state = states[story.workflow_state_id]
    return {
      id: story.id,
      name: story.name,
      type: story.story_type,
      state: state ? state.name : 'Unknown state',
      stateType: state ? state.type : 'unstarted',
      statePos: state ? state.position : 0,
      estimate: story.estimate == null ? null : story.estimate,
      blocked: !!story.blocked,
      blocker: !!story.blocker,
      deadline: story.deadline || null,
      updatedAt: story.updated_at,
      url: story.app_url
    }
  }

  // Furthest-along work first: started before unstarted, and within a state type,
  // later workflow columns (QA, Awaiting Deployment) before earlier ones.
  function compareStories(a, b) {
    var rank = function (s) {
      return STATE_TYPE_RANK[s.stateType] == null ? 9 : STATE_TYPE_RANK[s.stateType]
    }
    return (
      rank(a) - rank(b) ||
      b.statePos - a.statePos ||
      a.state.localeCompare(b.state) ||
      Date.parse(b.updatedAt) - Date.parse(a.updatedAt)
    )
  }

  // Workflow states by id, from the last sync. Searches reuse them.
  var workflowStates = null

  function readStates(workflows) {
    var states = {}
    workflows.forEach(function (wf) {
      wf.states.forEach(function (s) {
        states[s.id] = { name: s.name, type: s.type, position: s.position }
      })
    })
    workflowStates = states
    return states
  }

  function fetchSync(token, prefs) {
    return Promise.all([api(token, '/api/v3/member'), api(token, '/api/v3/workflows')]).then(
      function (r) {
        var me = r[0]
        var states = readStates(r[1])
        var queryTemplate = (prefs.query || '').trim() || DEFAULT_QUERY
        var query = queryTemplate.split('{me}').join(me.mention_name)
        return Promise.all([
          searchStories(token, query, MAX_STORIES),
          Promise.all(
            FEEDS.map(function (feed) {
              return searchStories(token, feed.query, FEED_MAX_STORIES).then(function (result) {
                return {
                  id: feed.id,
                  label: feed.label,
                  query: feed.query,
                  total: result.total,
                  stories: result.stories
                    .sort(function (a, b) {
                      return a.position - b.position
                    })
                    .map(function (s) {
                      return toWidgetStory(s, states)
                    })
                }
              })
            })
          )
        ]).then(function (r2) {
          return {
            ok: true,
            syncedAt: new Date().toISOString(),
            error: null,
            me: me.mention_name,
            queryTemplate: queryTemplate,
            query: query,
            total: r2[0].total,
            stories: r2[0].stories
              .map(function (s) {
                return toWidgetStory(s, states)
              })
              .sort(compareStories),
            feeds: r2[1]
          }
        })
      }
    )
  }

  // ---- state ----

  var $ = function (id) {
    return document.getElementById(id)
  }
  var listEl = $('list')
  var sync = null // the last sync result, as stored
  var prefs = {} // { view, query }
  var view = 'doing'
  var openIds = {}
  var renderedKey = null
  var search = { text: '', pending: false, error: null, result: null } // the search box's

  var token = null
  var needToken = false // no token stored and the prompt was dismissed
  var authFailed = false // Shortcut answered 401
  var inFlight = false
  var failures = 0
  var retryAfterMs = 0
  var lastAttempt = 0
  var timer = null

  // ---- token ----

  // prompt: whether the host may ask the user. Returns null if there's no token.
  function getToken(prompt) {
    if (token) return Promise.resolve(token)
    return cockpit.secrets.get(TOKEN, { prompt: prompt }).then(
      function (value) {
        token = value
        return token
      },
      function (err) {
        if (err.code === 'cancelled') return null
        throw err
      }
    )
  }

  // Ask for a token in the host's prompt, replacing a rejected one.
  function enterToken() {
    var replace = token || authFailed ? cockpit.secrets.delete(TOKEN) : Promise.resolve()
    token = null
    return replace
      .then(function () {
        return getToken(true)
      })
      .then(function (value) {
        if (!value) return
        needToken = false
        authFailed = false
        failures = 0
        runSync()
      })
  }

  // ---- polling ----

  function nextDelay() {
    var base = cockpit.visibility.visible ? POLL_MS : HIDDEN_POLL_MS
    if (!failures) return base
    var backoff = Math.min(MAX_BACKOFF_MS, POLL_MS * Math.pow(2, failures))
    return Math.max(base, backoff, retryAfterMs)
  }

  // Counts from the last attempt, so a widget shown after a long time hidden
  // syncs at once and one shown a moment ago waits out the rest.
  function schedule() {
    clearTimeout(timer)
    timer = null
    if (needToken || authFailed) return
    timer = setTimeout(runSync, Math.max(0, lastAttempt + nextDelay() - Date.now()))
  }

  function runSync() {
    if (inFlight) return Promise.resolve()
    inFlight = true
    clearTimeout(timer)
    lastAttempt = Date.now()
    return getToken(false)
      .then(function (t) {
        if (!t) {
          needToken = true
          return
        }
        return fetchSync(t, prefs).then(function (result) {
          sync = result
          failures = 0
          retryAfterMs = 0
          // A saved feed tab only exists once its feed has loaded.
          if (
            view !== SEARCH_VIEW &&
            prefs.view &&
            allViews().some(function (v) {
              return v.id === prefs.view
            })
          )
            view = prefs.view
        })
      })
      .catch(function (err) {
        failures++
        retryAfterMs = err.retryAfterMs || 0
        if (err.status === 401) authFailed = true
        // Keep the last good stories on screen; the error shows alongside them.
        sync = Object.assign({}, sync, {
          ok: false,
          error: err.message,
          failedAt: new Date().toISOString()
        })
      })
      .then(function () {
        inFlight = false
        if (sync) cockpit.storage.set('sync', sync).catch(function () {})
        render(false)
        schedule()
      })
  }

  cockpit.visibility.subscribe(schedule)

  // ---- rendering ----

  function h(tag, cls, children) {
    var node = document.createElement(tag)
    if (cls) node.className = cls
    ;[].concat(children == null ? [] : children).forEach(function (c) {
      node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c)
    })
    return node
  }

  function button(label, onClick) {
    var b = h('button', null, label)
    b.type = 'button'
    b.addEventListener('click', function (e) {
      e.stopPropagation()
      onClick()
    })
    return b
  }

  function ago(iso) {
    var t = Date.parse(iso)
    if (!t) return '--'
    var s = Math.max(0, Math.round((Date.now() - t) / 1000))
    if (s < 60) return 'now'
    if (s < 3600) return Math.floor(s / 60) + 'm'
    if (s < 86400) return Math.floor(s / 3600) + 'h'
    return Math.floor(s / 86400) + 'd'
  }

  function stories() {
    return sync && Array.isArray(sync.stories) ? sync.stories : []
  }

  function feeds() {
    return sync && Array.isArray(sync.feeds) ? sync.feeds : []
  }

  function allViews() {
    var views = VIEWS.concat(
      feeds().map(function (f) {
        return { id: f.id, label: f.label, feed: f }
      })
    )
    if (search.text) views.push({ id: SEARCH_VIEW, label: 'Search', search: true })
    return views
  }

  // The tab to go back to when the search is cleared.
  function savedView() {
    var id = prefs.view
    return allViews().some(function (v) {
      return v.id === id && !v.search
    })
      ? id
      : VIEWS[0].id
  }

  function currentView() {
    var views = allViews()
    return (
      views.filter(function (v) {
        return v.id === view
      })[0] || views[0]
    )
  }

  function visibleStories(v) {
    if (v.search) return search.result ? search.result.stories : []
    return v.feed ? v.feed.stories || [] : stories().filter(v.match)
  }

  function savePrefs(patch) {
    prefs = Object.assign({}, prefs, patch)
    return cockpit.storage.set('prefs', prefs).catch(function (err) {
      console.warn('[shortcut-stories] save failed', err)
    })
  }

  function renderStatus() {
    var dot = $('dot')
    var errEl = $('error')
    dot.className = 'sc-dot'
    errEl.textContent = ''

    if (authFailed) {
      dot.className += ' bad'
      errEl.hidden = false
      errEl.appendChild(document.createTextNode('Shortcut rejected the API token.'))
      errEl.appendChild(button('Enter a new token', enterToken))
    } else if (sync && !sync.ok) {
      dot.className += ' bad'
      errEl.hidden = false
      errEl.appendChild(
        document.createTextNode(
          'Sync failed: ' +
            (sync.error || 'unknown error') +
            (stories().length ? ' (showing last good data)' : '')
        )
      )
    } else {
      errEl.hidden = true
    }

    if (!sync || !sync.syncedAt) {
      $('age').textContent = inFlight ? 'syncing' : '--'
      $('count').textContent = '--'
      return
    }
    var syncedAt = Date.parse(sync.syncedAt)
    $('age').textContent = ago(sync.syncedAt)
    var v = currentView()
    var total = v.feed ? v.feed.total : v.search ? search.result && search.result.total : sync.total
    $('count').textContent = typeof total === 'number' ? String(total) : '--'
    if (sync.ok && !authFailed)
      dot.className += Date.now() - syncedAt > STALE_MS ? ' stale' : ' fresh'
    dot.title = sync.ok ? 'Last sync ' + new Date(syncedAt).toLocaleTimeString() : sync.error || ''
  }

  function renderTabs() {
    var tabs = $('tabs')
    tabs.textContent = ''
    allViews().forEach(function (v) {
      var count = v.search && search.pending ? '…' : visibleStories(v).length
      var btn = h('button', 'sc-tab' + (v.id === view ? ' on' : ''), v.label + ' ' + count)
      btn.addEventListener('click', function () {
        if (view === v.id) return
        view = v.id
        listEl.scrollTop = 0
        render(true)
        if (!v.search) savePrefs({ view: view })
      })
      if (v.feed) btn.title = v.feed.query
      if (v.search) btn.title = searchQuery(search.text)
      tabs.appendChild(btn)
    })
  }

  function dueFlag(deadline) {
    var t = Date.parse(deadline)
    if (!t) return null
    var days = Math.ceil((t - Date.now()) / 86400000)
    if (days < 0) return h('span', 'sc-flag-overdue', 'overdue')
    return h('span', 'sc-flag-due', days === 0 ? 'due today' : 'due ' + days + 'd')
  }

  function storyRow(s) {
    var open = !!openIds[s.id]
    var meta = [h('span', null, '#' + s.id)]
    if (s.estimate != null) meta.push(h('span', null, s.estimate + 'pt'))
    if (s.blocked) meta.push(h('span', 'sc-flag-blocked', 'blocked'))
    if (s.blocker) meta.push(h('span', 'sc-flag-blocker', 'blocker'))
    var due = dueFlag(s.deadline)
    if (due) meta.push(due)
    if (open) {
      meta.push(h('span', null, s.type))
      meta.push(h('span', null, 'updated ' + ago(s.updatedAt)))
    }

    var more = button(open ? '▾' : '▸', function () {
      openIds[s.id] = !openIds[s.id]
      render(true)
    })
    more.className = 'sc-more'
    more.title = open ? 'Less' : 'More'

    var row = h('div', 'sc-story' + (open ? ' open' : ''), [
      h('div', 'sc-type ' + (s.type || '')),
      h('div', 'sc-body', [h('div', 'sc-name', s.name || 'untitled'), h('div', 'sc-meta', meta)]),
      more
    ])
    row.title =
      s.name +
      '\n' +
      s.state +
      ' - ' +
      s.type +
      '\nClick to open in Shortcut; right-click to start it'
    row.addEventListener('contextmenu', function (e) {
      e.preventDefault()
      showStoryMenu(s, e.clientX, e.clientY)
    })
    row.addEventListener('click', function () {
      if (!s.url) return
      cockpit.openExternal(s.url).catch(function (err) {
        console.warn('[shortcut-stories] open failed', err)
      })
    })
    return row
  }

  // ---- right-click: start a story in an agent session ----

  // Panes running Claude Code or Codex, from cockpit.sessions.
  var agentSessions = []

  function setSessions(list) {
    agentSessions = (list || []).filter(function (x) {
      return x.agent && x.status !== 'exited'
    })
  }

  var menuEl = null

  function closeMenu() {
    if (menuEl) menuEl.remove()
    menuEl = null
  }

  function menuItem(label, onPick, hint) {
    var b = h('button', 'sc-menu-item', [label])
    b.type = 'button'
    if (hint) b.appendChild(h('span', 'sc-menu-hint', hint))
    b.addEventListener('click', function (e) {
      e.stopPropagation()
      closeMenu()
      onPick()
    })
    return b
  }

  // Shown in the error line until the next status update clears it.
  function failed(err) {
    var errEl = $('error')
    errEl.textContent = 'Could not start the story: ' + String((err && err.message) || err)
    errEl.hidden = false
  }

  function startPrompt(s) {
    return START_STORY.replace('{id}', String(s.id))
  }

  function showStoryMenu(s, x, y) {
    closeMenu()
    var prompt = startPrompt(s)
    var items = [
      menuItem('Start story in a new session', function () {
        cockpit.sessions.start(prompt).catch(failed)
      })
    ]
    if (agentSessions.length) {
      items.push(h('div', 'sc-menu-label', 'Start story in'))
      agentSessions.forEach(function (x) {
        items.push(
          menuItem(
            x.title || x.name,
            function () {
              cockpit.sessions.send(x.id, prompt).catch(failed)
            },
            x.status + (x.focused ? ' · focused' : '')
          )
        )
      })
    }
    items.push(h('div', 'sc-menu-sep'))
    items.push(
      menuItem('Open in Shortcut', function () {
        if (s.url) cockpit.openExternal(s.url).catch(failed)
      })
    )
    menuEl = h('div', 'sc-menu', items)
    menuEl.setAttribute('role', 'menu')
    document.body.appendChild(menuEl)
    // Keep it inside the widget.
    var r = menuEl.getBoundingClientRect()
    menuEl.style.left = Math.max(4, Math.min(x, window.innerWidth - r.width - 4)) + 'px'
    menuEl.style.top = Math.max(4, Math.min(y, window.innerHeight - r.height - 4)) + 'px'
  }

  document.addEventListener('click', closeMenu)
  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape') return
    closeMenu()
    closeWheel()
  })
  window.addEventListener('blur', closeMenu)

  // ---- the wheel: spin for a random story and start it ----

  var wheelEl = $('wheel')
  var drumEl = $('drum')
  var panelsEl = $('panels')
  var pointerEl = $('pointer')
  var wheelStatus = $('wheelStatus')
  var wheelStory = $('wheelStory')
  var wheel = null // the spin on screen: { frame, timer }
  var audio = null
  var reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)')

  // The side plate's spokes and bulbs, which turn with the wheel.
  function addToSide(cls, count) {
    var hub = $('hub')
    for (var i = 0; i < count; i++) {
      var el = h('i', cls)
      el.style.setProperty('--i', String(i))
      hub.parentNode.insertBefore(el, hub)
    }
  }
  addToSide('wh-spoke', WHEEL_SEGMENTS)
  addToSide('wh-bulb', 40)

  function randomIndex(n) {
    return Math.floor(Math.random() * n)
  }

  function shuffle(list) {
    var a = list.slice()
    for (var i = a.length - 1; i > 0; i--) {
      var j = randomIndex(i + 1)
      var t = a[i]
      a[i] = a[j]
      a[j] = t
    }
    return a
  }

  // A story for each face, with the winner on at least one.
  function wheelFaces(pool, winner) {
    var picks = shuffle(pool)
    var faces = []
    for (var i = 0; i < WHEEL_SEGMENTS; i++) faces.push(picks[i % picks.length])
    if (faces.indexOf(winner) < 0) faces[randomIndex(WHEEL_SEGMENTS)] = winner
    return faces
  }

  // A short clack each time a pin passes the pointer.
  function clack() {
    try {
      audio = audio || new AudioContext()
      var t = audio.currentTime
      var osc = audio.createOscillator()
      var gain = audio.createGain()
      osc.type = 'triangle'
      osc.frequency.setValueAtTime(1400, t)
      osc.frequency.exponentialRampToValueAtTime(300, t + 0.03)
      gain.gain.setValueAtTime(0.05, t)
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.04)
      osc.connect(gain)
      gain.connect(audio.destination)
      osc.start(t)
      osc.stop(t + 0.04)
    } catch (err) {
      audio = null
    }
  }

  // Blocked stories never go on the wheel.
  function wheelPool(v) {
    return visibleStories(v).filter(function (s) {
      return !s.blocked
    })
  }

  function updateSpinButton() {
    $('spin').disabled = !wheelPool(currentView()).length
  }

  function closeWheel() {
    if (!wheel) return
    cancelAnimationFrame(wheel.frame)
    clearTimeout(wheel.timer)
    wheel = null
    wheelEl.hidden = true
  }

  // The story on the panel under the pointer.
  function showStory(s) {
    wheelStory.textContent = ''
    wheelStory.appendChild(h('b', null, '#' + s.id))
    wheelStory.appendChild(document.createTextNode(s.name || 'untitled'))
  }

  // The wheel turns downward, the way a contestant pulls it, so the next
  // panels come in from the top.
  function spinWheel() {
    var v = currentView()
    var pool = wheelPool(v)
    var blocked = visibleStories(v).length - pool.length
    if (wheel || !pool.length) return
    closeMenu()
    var winner = pool[randomIndex(pool.length)]
    var faces = wheelFaces(pool, winner)
    var landings = []
    faces.forEach(function (s, i) {
      if (s === winner) landings.push(i)
    })
    var land = landings[randomIndex(landings.length)]

    wheel = { frame: 0, timer: 0 }
    wheelEl.hidden = false
    wheelEl.className = 'wh spinning'
    wheelStatus.textContent =
      'Picking from ' +
      pool.length +
      (pool.length === 1 ? ' story' : ' stories') +
      ' in ' +
      v.label +
      (blocked ? ', leaving out ' + blocked + ' blocked' : '')
    showStory(faces[0])

    var stage = $('wheelStage')
    var scale = Math.min(stage.clientWidth / WHEEL_WIDTH, stage.clientHeight / WHEEL_HEIGHT)
    $('wheelObject').style.transform = 'translate(-50%, -50%) scale(' + scale + ')'

    var seg = 360 / WHEEL_SEGMENTS
    panelsEl.textContent = ''
    faces.forEach(function (s, i) {
      // Colored like the show's wheel: one red panel with a green one either side.
      var color = i === 0 ? ' red' : i === 1 || i === WHEEL_SEGMENTS - 1 ? ' green' : ''
      var panel = h('div', 'wh-panel' + color, [
        h('span', null, String(s.id)),
        h('i', 'wh-pin wh-pin-left'),
        h('i', 'wh-pin wh-pin-right')
      ])
      panel.style.setProperty('--i', String(i))
      panelsEl.appendChild(panel)
    })

    // Land somewhere inside the panel, not dead center, the way a real wheel stops.
    var target = WHEEL_TURNS * 360 + land * seg + (Math.random() - 0.5) * seg * 0.6
    var duration = reducedMotion.matches ? 0 : SPIN_MS
    var pegs = 0
    // Timed from the first frame: a frame's timestamp can be earlier than
    // performance.now() here, which would turn the wheel backward at first.
    var started = null

    function turn(now) {
      if (started === null) started = now
      var t = duration ? Math.min(1, (now - started) / duration) : 1
      var angle = target * (1 - Math.pow(1 - t, 3))
      drumEl.style.transform = 'rotateX(' + -angle + 'deg)'
      // Pins sit between panels. The pointer kicks down as one passes and falls back.
      var passed = Math.floor((angle + seg / 2) / seg)
      var since = (angle + seg / 2) / seg - passed
      pointerEl.style.setProperty('--kick', Math.max(0, 1 - since * 4) * 16 + 'deg')
      if (passed !== pegs) {
        pegs = passed
        showStory(faces[passed % WHEEL_SEGMENTS])
        if (duration) clack()
      }
      if (t < 1) wheel.frame = requestAnimationFrame(turn)
      else landed(winner, panelsEl.children[land])
    }
    wheel.frame = requestAnimationFrame(turn)
  }

  function landed(winner, panel) {
    wheelEl.className = 'wh won'
    panel.classList.add('win')
    showStory(winner)
    wheelStatus.textContent = 'Starting a session · Esc to stop'
    wheel.timer = setTimeout(function () {
      closeWheel()
      cockpit.sessions.start(startPrompt(winner)).catch(failed)
    }, REVEAL_MS)
  }

  $('spin').addEventListener('click', function (e) {
    e.stopPropagation()
    spinWheel()
  })
  $('wheelClose').addEventListener('click', closeWheel)

  function renderEmpty(v) {
    if (needToken) {
      return h('div', 'sc-empty', [
        'Shortcut Stories needs a Shortcut API token.',
        h('br'),
        button('Enter token', enterToken),
        ' ',
        button('Create one', function () {
          cockpit.openExternal(TOKEN_PAGE)
        })
      ])
    }
    if (authFailed) return h('div', 'sc-empty', 'No stories yet.')
    if (v.search) {
      if (search.pending) return h('div', 'sc-empty', 'Searching...')
      if (search.error) return h('div', 'sc-empty', 'Search failed: ' + search.error)
      return h('div', 'sc-empty', 'No stories match.')
    }
    if (!sync || !sync.syncedAt)
      return h('div', 'sc-empty', sync && !sync.ok ? 'No stories yet.' : 'Loading...')
    return h('div', 'sc-empty', 'Nothing here.')
  }

  function renderList() {
    var v = currentView()
    var visible = visibleStories(v)
    var scroll = listEl.scrollTop
    listEl.textContent = ''
    if (!visible.length) {
      listEl.appendChild(renderEmpty(v))
      return
    }
    // Stories arrive sorted by state, so grouping is a single pass.
    var group = null
    visible.forEach(function (s) {
      if (!group || group.name !== s.state) {
        group = {
          name: s.state,
          count: visible.filter(function (o) {
            return o.state === s.state
          }).length
        }
        listEl.appendChild(
          h('div', 'sc-group ' + s.stateType, [
            h('span', null, s.state),
            h('span', null, String(group.count))
          ])
        )
      }
      listEl.appendChild(storyRow(s))
    })
    listEl.scrollTop = scroll
  }

  function render(force) {
    renderStatus()
    // Rebuilding the list resets hover and can jump the scroll, so only do it when something changed.
    var key =
      view + '|' + needToken + authFailed + '|' + JSON.stringify([stories(), feeds(), search])
    if (!force && key === renderedKey) return
    renderedKey = key
    renderTabs()
    renderList()
    updateSpinButton()
  }

  // ---- search ----

  var searchInput = $('searchInput')
  var searchTimer = null
  // Bumped by every search and by clearing, so a slow answer to old text is dropped.
  var searchSeq = 0

  // {me} works here as in the gear's query. Archived stories are left out
  // unless the text asks about them.
  function searchQuery(text) {
    var q = sync && sync.me ? text.split('{me}').join(sync.me) : text
    return /is:archived/.test(q) ? q : q + ' !is:archived'
  }

  function loadStates(t) {
    if (workflowStates) return Promise.resolve(workflowStates)
    return api(t, '/api/v3/workflows').then(readStates)
  }

  function runSearch() {
    clearTimeout(searchTimer)
    var text = search.text
    var seq = ++searchSeq
    getToken(false)
      .then(function (t) {
        if (!t) throw new Error('no Shortcut token')
        return Promise.all([loadStates(t), searchStories(t, searchQuery(text), SEARCH_MAX_STORIES)])
      })
      .then(
        function (r) {
          if (seq !== searchSeq) return
          search.error = null
          search.result = {
            total: r[1].total,
            stories: r[1].stories
              .map(function (s) {
                return toWidgetStory(s, r[0])
              })
              .sort(compareStories)
          }
        },
        function (err) {
          if (seq !== searchSeq) return
          search.error = err.message
          search.result = null
        }
      )
      .then(function () {
        if (seq !== searchSeq) return
        search.pending = false
        render(true)
      })
  }

  // Typing shows the Search tab and searches after a pause; clearing the box
  // goes back to the tab you were on.
  function setSearch(value) {
    var text = value.trim()
    if (text === search.text) return
    clearTimeout(searchTimer)
    if (!text) {
      searchSeq++
      search = { text: '', pending: false, error: null, result: null }
      if (view === SEARCH_VIEW) view = savedView()
    } else {
      search.text = text
      search.pending = true
      if (view !== SEARCH_VIEW) listEl.scrollTop = 0
      view = SEARCH_VIEW
      searchTimer = setTimeout(runSearch, SEARCH_DEBOUNCE_MS)
    }
    render(true)
  }

  searchInput.addEventListener('input', function () {
    setSearch(searchInput.value)
  })
  searchInput.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' && search.text) runSearch()
    if (e.key === 'Escape') {
      searchInput.value = ''
      setSearch('')
    }
  })

  // ---- query editor ----

  var form = $('queryForm')
  var input = $('queryInput')

  function saveQuery() {
    form.hidden = true
    var query = input.value.trim() || DEFAULT_QUERY
    if (query === (prefs.query || DEFAULT_QUERY)) return
    savePrefs({ query: query }).then(function () {
      failures = 0
      runSync()
    })
  }

  $('gear').addEventListener('click', function () {
    form.hidden = !form.hidden
    if (!form.hidden) {
      input.value = prefs.query || (sync && sync.queryTemplate) || DEFAULT_QUERY
      input.focus()
    }
  })
  // Widgets can't submit forms, so Enter is handled here.
  input.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') saveQuery()
    if (e.key === 'Escape') form.hidden = true
  })
  $('querySave').addEventListener('click', saveQuery)
  $('queryReset').addEventListener('click', function () {
    input.value = DEFAULT_QUERY
  })

  $('age').addEventListener('click', function () {
    if (needToken || authFailed) return
    failures = 0
    runSync()
  })

  // ---- start ----

  // Exposed for the e2e driver.
  window.__shortcut = function () {
    return {
      visible: cockpit.visibility.visible,
      lastAttempt: lastAttempt,
      dueInMs: timer ? Math.max(0, lastAttempt + nextDelay() - Date.now()) : null,
      failures: failures,
      needToken: needToken,
      authFailed: authFailed,
      spinning: !!wheel
    }
  }

  setInterval(renderStatus, 30 * 1000)

  cockpit.sessions.subscribe(setSessions)

  cockpit.ready
    .then(function () {
      cockpit.sessions.list().then(setSessions, function () {})
      return Promise.all([cockpit.storage.get('sync'), cockpit.storage.get('prefs')])
    })
    .then(function (saved) {
      sync = saved[0] || null
      prefs = saved[1] || {}
      if (
        prefs.view &&
        allViews().some(function (v) {
          return v.id === prefs.view
        })
      )
        view = prefs.view
      render(true)
      // The first run asks for the token; after that it's stored.
      return getToken(true)
    })
    .then(function (t) {
      if (!t) {
        needToken = true
        render(true)
        return
      }
      // A recent sync from before a reload counts as the last attempt.
      if (sync && sync.ok) lastAttempt = Date.parse(sync.syncedAt) || 0
      schedule()
    })
    .catch(function (err) {
      console.warn('[shortcut-stories] start failed', err)
      $('age').textContent = 'error'
    })
})()
