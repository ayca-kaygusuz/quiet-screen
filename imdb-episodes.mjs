import { createReadStream, createWriteStream } from 'node:fs'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { createGunzip } from 'node:zlib'
import { createInterface } from 'node:readline'
import { validSeasons } from './library.mjs'

export const EPISODE_DATASET = 'https://datasets.imdbws.com/title.episode.tsv.gz'
const week = 7 * 86400000

export async function indexEpisodeRows(lines) {
  const index = Object.create(null)
  let header = true
  for await (const line of lines) {
    if (header) {
      if (line.trim() !== 'tconst\tparentTconst\tseasonNumber\tepisodeNumber') throw Error('IMDb episode format changed.')
      header = false
      continue
    }
    const [id, parent, seasonText, episodeText] = line.split('\t')
    if (!/^tt\d{7,}$/.test(id) || !/^tt\d{7,}$/.test(parent) ||
        !/^\d{1,4}$/.test(seasonText) || !/^\d{1,5}$/.test(episodeText)) continue
    const season = Number(seasonText)
    const episode = Number(episodeText)
    if (!episode) continue
    const seasons = index[parent] ??= Object.create(null)
    seasons[season] = Math.max(seasons[season] ?? 0, episode)
  }
  if (header) throw Error('IMDb returned an empty episode dataset.')
  return Object.fromEntries(Object.entries(index).map(([id, seasons]) => [id,
    Object.entries(seasons).map(([season, count]) => ({ season: Number(season), count }))]))
}

export function createImdbEpisodeCatalog({ directory, fetcher = fetch, clock = Date.now }) {
  let pending
  let cached
  const indexPath = join(directory, 'episodes-v1.json')

  async function load() {
    if (cached && clock() - cached.checkedAt < week) return cached
    try {
      const saved = JSON.parse(await readFile(indexPath, 'utf8'))
      if (saved.version === 1 && Number.isFinite(saved.checkedAt) && saved.checkedAt <= clock() &&
          clock() - saved.checkedAt < week && saved.titles && typeof saved.titles === 'object') {
        cached = saved
        return cached
      }
    } catch { /* A missing or damaged cache is rebuilt from IMDb. */ }
    await mkdir(directory, { recursive: true })
    const temporary = join(directory, 'episodes-' + crypto.randomUUID())
    try {
      const response = await fetcher(EPISODE_DATASET, { signal: AbortSignal.timeout(180000), redirect: 'error' })
      if (!response.ok || !response.body) throw Error('IMDb episode download failed.')
      let bytes = 0
      await pipeline(Readable.fromWeb(response.body), async function* (chunks) {
        for await (const chunk of chunks) {
          bytes += chunk.length
          if (bytes > 150 * 1024 * 1024) throw Error('IMDb episode download exceeded its size limit.')
          yield chunk
        }
      }, createWriteStream(temporary, { flags: 'wx', mode: 0o600 }))
      const stream = createReadStream(temporary)
      const decoded = stream.pipe(createGunzip())
      stream.on('error', error => decoded.destroy(error))
      const lines = createInterface({ input: decoded, crlfDelay: Infinity })
      decoded.on('error', () => lines.close())
      let decodeError
      decoded.on('error', error => { decodeError = error })
      let titles
      try {
        titles = await indexEpisodeRows(lines)
        if (decodeError) throw decodeError
      } finally {
        lines.close()
        decoded.destroy()
        stream.destroy()
      }
      if (!Object.keys(titles).length) throw Error('IMDb returned no numbered episodes.')
      const next = { version: 1, checkedAt: clock(), titles }
      await writeFile(temporary + '.json', JSON.stringify(next), { mode: 0o600 })
      await rename(temporary + '.json', indexPath)
      cached = next
      return next
    } finally {
      await rm(temporary, { force: true })
      await rm(temporary + '.json', { force: true })
    }
  }

  return async function (id) {
    if (!/^tt\d{7,}$/.test(id)) throw Error('Invalid IMDb title ID.')
    if (!pending) pending = load().finally(() => { pending = null })
    const data = await pending
    const seasons = data.titles[id] ?? []
    if (!validSeasons(seasons)) throw Error('IMDb returned invalid episode information.')
    return { imdb: id, seasons, checkedAt: data.checkedAt }
  }
}

export async function episodeResponse(url, catalog) {
  const id = url.searchParams.get('id') ?? ''
  if (!/^tt\d{7,}$/.test(id)) return Response.json({ error: 'Invalid IMDb title ID.' }, { status: 400 })
  try {
    return Response.json(await catalog(id), { headers: { 'Cache-Control': 'no-store' } })
  } catch {
    return Response.json({ error: 'IMDb episode information could not be loaded. Try again when online.' }, { status: 502 })
  }
}
