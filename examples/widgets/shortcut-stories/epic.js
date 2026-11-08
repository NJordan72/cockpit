// The run that Burn down epic submits to Cockpit. Each story in the epic that
// isn't done becomes an item, in the epic's order, waiting on the stories
// whose `blocks` links point at it. A blocker outside the epic that isn't
// done becomes an external item, which Cockpit waits on and never starts.
// Loaded before shortcut.js, which reads it as shortcutEpicRun; Cockpit's
// tests load it on its own.
;(function (root) {
  // A link from the Shortcut API names its stories by id; the MCP server's
  // copy nests them as objects.
  function linkEnd(link, side) {
    var id = link[side + '_id']
    if (id == null && link[side]) id = link[side].id
    return id == null ? null : Number(id)
  }

  // input.epic: { id, name }.
  // input.stories: the epic's stories, each with id, name, app_url,
  //   workflow_state_id, story_links, and archived.
  // input.outside: stories outside the epic that block one in it, by id;
  //   one that couldn't be read is missing.
  // input.isDone(workflowStateId), input.branch(story), input.prompt(story).
  root.shortcutEpicRun = function (input) {
    var done = function (s) {
      return input.isDone(s.workflow_state_id)
    }
    var inEpic = {}
    input.stories.forEach(function (s) {
      inEpic[s.id] = true
    })
    var open = input.stories.filter(function (s) {
      return !s.archived && !done(s)
    })
    var isOpen = {}
    open.forEach(function (s) {
      isOpen[s.id] = true
    })

    var externals = []
    var externalIds = {}
    var items = open.map(function (s) {
      var after = []
      ;(s.story_links || []).forEach(function (link) {
        // The subject blocks the object.
        if (link.verb !== 'blocks' || linkEnd(link, 'object') !== s.id) return
        var blocker = linkEnd(link, 'subject')
        if (blocker == null || blocker === s.id) return
        var waits = isOpen[blocker]
        if (!waits && !inEpic[blocker]) {
          var outside = input.outside[blocker]
          // A blocker that couldn't be read is waited on, so nothing starts early.
          waits = !outside || !done(outside)
          if (waits && !externalIds[blocker]) {
            externalIds[blocker] = true
            externals.push({
              id: 'sc-' + blocker,
              title: outside ? outside.name : 'Story ' + blocker,
              external: true,
              url: outside && outside.app_url ? outside.app_url : undefined
            })
          }
        }
        var id = 'sc-' + blocker
        if (waits && after.indexOf(id) < 0) after.push(id)
      })
      var item = {
        id: 'sc-' + s.id,
        title: s.name,
        branch: input.branch(s),
        prompt: input.prompt(s),
        after: after
      }
      if (s.app_url) item.url = s.app_url
      return item
    })
    externals.forEach(function (x) {
      if (!x.url) delete x.url
    })
    return {
      title: 'Epic ' + input.epic.id + ': ' + input.epic.name,
      items: items.concat(externals)
    }
  }
})(this)
