// Opens a file or a project folder in the user's editor: config.json's
// `editor`, run through the login shell (so it finds the same PATH presets
// do) with the path added, or the path's default app when that's unset.
import { execFile } from 'node:child_process'
import os from 'node:os'
import { shell } from 'electron'
import { shQuote } from './agents/launch'

/** Editor CLIs hand the path to the app and exit; one that waits is cut off here. */
const TIMEOUT_MS = 15_000

/** The shell command that opens `target` in `editor` ("zed", "code -g"). */
export function editorCommand(editor: string, target: string): string {
  return `${editor} ${shQuote(target)}`
}

/** Opens `target`, an absolute path. Resolves to what went wrong, or null. */
export function openInEditor(editor: string | null, target: string): Promise<string | null> {
  if (!editor) return shell.openPath(target).then((err) => (err ? err : null))
  return new Promise((resolve) => {
    execFile(
      process.env.SHELL ?? '/bin/zsh',
      ['-l', '-c', editorCommand(editor, target)],
      { cwd: os.homedir(), timeout: TIMEOUT_MS },
      (err, _stdout, stderr) => {
        const said = stderr.trim()
        resolve(!err ? null : said ? said : err.message)
      }
    )
  })
}
