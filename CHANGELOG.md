# cockpit

## 0.3.0

### Minor Changes

- Cockpit checks for new versions, downloads them in the background, and asks before restarting into one. The dialog says how many terminals a restart would close and which agents are still working. Choose Cockpit > Check for Updates… to check right away. Releases are also signed with a Developer ID and notarized by Apple now, so macOS opens them without the Open Anyway step. Install this version by hand once; the versions after it arrive on their own. ([#17](https://github.com/NJordan72/cockpit/pull/17))

## 0.2.0

### Minor Changes

- Cockpit now comes as a packaged Mac app for Apple silicon. Each release on GitHub has a `.dmg` and a `.zip`, so you no longer have to build it from source. ([#6](https://github.com/NJordan72/cockpit/pull/6))
