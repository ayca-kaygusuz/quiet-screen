import { createServer } from 'node:http'
import { serveApp } from './app-response.mjs'

export function createAppServer(request = fetch) {
  return createServer(async (req, res) => {
    try {
      const response = await serveApp(new URL(req.url, 'http://localhost'), req.method, request)
      const body = Buffer.from(await response.arrayBuffer())
      res.writeHead(response.status, {
        ...Object.fromEntries(response.headers),
        'X-Content-Type-Options': 'nosniff',
        'Cache-Control': 'no-store',
      }).end(body)
    } catch {
      res.writeHead(500).end()
    }
  })
}

if (import.meta.main) {
  const port = Number(process.env.QUIET_SCREEN_PORT || 4178)
  createAppServer().listen(port, '127.0.0.1', () => console.log('Quiet Screen is at http://127.0.0.1:' + port))
}
