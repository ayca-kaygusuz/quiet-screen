import { readFile } from 'node:fs/promises'
import { imdbId } from './library.mjs'

const assets = new Map([
  ['/', ['index.html', 'text/html']],
  ['/style.css', ['style.css', 'text/css']],
  ['/app.mjs', ['app.mjs', 'text/javascript']],
  ['/library.mjs', ['library.mjs', 'text/javascript']],
])

const formats = new Map(Object.entries({
  movie: 'Movie', tvSeries: 'TV series', tvMiniSeries: 'Miniseries', tvEpisode: 'Episode',
  short: 'Short', tvShort: 'Short', tvMovie: 'TV movie', tvSpecial: 'Special', video: 'Video',
}))

async function lookup(query, request) {
  if (query.length < 2 || query.length > 150) return Response.json([], { status: 400 })
  const id = imdbId(query)
  try {
    const upstream = await request('https://v3.sg.media-imdb.com/suggestion/x/' +
      encodeURIComponent(id || query.toLowerCase()) + '.json', { signal: AbortSignal.timeout(8000) })
    if (!upstream.ok) throw new Error('IMDb request failed')
    const data = await upstream.json()
    return Response.json((data.d ?? [])
      .filter(item => /^tt\d{7,}$/.test(item.id) && typeof item.l === 'string' && (!id || item.id === id))
      .slice(0, 12)
      .map(item => ({
        imdb: item.id, title: item.l, format: formats.get(item.qid) ?? 'Other',
        year: Number.isInteger(item.y) ? String(item.y) : '',
      })))
  } catch {
    return Response.json([], { status: 502 })
  }
}

export async function serveApp(url, method, request = fetch) {
  if (method !== 'GET') return new Response(null, { status: 405 })
  if (url.pathname === '/api/imdb') return lookup((url.searchParams.get('q') ?? '').trim(), request)
  const asset = assets.get(url.pathname)
  if (!asset) return new Response(null, { status: 404 })
  try {
    const body = await readFile(new URL(asset[0], import.meta.url))
    return new Response(body, { headers: {
      'Content-Type': asset[1] + '; charset=utf-8',
      'Content-Security-Policy': "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
      'Referrer-Policy': 'no-referrer',
    } })
  } catch {
    return new Response(null, { status: 500 })
  }
}
