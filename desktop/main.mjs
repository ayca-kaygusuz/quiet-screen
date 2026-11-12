import { createGoogleAccount } from './google-account.mjs'
import { app, BrowserWindow, Menu, protocol, safeStorage, session, shell } from 'electron'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { serveApp } from '../app-response.mjs'

const scheme = 'quiet-screen'
const appURL = scheme + '://app/'
app.setName('Quiet Screen')
const profile = join(app.getPath('appData'), app.getName())
mkdirSync(profile, { recursive: true })
app.setPath('userData', profile)
protocol.registerSchemesAsPrivileged([{
  scheme, privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true },
}])

let window

function openExternalLink(value) {
  const url = new URL(value)
  if (!url.username && !url.password && (url.origin === 'https://www.imdb.com' || url.href === 'https://www.apache.org/licenses/LICENSE-2.0')) {
    void shell.openExternal(url.href).catch(console.error)
  }
}

function createWindow() {
  window = new BrowserWindow({
    width: 1160, height: 850, minWidth: 420, minHeight: 500,
    show: false, backgroundColor: '#17181d', autoHideMenuBar: true,
    webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true },
  })
  window.webContents.setWindowOpenHandler(({ url }) => {
    openExternalLink(url)
    return { action: 'deny' }
  })
  window.webContents.on('will-navigate', (event, url) => {
    if (url === appURL) return
    event.preventDefault()
    openExternalLink(url)
  })
  window.once('ready-to-show', () => window?.show())
  window.on('closed', () => { window = null })
  return window.loadURL(appURL)
}

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (!window) return
    if (window.isMinimized()) window.restore()
    window.focus()
  })
  app.on('window-all-closed', () => app.quit())
  app.whenReady().then(() => {
    app.setAppUserModelId('com.quietscreen.desktop')
    const account = createGoogleAccount({
      profile, safeStorage, openExternal: url => shell.openExternal(url),
      defaultClientId: app.isPackaged ? '' : process.env.QUIET_SCREEN_GOOGLE_DESKTOP_CLIENT_ID,
      defaultClientSecret: app.isPackaged ? '' : process.env.QUIET_SCREEN_GOOGLE_DESKTOP_CLIENT_SECRET,
    })
    app.on('before-quit', account.dispose)
    protocol.handle(scheme, async request => {
      const url = new URL(request.url)
      if (url.host !== 'app' || url.username || url.password) return new Response(null, { status: 403 })
      if (url.pathname.startsWith('/api/account/')) {
        const origin = request.headers.get('Origin')
        if ((origin && origin !== appURL.slice(0, -1) && origin !== 'null') ||
            (request.method === 'POST' && request.headers.get('X-Quiet-Screen-Account') !== '1')) {
          return new Response(null, { status: 403 })
        }
        const response = await account.handle(request)
        response.headers.set('Cache-Control', 'no-store')
        return response
      }
      return serveApp(url, request.method)
    })
    const profileSession = session.defaultSession
    profileSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false))
    profileSession.setPermissionCheckHandler(() => false)
    profileSession.on('will-download', (event, item, contents) => {
      if (contents !== window?.webContents || !item.getURL().startsWith('blob:' + appURL)) {
        event.preventDefault()
        return
      }
      item.setSaveDialogOptions({
        title: 'Back up Quiet Screen', defaultPath: item.getFilename(),
        filters: [{ name: 'Quiet Screen backup', extensions: ['json'] }],
      })
    })
    Menu.setApplicationMenu(Menu.buildFromTemplate([
      { label: 'File', submenu: [{ role: 'quit' }] },
      { label: 'Edit', submenu: [{ role: 'undo' }, { role: 'redo' }, { type: 'separator' }, { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }] },
      { label: 'View', submenu: [{ role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }, { role: 'togglefullscreen' }] },
    ]))
    return createWindow()
  }).catch(error => {
    console.error('Quiet Screen could not start:', error)
    app.exit(1)
  })
}
