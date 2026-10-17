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

  function fetchSync(token, prefs) {
    return Promise.all([api(token, '/api/v3/member'), api(token, '/api/v3/workflows')]).then(
      function (r) {
        var me = r[0]
        var states = {}
        r[1].forEach(function (wf) {
          wf.states.forEach(function (s) {
            states[s.id] = { name: s.name, type: s.type, position: s.position }
          })
        })
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
    return VIEWS.concat(
      feeds().map(function (f) {
        return { id: f.id, label: f.label, feed: f }
      })
    )
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
    var feed = currentView().feed
    var total = feed ? feed.total : sync.total
    $('count').textContent = typeof total === 'number' ? String(total) : '--'
    if (sync.ok && !authFailed)
      dot.className += Date.now() - syncedAt > STALE_MS ? ' stale' : ' fresh'
    dot.title = sync.ok ? 'Last sync ' + new Date(syncedAt).toLocaleTimeString() : sync.error || ''
  }

  function renderTabs() {
    var tabs = $('tabs')
    tabs.textContent = ''
    allViews().forEach(function (v) {
      var btn = h(
        'button',
        'sc-tab' + (v.id === view ? ' on' : ''),
        v.label + ' ' + visibleStories(v).length
      )
      btn.addEventListener('click', function () {
        if (view === v.id) return
        view = v.id
        listEl.scrollTop = 0
        render(true)
        savePrefs({ view: view })
      })
      if (v.feed) btn.title = v.feed.query
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
    row.title = s.name + '\n' + s.state + ' - ' + s.type + '\nClick to open in Shortcut'
    row.addEventListener('click', function () {
      if (!s.url) return
      cockpit.openExternal(s.url).catch(function (err) {
        console.warn('[shortcut-stories] open failed', err)
      })
    })
    return row
  }

  function renderEmpty() {
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
    if (!sync || !sync.syncedAt)
      return h('div', 'sc-empty', sync && !sync.ok ? 'No stories yet.' : 'Loading...')
    return h('div', 'sc-empty', 'Nothing here.')
  }

  function renderList() {
    var visible = visibleStories(currentView())
    var scroll = listEl.scrollTop
    listEl.textContent = ''
    if (!visible.length) {
      listEl.appendChild(renderEmpty())
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
    var key = view + '|' + needToken + authFailed + '|' + JSON.stringify([stories(), feeds()])
    if (!force && key === renderedKey) return
    renderedKey = key
    renderTabs()
    renderList()
  }

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
      authFailed: authFailed
    }
  }

  setInterval(renderStatus, 30 * 1000)

  cockpit.ready
    .then(function () {
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
