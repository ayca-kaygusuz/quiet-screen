# Quiet Screen

A local web app for tracking movies, series, individual episodes and other watchable titles. It keeps your library in your browser profile.

## Run

With Node.js 24 or later, run `node server.mjs` and open http://127.0.0.1:4178 in your browser. Use the same browser profile and address to reopen your library.

## Watch history

Choose **Watched** when adding a title you have already seen. Leave **Watched on** blank if you do not remember the date. Open any title to log more viewings, edit a date, or start a rewatch. Starting or finishing a current viewing uses today's date by default. You can clear or change the date when saving the viewing.

## IMDb and backups

Search IMDb by title or paste a title link or ID. Select a result to fill the title fields. The IMDb suggestions service supplies the catalog matches. You can open IMDb directly or enter title details manually if a match is unavailable.

**Back up** downloads your library and viewing history as JSON. **Restore** replaces the current library with the selected backup after confirmation.


## Windows app

Run the x64 installer from `work/windows`, then launch **Quiet Screen** from Start. The installer includes the runtime and installs for the current user. It is unsigned.

The desktop app saves its library and theme in its own profile at `%APPDATA%\Quiet Screen`. Use **Back up** in the web app and **Restore** in the Windows app to bring over your library. The two copies are independent. Uninstalling preserves the desktop profile.

### Build the installer

On Windows with Node.js 24 or later, provide an extracted Windows x64 Electron distribution and the path to NSIS's `makensis.exe`. The build was verified with Electron 45.2.3.

```powershell
node desktop/build.mjs <electron-distribution-directory> <makensis.exe>
```

The build outputs a versioned installer and SHA-256 checksum in `work/windows`. It also prints the path to the unpacked app.

## Episodes, groups and lists

Turn on **Track individual episodes** for a title. The next-episode button logs
today and advances within the current season. Use **Log episode…** to choose a
different season or number, or to leave the date unknown. Starting a title
rewatch gives it a fresh episode sequence.

Quiet Screen groups recognizable sequel, season and subtitle names. Choose a
group name manually to bring related titles together, or keep a title
standalone. **Start group rewatch** queues a group's installments in release
order and starts the first available installment. Open the queue from the list
tabs to start the next installment after finishing the current one.

Use **Watchlist** for titles you plan to watch and its checkmark to record a
viewing today. **New list** creates a custom list. Open a title and use **Add to
lists** to put it on one or more lists.

## Google Drive sync

Use **Account → Sign in with Google**. Quiet Screen first checks Drive and
shows counts. You can sync your local library, combine it with Drive, or open
the Drive copy. A recovery set is saved before changing libraries. The Account
page includes manual sync, automatic sync and metered connection controls,
conflict review, backup/restore, and recovery downloads. The header indicator
shows whether changes are synced, waiting, paused or need attention.

Sync includes watch history, episode viewings, franchise groups, lists and
rewatch queues, and the active theme. Google credentials and the signed-out
library are kept separately. Quiet Screen uses its own file namespace in
Google Drive's hidden app-data folder. Keep both OAuth clients in the same
Quiet Screen Google Cloud project, enable Drive API, and add test users when
the app is in Google's Testing mode.

### Configure Google sign-in

- **Windows release and local browser:** supply the Desktop OAuth JSON or
  its `client_secret` using `QUIET_SCREEN_GOOGLE_DESKTOP_CLIENT_SECRET`. If it
  contains only the raw secret, also set the public client ID in
  `QUIET_SCREEN_GOOGLE_DESKTOP_CLIENT_ID`. Run
  `node scripts/configure-desktop.mjs` before building Windows. The local web
  server can read that generated file or the environment directly. Windows
  uses the system browser, a temporary loopback callback, and OS-encrypted
  token storage. The local browser uses `http://127.0.0.1:4178/api/account/callback`
  and an encrypted HttpOnly session cookie.
- **Hosted web:** set `QUIET_SCREEN_GOOGLE_WEB_CLIENT_SECRET` at server runtime
  using Web OAuth JSON or the raw secret plus
  `QUIET_SCREEN_GOOGLE_WEB_CLIENT_ID`. Set `QUIET_SCREEN_PUBLIC_ORIGIN` to the
  exact HTTPS origin and `QUIET_SCREEN_SESSION_KEY` to 32 random bytes encoded
  as Base64. Register `<origin>/api/account/callback` on the Web client. Pass the
  public Host header through the HTTPS reverse proxy. Keep the Web secret on
  the server. It is excluded from the Windows build and browser assets.
- **GitHub Actions:** the Windows workflow reads the two repository secrets
  named above and the matching optional client ID variables. It checks each
  configured client pair with Google, then builds the Windows installer with
  Desktop configuration. GitHub Actions secrets do not configure a running
  local or hosted web server.

Run `node --test` for the merge, OAuth and Drive fixture tests.

## License

Apache License 2.0. See [LICENSE](LICENSE) and [NOTICE](NOTICE).

## App updates and library views

Open **Account → App updates** for the installed version, last check, and
automatic-check preference. Automatic checks pause while offline or on a
metered connection. On Windows, choose **Download update** to verify and save
an installer, then **Restart and update** when ready. The progress card and
Windows taskbar show download progress. While GitHub requires sign-in to access
releases, use the **GitHub Releases** link to install manually. The local web
app checks for releases and opens GitHub for downloads.

**Library insights** shows current watch-status counts and completed viewings
by month. Undated history is counted separately. **Library display** controls
grouped and plain views, group visibility, and expanding or collapsing groups.
The selected sort and display controls are remembered on the device. The
details panel offers Overview, Viewing history, and Episodes where applicable.
