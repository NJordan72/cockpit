// The Shortcut story a git branch names: sc-1234 in nick/sc-1234/fix-login.
// Loaded before shortcut.js, which reads it as shortcutStoryId; Cockpit's
// tests load it on its own.
;(function (root) {
  // sc- and the number must stand alone, so disc-12 and sc-12b name nothing.
  var STORY = /(?:^|[^a-z0-9])sc-(\d+)(?![a-z0-9])/i

  root.shortcutStoryId = function (branch) {
    var m = typeof branch === 'string' ? STORY.exec(branch) : null
    return m ? Number(m[1]) : null
  }
})(this)
