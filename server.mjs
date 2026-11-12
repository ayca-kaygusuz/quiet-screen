import { createServer } from 'node:http'
import { randomBytes } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { serveApp } from './app-response.mjs'
import { googleDesktopConfiguration } from './sync/google-oauth.mjs'
import { createWebAccount } from './sync/web-account.mjs'

const privateDir = new URL('./private/', import.meta.url)
const sessionFile = new URL('browser-session.key', privateDir)
const maxAccountBytes = 10 * 1024 * 1024 + 2048

function desktopClient(environment) {
  try {
    if (environment.QUIET_SCREEN_GOOGLE_DESKTOP_CLIENT_SECRET) {
      return googleDesktopConfiguration({
        clientId: environment.QUIET_SCREEN_GOOGLE_DESKTOP_CLIENT_ID,
        credentialValue: environment.QUIET_SCREEN_GOOGLE_DESKTOP_CLIENT_SECRET,
      })
    }
    const saved = JSON.parse(readFileSync(new URL('./desktop/google-client.generated.json', import.meta.url), 'utf8'))
    return googleDesktopConfiguration({ clientId: saved.clientId, credentialValue: saved.clientSecret })
  } catch {
    return undefined
  }
}

function localSessionKey() {
  mkdirSync(privateDir, { recursive: true })
  try {
    writeFileSync(sessionFile, randomBytes(32).toString('base64'), { flag: 'wx', mode: 0o600 })
  } catch (error) {
    if (error.code !== 'EEXIST') throw error
  }
  return readFileSync(sessionFile, 'utf8').trim()
}

export function createAppServer(request = fetch, environment = process.env) {
  const desktopConfiguration = desktopClient(environment)
  const publicOrigin = environment.QUIET_SCREEN_PUBLIC_ORIGIN
  if (publicOrigin && (new URL(publicOrigin).origin !== publicOrigin || !publicOrigin.startsWith('https://'))) {
    throw new Error('QUIET_SCREEN_PUBLIC_ORIGIN must be an exact HTTPS origin.')
  }
  const sessionKey = environment.QUIET_SCREEN_SESSION_KEY ??
    (!publicOrigin && (desktopConfiguration || environment.QUIET_SCREEN_GOOGLE_WEB_CLIENT_SECRET) ? localSessionKey() : undefined)
  const account = createWebAccount(environment, { desktopConfiguration, sessionKey, fetcher: request })

  return createServer(async (req, res) => {
    try {
      const port = req.socket?.localPort
      const origin = publicOrigin ?? 'http://127.0.0.1' + (port && port !== 80 ? ':' + port : '')
      const url = new URL(req.url, origin)
      if (url.origin !== origin) return res.writeHead(403).end()
      let response
      if (url.pathname.startsWith('/api/account/')) {
        if (req.headers.host !== url.host) return res.writeHead(403).end()
        const chunks = []
        if (req.method === 'POST') {
          let size = 0
          for await (const chunk of req) {
            size += chunk.length
            if (size > maxAccountBytes) return res.writeHead(413).end()
            chunks.push(chunk)
          }
        }
        response = await account.handle(new Request(url, {
          method: req.method, headers: req.headers,
          ...(req.method === 'POST' ? { body: Buffer.concat(chunks) } : {}),
        }))
      } else {
        response = await serveApp(url, req.method, request)
      }
      const headers = Object.fromEntries(response.headers)
      const cookies = response.headers.getSetCookie()
      if (cookies.length) headers['set-cookie'] = cookies
      res.writeHead(response.status, {
        ...headers,
        'X-Content-Type-Options': 'nosniff',
        'Cache-Control': 'no-store',
      }).end(Buffer.from(await response.arrayBuffer()))
    } catch {
      res.writeHead(500).end()
    }
  })
}

if (import.meta.main) {
  const port = Number(process.env.QUIET_SCREEN_PORT || 4178)
  createAppServer().listen(port, '127.0.0.1', () => console.log('Quiet Screen is at http://127.0.0.1:' + port))
}
