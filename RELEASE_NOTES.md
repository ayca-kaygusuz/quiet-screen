# Quiet Screen v0.8.0

Quiet Screen now has the same platform targets as the current Quiet Shelf:
Windows x64, Linux x64, Android, universal iPhone/iPad, local browser and hosted
browser. The interface, library and sync model remain shared.

- Linux packages include Debian and portable archives, secure keyring-aware Google
  sign-in, profile retention and verified manual updates.
- Android uses a signed native WebView shell, native Google authorization, system
  file pickers and the shared library. Its signing identity is separate and stable.
- iPhone/iPad uses a universal native WKWebView shell, native Google Sign-In and
  full-window compact/regular layouts. The unsigned IPA needs personal signing
  through AltStore Classic; it is not directly installable or an App Store release.
- The hosted app uses a separate free Cloudflare Worker, encrypted remembered
  sessions and browser-side Drive merging. Deployment preserves the server key.
- The release includes a local browser ZIP and machine-readable package metadata
  for future Quiet launcher integration. App libraries remain independent.

Native Google client registration, real-device consent and system file-picker
checks are distinct from automated build, emulator and Simulator verification.
See PLATFORMS.md for setup and exact distribution/installation behavior.
