import assert from 'node:assert/strict'
import { test } from 'node:test'
import { nextEpisode, seriesGroups, start, validLibrary, validLists } from '../library.mjs'
import { reconcileDrive } from '../sync/drive.mjs'

const sync = globalThis.QuietScreenSync
const title = {
  id: 'series', title: 'The Show', format: 'TV series', year: '2025', imdb: '',
  order: 'legacy-00000000', group: { mode: 'auto', name: '' }, episodic: true,
  active: null, history: [{ id: 'legacy-00000000', started: null, finished: null }], episodes: [],
}
const list = { id: 'watch-together', name: 'Watch together', members: ['series'] }
const doc = (library = [title], lists = [list]) => ({ library, lists, preferences: { theme: 'sage' } })
const event = (id, episode, run = null) => ({ id, season: 1, episode, name: '', date: null, run })

test('concurrent episode viewings and independent list membership merge', () => {
  const other = { ...title, id: 'movie', title: 'The Show Part II', episodic: false, history: [] }
  const initial = sync.update(sync.empty(), doc([title, other]), 'initial')
  const a = sync.update(initial, doc([{ ...title, episodes: [event('a1', 1)] }, other]), 'a')
  const b = sync.update(initial, doc([{ ...title, episodes: [event('b1', 2)] }, other], [
    { ...list, members: ['series', 'movie'] },
  ]), 'b')
  const result = sync.project(sync.merge(a, b))
  assert.ok(validLibrary(result.library))
  assert.ok(validLists(result.lists))
  assert.deepEqual(result.library.find(item => item.id === 'series').episodes, [event('a1', 1), event('b1', 2)])
  assert.deepEqual(result.lists[0].members, ['movie', 'series'])
  assert.deepEqual(nextEpisode(result.library.find(item => item.id === 'series').episodes), { season: 1, episode: 3 })
  assert.equal(result.library.find(item => item.id === 'series').history[0].finished, null)
})

test('first combine preserves queued franchise order, custom lists, and local theme', () => {
  const other = { ...title, id: 'movie', title: 'The Show Part II' }
  const rewatch = { id: 'queue', name: 'The Show rewatch', members: ['series', 'movie'],
    rewatch: { group: 'the show', baseline: [1, 0] } }
  const remote = sync.update(sync.empty(), { library: [other], lists: [], preferences: { theme: 'tide' } }, 'remote')
  const current = start(title, '2026-11-12')
  const merged = sync.project(sync.connectLibrary(remote, doc([current], [list, rewatch]), 'local'))
  assert.equal(merged.preferences.theme, 'sage')
  assert.equal(merged.library.find(item => item.id === 'series').active.id, current.active.id)
  assert.deepEqual(merged.lists.find(item => item.id === 'queue'), rewatch)
  assert.equal(merged.lists.find(item => item.id === list.id).name, list.name)
  assert.equal(seriesGroups(merged.library).get('movie').key, 'the show')
})

test('offline deletions persist and concurrent field choices remain reviewable', () => {
  const initial = sync.update(sync.empty(), doc(), 'initial')
  const removed = sync.update(initial, doc([], []), 'remove')
  assert.equal(sync.project(sync.merge(initial, removed)).library.length, 0)
  assert.equal(sync.project(sync.merge(initial, removed)).lists.length, 0)
  const left = sync.update(initial, doc([{ ...title, title: 'The Show A' }]), 'left')
  const right = sync.update(initial, doc([{ ...title, title: 'The Show B' }]), 'right')
  const merged = sync.merge(left, right)
  const conflict = sync.project(merged).conflicts.find(item => item.parts[3] === 'title')
  assert.deepEqual(new Set(conflict.choices), new Set(['The Show A', 'The Show B']))
  const resolved = sync.resolve(merged, conflict.key, conflict.choices.indexOf('The Show B'), 'resolve')
  assert.equal(sync.project(sync.merge(resolved, left)).library[0].title, 'The Show B')
})

test('Drive preview is read-only and a failed checkpoint leaves prior copies intact', async () => {
  const initial = sync.update(sync.empty(), doc(), 'initial')
  const local = sync.update(initial, doc([{ ...title, episodes: [event('a1', 1)] }]), 'edit')
  const store = {
    async list() { return [{ id: 'old', version: '1' }] },
    async read() { return initial },
    async create() { throw new Error('write failed') },
    async remove() { assert.fail('Must not remove a prior copy') },
  }
  assert.equal((await reconcileDrive({ state: sync.empty(), store, readOnly: true })).state.registers.length, initial.registers.length)
  await assert.rejects(reconcileDrive({ state: local, store }), /write failed/)
})

test('automatic grouping can be overridden and episode numbering starts at S1 E1', () => {
  const sequel = { ...title, id: 'sequel', title: 'The Show: Return' }
  const manual = { ...title, id: 'manual', title: 'Spin-off', group: { mode: 'manual', name: 'The Show' } }
  const standalone = { ...sequel, id: 'standalone', group: { mode: 'none', name: '' } }
  const groups = seriesGroups([title, sequel, manual, standalone])
  assert.deepEqual(groups.get('series').members, ['series', 'sequel', 'manual'])
  assert.equal(groups.has('standalone'), false)
  assert.deepEqual(nextEpisode([]), { season: 1, episode: 1 })
})

test('Drive reports setup, permission and policy denials without exposing Google response details', async () => {
  const { createDriveStore } = await import('../sync/drive.mjs')
  const cases = [
    [{ details: [{ reason: 'SERVICE_DISABLED' }] }, 'DRIVE_API_DISABLED'],
    [{ errors: [{ reason: 'accessNotConfigured' }] }, 'DRIVE_API_DISABLED'],
    [{ details: [{ reason: 'ACCESS_TOKEN_SCOPE_INSUFFICIENT' }] }, 'SIGN_IN_REQUIRED'],
    [{ errors: [{ reason: 'insufficientPermissions' }] }, 'SIGN_IN_REQUIRED'],
    [{ errors: [{ reason: 'domainPolicy' }] }, 'DRIVE_POLICY'],
    [{ errors: [{ reason: 'userRateLimitExceeded' }] }, 'DRIVE_UNAVAILABLE'],
  ]
  for (const [error, code] of cases) {
    const store = createDriveStore({
      accessToken: async () => 'test-only',
      fetcher: async () => Response.json({ error: { ...error, message: 'private upstream detail' } }, { status: 403 }),
    })
    await assert.rejects(store.list(), failure => failure.code === code && !failure.message.includes('private upstream detail'))
  }
})
