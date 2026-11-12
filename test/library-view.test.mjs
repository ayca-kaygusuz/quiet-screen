import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createBrowserReleaseHandler } from '../releases.mjs'
import { sortTitles, viewingInsights } from '../library.mjs'

test('a release that requires sign-in gets a manual fallback', async () => {
  const handler = createBrowserReleaseHandler({ fetcher: async () => new Response(null, { status: 404 }) })
  const result = await handler(new Request('http://127.0.0.1:4178/api/update-check'))
  assert.equal((await result.json()).phase, 'unavailable')
})

test('insights count dated rewatches and keep unknown dates outside the chart', () => {
  const undated = { title: 'Part 2', history: [{ finished: null }], active: null }
  const dated = { title: 'Part 10', history: [{ finished: '2026-11-12' }, { finished: '2026-10-12' }], active: { started: '2026-11-15' } }
  const result = viewingInsights([undated, dated], new Date(2026, 10, 18))
  assert.equal(result.counts.Watched, 1)
  assert.equal(result.counts.Rewatching, 1)
  assert.equal(result.undated, 1)
  assert.deepEqual(result.months.slice(-2).map(month => month.count), [1, 1])
  assert.deepEqual(sortTitles([dated, undated], 'title'), [undated, dated])
  assert.deepEqual(sortTitles([undated, dated], 'watched'), [dated, undated])
})
