import { readFile } from 'node:fs/promises'
import {lookup} from './catalogue.mjs'

const assets = new Map([
  ['/', ['index.html', 'text/html']],
  ['/style.css', ['style.css', 'text/css']],
  ['/app.mjs', ['app.mjs', 'text/javascript']],
  ['/update-ui.mjs', ['update-ui.mjs', 'text/javascript']],
  ['/library.mjs', ['library.mjs', 'text/javascript']],
  ['/franchises.mjs', ['franchises.mjs', 'text/javascript']],
  ['/sync/sync-core.js', ['sync/sync-core.js', 'text/javascript']],
  ['/sync/account.js', ['sync/account.js', 'text/javascript']],
  ['/license.txt', ['LICENSE', 'text/plain']],
  ['/NOTICE', ['NOTICE', 'text/plain']],
  ['/THIRD_PARTY_NOTICES.md', ['THIRD_PARTY_NOTICES.md', 'text/plain']],
])

export async function serveApp(url, method, request = fetch) {
  if (method !== 'GET') return new Response(null, { status: 405 })
  if (url.pathname === '/api/imdb') return lookup((url.searchParams.get('q') ?? '').trim(), request)
  const asset = assets.get(url.pathname)
  if (!asset) return new Response(null, { status: 404 })
  try {
    const body = await readFile(new URL(asset[0], import.meta.url))
    return new Response(body, { headers: {
      'Content-Type': asset[1] + '; charset=utf-8',
      'Content-Security-Policy': "default-src 'none'; script-src 'self'; style-src 'self'; img-src https://m.media-amazon.com; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
      'Referrer-Policy': 'no-referrer',
    } })
  } catch {
    return new Response(null, { status: 500 })
  }
}
