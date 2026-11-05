// Packages out/ as Cockpit.app, in a .dmg and a .zip under dist/, for Apple silicon.
import type { Configuration } from 'electron-builder'

// CSC_LINK (a .p12) or CSC_NAME (an identity in the keychain) supplies a Developer ID certificate.
const developerId = [process.env.CSC_LINK, process.env.CSC_NAME].some(Boolean)

const config: Configuration = {
  appId: 'io.github.njordan72.cockpit',
  productName: 'Cockpit',
  // electron-builder adds node-pty, the only production dependency, and
  // rebuilds it for Electron. Everything else is bundled into out/.
  files: [
    'out/**/*',
    // scripts/drive.mjs writes screenshots and logs here.
    '!out/shots{,/**}',
    '!out/*.log',
    // The main process loads the window and Dock icon from this path.
    'resources/icon.png',
    'package.json',
    // The app loads build/Release/pty.node, so node-pty's sources and prebuilds stay out.
    '!node_modules/node-pty/{deps,src,third_party,scripts,typings,bin}{,/**}',
    '!node_modules/node-pty/build/Release/{obj.target,.deps,node-addon-api}{,/**}',
    '!node_modules/node-pty/prebuilds{,/**}'
  ],
  // Native code can't run from inside app.asar, and node-pty looks for
  // spawn-helper in app.asar.unpacked.
  asarUnpack: ['node_modules/node-pty/**'],
  // The app's UI is English. The other Chromium locales add about 50 MB.
  electronLanguages: ['en'],
  electronFuses: {
    // Cockpit uses neither ELECTRON_RUN_AS_NODE nor NODE_OPTIONS, and either
    // one would let another process run code as Cockpit. --inspect stays on
    // because the smoke test drives the packaged app through Playwright.
    runAsNode: false,
    enableNodeOptionsEnvironmentVariable: false,
    onlyLoadAppFromAsar: true
  },
  mac: {
    target: [
      { target: 'dmg', arch: ['arm64'] },
      { target: 'zip', arch: ['arm64'] }
    ],
    category: 'public.app-category.developer-tools',
    icon: 'resources/icon.icns',
    // With no certificate, electron-builder skips signing, and Apple silicon
    // won't open the result. '-' signs it ad hoc instead.
    ...(developerId ? {} : { identity: '-' }),
    // Runs only when APPLE_ID, APPLE_APP_SPECIFIC_PASSWORD, and APPLE_TEAM_ID are set.
    notarize: developerId,
    entitlements: 'resources/entitlements.mac.plist',
    entitlementsInherit: 'resources/entitlements.mac.plist',
    // Programs in a pane ask macOS for access as Cockpit, the way they ask as
    // Terminal in Terminal. Without NSAppleEventsUsageDescription, their Apple
    // Events fail with no prompt.
    extendInfo: {
      NSAppleEventsUsageDescription:
        'A program running in a Cockpit terminal wants to control another app.',
      NSDesktopFolderUsageDescription:
        'A program running in a Cockpit terminal wants to use files on your Desktop.',
      NSDocumentsFolderUsageDescription:
        'A program running in a Cockpit terminal wants to use files in your Documents folder.',
      NSDownloadsFolderUsageDescription:
        'A program running in a Cockpit terminal wants to use files in your Downloads folder.',
      NSRemovableVolumesUsageDescription:
        'A program running in a Cockpit terminal wants to use files on a removable volume.',
      NSNetworkVolumesUsageDescription:
        'A program running in a Cockpit terminal wants to use files on a network volume.'
    }
  },
  publish: null
}

export default config
