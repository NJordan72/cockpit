# cockpit

## 0.4.0

### Minor Changes

- Cockpit keeps Claude Code's plans. When Claude finishes planning, a Plan button appears in the toolbar; click it or press Cmd+Shift+P to read the plan over the window as formatted Markdown, with whether you approved it and buttons to open the plan file or copy it. Plans stay for the rest of the session, through `/clear`, and a session with several plans can switch between them. ([#23](https://github.com/NJordan72/cockpit/pull/23))

## 0.3.1

### Patch Changes

- Terminal text draws at its normal size again. Since 0.2.0, terminals drew letters in a tiny sans-serif font spread across each cell, while box drawing and the cursor looked fine. ([#20](https://github.com/NJordan72/cockpit/pull/20))

## 0.3.0

### Minor Changes

- Cockpit checks for new versions, downloads them in the background, and asks before restarting into one. The dialog says how many terminals a restart would close and which agents are still working. Choose Cockpit > Check for Updates… to check right away. Releases are also signed with a Developer ID and notarized by Apple now, so macOS opens them without the Open Anyway step. Install this version by hand once; the versions after it arrive on their own. ([#17](https://github.com/NJordan72/cockpit/pull/17))

## 0.2.0

### Minor Changes

- Cockpit now comes as a packaged Mac app for Apple silicon. Each release on GitHub has a `.dmg` and a `.zip`, so you no longer have to build it from source. ([#6](https://github.com/NJordan72/cockpit/pull/6))
