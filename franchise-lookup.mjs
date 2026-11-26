import { franchiseRelations, validFranchiseCheck } from './franchises.mjs'
import { limitedJSON } from './sync/drive.mjs'

export const FRANCHISE_ENDPOINT = 'https://query-next.wikidata.org/sparql'
const entityId = value => typeof value === 'string' ? /^https?:\/\/www\.wikidata\.org\/entity\/(Q\d+)$/.exec(value)?.[1] : null
const propertyId = value => typeof value === 'string' ? /^https?:\/\/www\.wikidata\.org\/prop\/direct\/(P\d+)$/.exec(value)?.[1] : null

export async function lookupFranchises(ids, { fetcher = fetch, clock = () => new Date() } = {}) {
  if (!Array.isArray(ids) || ids.length < 1 || ids.length > 30 || ids.some(id => typeof id !== 'string' || !/^tt\d{7,}$/.test(id))) {
    throw Error('Choose between 1 and 30 IMDb titles.')
  }
  const unique = [...new Set(ids)]
  const query = `SELECT ?item ?imdb ?relation ?target ?label WHERE {
    VALUES ?imdb { ${unique.map(id => '"' + id + '"').join(' ')} }
    ?item wdt:P345 ?imdb . OPTIONAL {
      VALUES ?relation { ${franchiseRelations.map(id => 'wdt:' + id).join(' ')} }
      ?item ?relation ?target .
      OPTIONAL { ?target rdfs:label ?label FILTER(LANG(?label)="en") }
    }
  } LIMIT 5001`
  const url = new URL(FRANCHISE_ENDPOINT)
  url.search = new URLSearchParams({ query, format: 'json' })
  const response = await fetcher(url.href, { redirect: 'error', signal: AbortSignal.timeout(45000), headers: {
    Accept: 'application/sparql-results+json',
    'User-Agent': 'QuietScreen/0.6 (https://github.com/ayca-kaygusuz/quiet-screen)',
  } })
  if (!response.ok) throw Error(response.status === 429 ? 'The lookup service is busy. Try again later.' : 'Franchise lookup is unavailable. Try again later.')
  const data = await limitedJSON(response, 2 * 1024 * 1024)
  const rows = data?.results?.bindings
  if (!Array.isArray(rows) || rows.length >= 5001) throw Error('The lookup returned incomplete or invalid results.')
  const checkedAt = clock().toISOString()
  const results = new Map(unique.map(imdb => [imdb, { imdb, checkedAt, entity: null, links: [] }]))
  for (const row of rows) {
    const result = results.get(row.imdb?.value)
    const entity = entityId(row.item?.value)
    if (!result || !entity || result.entity && result.entity !== entity) throw Error('The title match is ambiguous. Try again later.')
    result.entity = entity
    if (!row.relation && !row.target) continue
    const relation = propertyId(row.relation?.value)
    const id = entityId(row.target?.value)
    if (!franchiseRelations.includes(relation) || !id) throw Error('The lookup returned an invalid connection.')
    if (!result.links.some(link => link.id === id && link.relation === relation)) {
      result.links.push({ id, relation, label: String(row.label?.value ?? '').slice(0, 300) })
    }
  }
  if (![...results.values()].every(validFranchiseCheck)) throw Error('The lookup returned too many connections.')
  return [...results.values()]
}

export async function franchiseResponse(request, options) {
  const url = new URL(request.url)
  const origin = request.headers.get('Origin')
  const expected = url.protocol === 'quiet-screen:' ? 'quiet-screen://app' : url.origin
  if (request.method !== 'POST') return Response.json({ error: 'Method not allowed.' }, { status: 405 })
  if (request.headers.get('X-Quiet-Screen-Catalogue') !== '1' || origin && origin !== expected && !(url.protocol === 'quiet-screen:' && origin === 'null')) {
    return Response.json({ error: 'Invalid lookup request.' }, { status: 403 })
  }
  try {
    const body = await limitedJSON(request, 8192)
    const results = await lookupFranchises(body.ids, options)
    return Response.json({ results }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    return Response.json({ error: error.message }, { status: 400 })
  }
}
