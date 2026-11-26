import {imdbId,validPoster} from './library.mjs'

const formats = new Map(Object.entries({
  movie: 'Movie', tvSeries: 'TV series', tvMiniSeries: 'Miniseries', tvEpisode: 'Episode',
  short: 'Short', tvShort: 'Short', tvMovie: 'TV movie', tvSpecial: 'Special', video: 'Video',
}))

export async function lookup(query, request) {
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
        poster: validPoster(item.i?.imageUrl) ? item.i.imageUrl : '',
      })))
  } catch {
    return Response.json([], { status: 502 })
  }
}
