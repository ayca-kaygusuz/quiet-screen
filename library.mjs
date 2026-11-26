import {validFranchiseCheck} from './franchises.mjs'
export const statuses = ['Watchlist', 'Watching', 'Watched', 'Rewatching']

export function today() {
  const now = new Date()
  return [now.getFullYear(), now.getMonth() + 1, now.getDate()]
    .map(value => String(value).padStart(2, '0')).join('-')
}

export function imdbId(value) {
  const input = value.trim()
  if (/^tt\d{7,}$/.test(input)) return input
  try {
    const url = new URL(input)
    if (!['http:', 'https:'].includes(url.protocol) || !['imdb.com', 'www.imdb.com', 'm.imdb.com'].includes(url.hostname)) return ''
    return url.pathname.match(/^\/title\/(tt\d{7,})(?:\/|$)/)?.[1] ?? ''
  } catch {
    return ''
  }
}

export function status(title) {
  if (title.active) return title.history.length ? 'Rewatching' : 'Watching'
  return title.history.length ? 'Watched' : 'Watchlist'
}

export function start(title, date = today()) {
  return title.active ? title : { ...title, active: { started: date, id: crypto.randomUUID() } }
}

export function saveViewing(title, mode, viewing, index) {
  const history = [...title.history]
  if (mode === 'edit') history[index] = { ...history[index], ...viewing }
  else history.push({ ...viewing, ...(mode === 'finish' && title.active?.id ? { run: title.active.id } : {}) })
  return completeSeriesEpisodes({ ...title, history, active: mode === 'finish' ? null : title.active })
}

export function validDate(date) {
  if (date === null) return true
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false
  const parsed = new Date(date)
  return !Number.isNaN(+parsed) && parsed.toISOString().slice(0, 10) === date
}

export function validLibrary(titles) {
  if (!Array.isArray(titles)) return false
  const ids = new Set()
  return titles.every(title => {
    if (!title || typeof title.id !== 'string' || !title.id || ids.has(title.id)) return false
    ids.add(title.id)
    return ['title', 'format'].every(key => typeof title[key] === 'string' && title[key].trim()) &&
      typeof title.year === 'string' && /^(\d{4})?$/.test(title.year) &&
      typeof title.imdb === 'string' && /^(tt\d{7,})?$/.test(title.imdb) &&
      (title.group === undefined || validGroup(title.group)) &&
      (title.franchiseCheck === undefined || validFranchiseCheck(title.franchiseCheck)) &&
      (title.episodic === undefined || typeof title.episodic === 'boolean') &&
      (title.episodes === undefined || validEpisodes(title.episodes)) &&
      (title.seasons === undefined || validSeasons(title.seasons)) &&
      (title.active === null || !!title.active && validDate(title.active.started) && (title.active.id === undefined || typeof title.active.id === 'string' && title.active.id.length <= 100)) &&
      Array.isArray(title.history) && new Set(title.history.map((view, index) => view?.id ?? 'legacy-' + String(index).padStart(8, '0'))).size === title.history.length && title.history.every(view =>
        !!view && (view.id === undefined || typeof view.id === 'string' && /^[a-zA-Z0-9_-]{1,200}$/.test(view.id)) && validDate(view.started) && validDate(view.finished) &&
        (!view.started || !view.finished || view.started <= view.finished) && validCompletion(view))
  })
}

export function isEpisodic(format) {
  return /\b(series|miniseries|show|serial|sitcom|anime|soap)\b/i.test(format)
}

export function validGroup(group) {
  return Boolean(group && ['auto', 'manual', 'none'].includes(group.mode) &&
    typeof group.name === 'string' && group.name.length <= 120 &&
    (group.id === undefined || typeof group.id === 'string' && /^[a-zA-Z0-9_-]{1,100}$/.test(group.id)) &&
    (group.mode !== 'manual' || group.name.trim()))
}

export function validEpisode(view) {
  return Boolean(view && typeof view.id === 'string' && /^[a-zA-Z0-9_-]{1,100}$/.test(view.id) &&
    Number.isInteger(view.season) && view.season >= 0 && view.season <= 9999 &&
    Number.isInteger(view.episode) && view.episode >= 1 && view.episode <= 99999 &&
    typeof view.name === 'string' && view.name.length <= 300 && validDate(view.date) && (view.run === undefined || view.run === null || typeof view.run === 'string' && view.run.length <= 100) &&
    (view.completion === undefined || typeof view.completion === 'string' && /^[a-zA-Z0-9_-]{1,100}$/.test(view.completion)) &&
    (view.inferred === undefined || typeof view.inferred === 'boolean'))
}

function validEpisodes(episodes) {
  return Array.isArray(episodes) && episodes.every(validEpisode) &&
    new Set(episodes.map(view => view.id)).size === episodes.length
}

function groupKey(name) {
  return name.normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase()
}

function inferredGroup(title) {
  const season = title.match(/^(.+?)\s*(?:[·:–—-]\s*)?\b(?:season|series|part|chapter|volume)\s+(?:\d+|[IVXLCDM]+)\b(?:\s*[:–—-].*)?$/i)
  const sequel = title.match(/^(.+?)\s+(?:[2-9]|1\d|II|III|IV|VI?I?I?|IX|X)(?:\s*[:–—-].*)?$/i)
  const subtitle = title.match(/^(.{3,}?)\s*:\s+\S/)
  const name = (season?.[1] ?? sequel?.[1] ?? subtitle?.[1] ?? title).trim()
  return name.length <= 120 ? name : ''
}

function relatedGroupName(name, names) {
  const qualifiers = /^(?:future|returns|origins|legacy|revival|reunion|the (?:movie|film|series|animated series)|a new (?:generation|era))(?:\s|$)/i
  // A sequel qualifier only counts when its complete base title is present.
  // Prefer the closest base, so nested franchises keep their own groups.
  let current = name
  for (;;) {
    const key = groupKey(current)
    const base = names.filter(candidate => {
      const baseKey = groupKey(candidate)
      if (baseKey === key || baseKey.split(' ').length < 2 || baseKey.length < 8) return false
      if (!key.startsWith(baseKey + ' ')) return false
      return qualifiers.test(key.slice(baseKey.length).trim())
    }).sort((a, b) => b.length - a.length)[0]
    if (!base) return current
    current = base
  }
}

export function seriesGroups(library) {
  const names = library.filter(title => (title.group?.mode ?? 'auto') !== 'none')
    .map(title => title.group?.mode === 'manual' ? title.group.name.trim() : inferredGroup(title.title))
    .filter(Boolean)
  const candidates = new Map()
  for (const title of library) {
    const mode = title.group?.mode ?? 'auto'
    if (mode === 'none') continue
    const name = mode === 'manual' ? title.group.name.trim() : relatedGroupName(inferredGroup(title.title), names)
    if (!name) continue
    const key = mode === 'manual' && title.group.id ? 'bundle:' + title.group.id : groupKey(name)
    const group = candidates.get(key) ?? { key, id: mode === 'manual' ? title.group.id : undefined, name, members: [], explicit: false }
    if (mode === 'manual' && !group.explicit) {
      group.name = name
      group.explicit = true
    }
    group.members.push(title.id)
    candidates.set(key, group)
  }
  const byTitle = new Map()
  for (const group of candidates.values()) {
    if (group.explicit || group.members.length > 1) {
      for (const id of group.members) byTitle.set(id, group)
    }
  }
  return byTitle
}

export function validLists(lists) {
  if (!Array.isArray(lists) || lists.length > 1000) return false
  return new Set(lists.map(list => list?.id)).size === lists.length && lists.every(list =>
    list && typeof list.id === 'string' && /^[a-zA-Z0-9_-]{1,100}$/.test(list.id) &&
    typeof list.name === 'string' && list.name.trim() && list.name.length <= 120 &&
    Array.isArray(list.members) && new Set(list.members).size === list.members.length &&
    list.members.every(id => typeof id === 'string' && id.length > 0 && id.length <= 1000) &&
    (list.rewatch === undefined || Boolean(list.rewatch && typeof list.rewatch.group === 'string' &&
      list.rewatch.group.length <= 500 && Array.isArray(list.rewatch.baseline) &&
      list.rewatch.baseline.length === list.members.length &&
      list.rewatch.baseline.every(n => Number.isSafeInteger(n) && n >= 0))))
}

export function validSeasons(seasons) {
  return Array.isArray(seasons) && seasons.length <= 10000 &&
    new Set(seasons.map(item => item?.season)).size === seasons.length &&
    seasons.every(item => item && Number.isInteger(item.season) && item.season >= 0 && item.season <= 9999 &&
      Number.isInteger(item.count) && item.count >= 1 && item.count <= 99999)
}

export function episodeProgress(title) {
  return title.active?.id ? title.episodes.filter(view => view.run === title.active.id) : title.episodes
}

export function nextEpisode(episodes, seasons = []) {
  const watched = new Set(episodes.map(view => view.season + ':' + view.episode))
  for (const {season, count} of [...seasons].filter(item => item.season > 0).sort((a,b) => a.season-b.season)) {
    for (let episode=1; episode<=count; episode++) {
      if (!watched.has(season + ':' + episode)) return {season, episode}
    }
  }
  return null
}

export function clearEpisodeViewings(title, ids) {
  const selected = new Set(ids)
  return {...title, episodes:title.episodes.filter(view => !selected.has(view.id))}
}

const titleCollator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })
export const librarySorts = ['added', 'newest', 'title', 'title-desc', 'year', 'watched', 'status']

function latestViewing(title) {
  return title.history.reduce((latest, view) => view.finished && view.finished > latest ? view.finished : latest, '')
}

export function sortTitles(titles, sort) {
  const byTitle = (a, b) => titleCollator.compare(a.title, b.title)
  const byOrder = (a, b) => (a.order ?? '').localeCompare(b.order ?? '')
  const comparators = {
    added: byOrder, newest: (a, b) => byOrder(b, a),
    title: byTitle, 'title-desc': (a, b) => byTitle(b, a),
    year: (a, b) => (Number(a.year) || 9999) - (Number(b.year) || 9999),
    watched: (a, b) => latestViewing(b).localeCompare(latestViewing(a)),
    status: (a, b) => statuses.indexOf(status(a)) - statuses.indexOf(status(b)),
  }
  const compare = Object.hasOwn(comparators, sort) ? comparators[sort] : byOrder
  return [...titles].sort((a, b) => compare(a, b) || byTitle(a, b))
}

export function viewingInsights(titles, now = new Date()) {
  const counts = Object.fromEntries(statuses.map(label => [label, 0]))
  const months = Array.from({ length: 12 }, (_, index) => {
    const date = new Date(now.getFullYear(), now.getMonth() - 11 + index, 1)
    const key = String(date.getFullYear()) + '-' + String(date.getMonth() + 1).padStart(2, '0')
    return { date, key, count: 0 }
  })
  const byMonth = new Map(months.map(month => [month.key, month]))
  let undated = 0
  for (const title of titles) {
    counts[status(title)]++
    for (const view of title.history) {
      if (!view.finished) { undated++; continue }
      const month = byMonth.get(view.finished.slice(0, 7))
      if (month) month.count++
    }
  }
  return { counts, months, undated }
}

export function validCompletion(view) {
  return (view.run === undefined || typeof view.run === 'string' && /^[a-zA-Z0-9_-]{1,100}$/.test(view.run)) &&
    (view.coverage === undefined || validSeasons(view.coverage))
}

export function completeSeriesEpisodes(title) {
  if (!(title.episodic ?? isEpisodic(title.format)) || !title.seasons?.length || !title.history.length) return title
  const episodes = (title.episodes ?? []).map(view => ({...view}))
  const last = title.history.at(-1)
  const history = title.history.map(view => {
    const previous = new Map((view.coverage ?? []).map(item => [item.season,item.count]))
    const coverage = new Map(previous)
    const known = new Set()
    for (const episode of episodes) {
      const belongs = episode.completion === view.id ||
        !episode.completion && (view.run ? episode.run === view.run : view.id === last.id && !episode.run)
      if (!belongs) continue
      known.add(episode.season + ':' + episode.episode)
      // Keep the user's own episode dates when reconciling a completed series.
      if (episode.inferred && episode.completion === view.id) {
        episode.date = episode.season === 1 && episode.episode === 1
          ? view.started ?? view.finished : view.finished
      }
    }
    for (const {season,count} of title.seasons) {
      for (let episode = (previous.get(season) ?? 0) + 1; episode <= count; episode++) {
        if (known.has(season + ':' + episode)) continue
        episodes.push({
          id: 'completed-' + view.id + '-s' + season + '-e' + episode,
          season, episode, name: '',
          date: season === 1 && episode === 1 ? view.started ?? view.finished : view.finished,
          run: view.run ?? null, completion: view.id, inferred: true,
        })
      }
      coverage.set(season,Math.max(count,previous.get(season) ?? 0))
    }
    return {...view,coverage:[...coverage].sort(([a],[b])=>a-b).map(([season,count])=>({season,count}))}
  })
  return {...title,episodes,history}
}
