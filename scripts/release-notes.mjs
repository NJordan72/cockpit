// Prints the GitHub release notes for one version: its section of
// CHANGELOG.md, then how to install the download. The release workflow runs
// it; you can run it locally to preview.
//
//   node scripts/release-notes.mjs 0.2.0 [--unsigned]
//
// --unsigned adds how to open an app that has no Developer ID signature.
import * as fs from 'node:fs'
import * as path from 'node:path'

const args = process.argv.slice(2)
const version = args.find((a) => !a.startsWith('--'))
const unsigned = args.includes('--unsigned')
if (!version) {
  console.error('usage: node scripts/release-notes.mjs <version> [--unsigned]')
  process.exit(2)
}

const changelog = fs.readFileSync(path.resolve(import.meta.dirname, '..', 'CHANGELOG.md'), 'utf8')
// Changesets writes one `## <version>` heading per release, newest first.
const lines = changelog.split('\n')
const start = lines.findIndex((l) => l.trim() === `## ${version}`)
if (start === -1) {
  console.error(`CHANGELOG.md has no "## ${version}" section`)
  process.exit(1)
}
const rest = lines.slice(start + 1)
const end = rest.findIndex((l) => l.startsWith('## '))
const section = (end === -1 ? rest : rest.slice(0, end)).join('\n').trim()

const repo = 'NJordan72/cockpit'
const dmg = `Cockpit-${version}-arm64.dmg`
const install = [
  '## Install',
  '',
  `Download \`${dmg}\`, open it, and drag Cockpit to Applications. It runs on Apple silicon Macs. The \`.zip\` has the same app.`
]
if (unsigned) {
  install.push(
    '',
    "This build isn't signed with an Apple Developer ID, so the first time you open it macOS says it can't verify the app. Click **Done**, then open **System Settings > Privacy & Security**, scroll down to the message about Cockpit, and click **Open Anyway**. You'll need to do this again after each update."
  )
}
install.push(
  '',
  `To check that a download was built by this repository's release workflow from the tagged commit, run \`gh attestation verify ${dmg} --repo ${repo}\`.`
)

process.stdout.write(`${section}\n\n${install.join('\n')}\n`)
