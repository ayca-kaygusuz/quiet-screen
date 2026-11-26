# Quiet Screen platform targets

Reference: Quiet Shelf public commit `2702e05` (0.21.1). Quiet Screen shares its
own interface, library model, backup version 1 and Drive merge semantics across
every target. Platform adapters handle packaging, native sign-in, bounded network
requests, file pickers and operating-system integration.

| Target | Distribution | Verification |
| --- | --- | --- |
| Windows x64 | Per-user EXE installer | Existing Windows workflow and Electron UI suites |
| Linux x64 | Debian package and portable tar archive | Installed sandboxed Electron, profile restart and real OS keyring |
| Android 8+ | Signed APK | Android lint and emulator instrumentation |
| iPhone / iPad 17.4+ | Unsigned universal IPA for personal signing | Native iPhone/iPad Simulators; free AltStore Classic installation |
| Local browser | `quiet-screen-pc.zip`, Node.js 24+ | Shared server and backup/sync tests |
| Hosted browser | Free Cloudflare Worker | Shared tests and live source/asset checks |

Quiet Shelf has no maintained macOS desktop package in this reference. macOS
can use the hosted app or local browser package. No native Mac installer is claimed.

All platform workflows are manual. Native publication requires the matching
Windows/browser release at the exact same source commit. Package binaries stay
immutable. Publishing merges their hashes into `SHA256SUMS.txt` and
`quiet-screen-release.json`.

## Shared behavior

All themes, duplicates, season logging, episode statuses, movie timestamps/notes,
lists and history use shared code. Google is optional. Guest/account workspaces
and explicit first-sync choices stay separate. Native backups use system pickers.

IMDb remains the title source. Mobile and hosted runtimes use the TVmaze episode
list matched by IMDb ID for season boundaries, instead of downloading IMDb's full
compressed dataset on a phone or free Worker. Release dates and finished status
are attributed to TVmaze. Manual counts remain available.

## Credentials and signing

- Windows/Linux/local browser use the existing generated Desktop OAuth configuration.
- Hosted web keeps Web OAuth credentials and encrypted HttpOnly session cookies
  on the server. It streams checkpoints while the browser validates and merges
  records, preserving the free Worker's CPU budget. No runtime secrets are embedded.
- Android uses `com.quietscreen.android` and its release certificate. Register an
  Android OAuth client with that package and SHA-1 in the same Google project.
  Keep the key backups in ignored `private/android-signing`. Actions uses
  `QUIET_SCREEN_ANDROID_KEYSTORE_BASE64` and `QUIET_SCREEN_ANDROID_KEYSTORE_PASSWORD`.
  Preserve this signing identity for upgrades.
- iOS uses public `QUIET_SCREEN_GOOGLE_IOS_CLIENT_ID` for `com.quietscreen.ios`.
  No OAuth secret, Desktop/Web configuration or Apple signing material is bundled.
  Without native client configuration the app remains available in guest mode.

Linux persists tokens only with recognized OS keyrings; unavailable keyrings
allow session-only sign-in. Verified updates require explicit manual package
installation, with no automatic privileged installer.

See [iPhone/iPad installation](ios/INSTALL.md) for AltStore Classic, free signing
renewal and device checks. Unsigned IPAs are not directly installable. Simulator
tests do not verify actual Google consent, AltStore signing or physical pickers.

## Hosted setup

Add `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_API_TOKEN` in GitHub Actions. The token
needs Workers Scripts Edit for the selected account. Run Hosted browser application.
It creates the separate `quiet-screen` Worker, preserves its session key and
prints the actual origin and callback URI. Add those exact addresses to the
existing Web OAuth client in Google Console.

No paid plan, database, domain, Apple service or store submission is provisioned.
An open browser tab retains edits offline, but opening the hosted site requires
a connection. No offline service-worker cache is claimed.

## Future Quiet launcher

`platform-manifest.json` defines stable app ID `quiet-screen`, package IDs,
artifact names and install modes. Generated release metadata lists only packages
actually published, with version, source commit, URL, size and SHA-256. A launcher
can use it without renaming profiles or coupling app libraries. Quiet Screen
remains independent; this port does not implement a launcher or cross-app login.
