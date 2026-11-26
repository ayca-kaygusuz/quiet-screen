# Quiet Screen for iPhone and iPad

Quiet Screen is a universal app for iOS/iPadOS 17.4 or later. iPad uses its full
window, supports portrait/landscape and permits system multitasking. Library and
title details share the screen at 720 points or wider. Narrow windows switch to
list/detail navigation. Resizing uses the available window, not the device name.

## Free installation from Windows

The `Quiet-Screen-iOS-VERSION-unsigned.ipa` download is **not signed or directly
installable**. AltStore Classic signs it using your Apple account. No Apple
credentials belong in Quiet Screen, GitHub Actions or this repository.

1. Install AltServer and AltStore Classic using the official Windows guide:
   https://faq.altstore.io/altstore-classic/how-to-install-altstore-windows
2. Follow AltStore's device trust / Developer Mode instructions.
3. Download the IPA from Quiet Screen's public GitHub release to Files on the device.
4. Open AltStore → My Apps → + and choose the downloaded IPA.
5. With a free Apple account, refresh its signing within seven days. AltServer
   must be reachable for refresh; the computer need not run continuously.

Keep the same Apple account and update the existing app through AltStore. Do not
delete Quiet Screen to update it: deletion removes its local sandbox. Make a JSON
backup or complete Drive sync before changing signing accounts/install methods.
AltStore can rewrite bundle identifiers; real-device Google consent needs to be
verified for the resulting signed installation. Simulator tests cannot prove it.

Google Drive sign-in is optional. Local reading, themes and JSON backup/restore
work without an account or an always-running computer. Catalog lookup needs an
internet connection; the saved library and episode progress work offline.
Credentials stay in the native Google SDK / Keychain, separate from exports and sync.
Quiet Screen does not request access to unrelated files, photos, contacts or media.

Updates are checked according to the saved preference and current connection.
IPA updates require the same sideloading/signing step; the app never silently
installs a download. This is not an App Store or TestFlight release. Those routes
normally require paid Apple Developer Program membership.

## Build and validation

Use a Mac with Xcode 16.4 or later, Node 22+, and Python 3, or the public GitHub
iOS workflow. No paid runner is required. `npm run build:ios` prepares an unsigned
arm64 device IPA. Supply `QUIET_SCREEN_GOOGLE_IOS_CLIENT_ID` as public release
configuration; an iOS OAuth client has no secret. Never bundle Web/Desktop
credentials or an Apple signing key. `node scripts/build-ios.mjs test` requires
`QUIET_SCREEN_IOS_TEST_DESTINATION` for an installed Simulator.

Runtime tests use Apple's WKWebView in iPhone and iPad simulators, including
portrait/landscape, local storage/reload and native adapter boundaries. Simulators
cannot verify AltStore installation, personal signing renewal, real Google consent
or physical keyboard / system Split View interactions. Check those on a device.
