import { app, BrowserWindow, Menu, protocol, session, shell } from 'electron'
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

function openIMDb(value) {
  const url = new URL(value)
  if (url.origin === 'https://www.imdb.com' && !url.username && !url.password) {
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
    openIMDb(url)
    return { action: 'deny' }
  })
  window.webContents.on('will-navigate', (event, url) => {
    if (url === appURL) return
    event.preventDefault()
    openIMDb(url)
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
    protocol.handle(scheme, request => {
      const url = new URL(request.url)
      if (url.host !== 'app' || url.username || url.password) return new Response(null, { status: 403 })
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
