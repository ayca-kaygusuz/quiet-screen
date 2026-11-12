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
