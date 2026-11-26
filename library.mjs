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

export function validPoster(value) {
  if(value==='')return true
  if(typeof value!=='string'||value.length>2048)return false
  try {const u=new URL(value);return u.origin==='https://m.media-amazon.com'&&!u.username&&!u.password&&!u.hash&&u.pathname.startsWith('/images/')} catch{return false}
}

export function status(title) {
  if (title.active) return title.history.length ? 'Rewatching' : 'Watching'
  return title.history.length ? 'Watched' : 'Watchlist'
}

export function start(title, date = today(), run = crypto.randomUUID()) {
  if(title.active)return title
  const resume=!title.history?.length&&title.episodes?.length
  const dates=resume?title.episodes.map(e=>e.date).filter(Boolean).sort():[]
  return {...title,active:{started:resume?dates[0]??null:date,id:run},
    ...(resume?{episodes:title.episodes.map(e=>({...e,run}))}:{})}
}

export function reconcileEpisodeActivity(title, date=null) {
  if(!(title.episodic??isEpisodic(title.format))||!title.episodes?.length)return title
  if(!title.active&&!title.history.length)title=start(title,date,'first-viewing')
  if(!title.active)return title
  const progress=episodeProgress(title)
  if(!progress.some(e=>e.season>0))return title
  const releases=releaseProgress(title)
  const finished=releases?releases.released.length===0&&releases.unknown.length===0:
    title.seasons.some(s=>s.season>0)&&!nextEpisode(progress,title.seasons)
  if(!finished)return title
  const id='episodes-'+String(title.active.id??'first-viewing').slice(0,60)
  if(title.history.some(view=>view.id===id))return {...title,active:null}
  const finishedOn=date??progress.at(-1)?.date??null
  const started=title.active.started&&finishedOn&&title.active.started>finishedOn
    ? progress.map(e=>e.date).filter(Boolean).sort()[0]??null : title.active.started
  return saveViewing(title,'finish',{id,started,finished:finishedOn})
}

export function recordEpisodeViewing(title, view, existingId=null) {
  if(!title.active&&!title.history.length)title=start(title,view.date)
  const existing=existingId&&title.episodes.find(e=>e.id===existingId)
  const next={...view,run:existing?existing.run??null:title.active?.id??null}
  if(!validEpisode(next))throw Error('Invalid episode viewing.')
  const episodes=existing?title.episodes.map(e=>e.id===existingId?next:e):[...title.episodes,next]
  return reconcileEpisodeActivity({...title,episodes},view.date)
}

export function validPlayback(value) {
  return (value.position===undefined||value.position===null||Number.isInteger(value.position)&&value.position>=0&&value.position<=604800)&&
    (value.notes===undefined||typeof value.notes==='string'&&value.notes.length<=10000)
}

export function validActive(value) {
  return !!value&&validDate(value.started)&&(value.id===undefined||typeof value.id==='string'&&value.id.length<=100)&&validPlayback(value)
}

export function parsePosition(value) {
  if(!value.trim())return null
  if(!/^\d{1,3}:\d{2}(?::\d{2})?$/.test(value.trim()))throw Error('Use MM:SS or HH:MM:SS, for example 45:30 or 01:20:15.')
  const parts=value.trim().split(':').map(Number)
  if(parts.at(-1)>59||parts.length===3&&parts[1]>59)throw Error('Minutes and seconds must be below 60 in HH:MM:SS.')
  const seconds=parts.reduce((total,n)=>total*60+n,0)
  if(seconds>604800)throw Error('Choose a timestamp within 168 hours.')
  return seconds
}

export function formatPosition(seconds) {
  if(seconds===null||seconds===undefined)return ''
  return [Math.floor(seconds/3600),Math.floor(seconds/60)%60,seconds%60].map(n=>String(n).padStart(2,'0')).join(':')
}

export function savePlayback(title, position, notes) {
  if(!validPlayback({position,notes}))throw Error('Invalid saved position or notes.')
  const next=start(title)
  return {...next,active:{...next.active,position,notes}}
}

// Duplicate additions change viewing state, never replace metadata or history.
export function duplicateAddition(title, requested, finished = null, rewatch = false) {
  if (requested === status(title)) return { title }
  if (requested === 'Watching') {
    if (title.active) return { title }
    if (title.history.length && !rewatch) return { title, offerRewatch: true }
    return { title: start(title) }
  }
  if (requested === 'Watched' && (title.active || !title.history.length)) {
    return { title: saveViewing(title, 'finish', {
      id: crypto.randomUUID(), started: title.active?.started ?? null, finished,
    }) }
  }
  // Returning to Watchlist would discard history or an active viewing.
  return { title }
}

export function undoDuplicateAddition(before, saved, current) {
  if(!current)return null
  const historyCore=title=>JSON.stringify(title.history.map(({coverage,...view})=>view))
  const explicitEpisodes=title=>JSON.stringify(title.episodes.filter(e=>!e.inferred))
  if(JSON.stringify(current.active)!==JSON.stringify(saved.active)||historyCore(current)!==historyCore(saved)||explicitEpisodes(current)!==explicitEpisodes(saved))return null
  const oldIds=new Set(before.history.map(view=>view.id))
  const addedIds=new Set(saved.history.filter(view=>!oldIds.has(view.id)).map(view=>view.id))
  return {...current,active:before.active,history:current.history.filter(view=>!addedIds.has(view.id)),
    episodes:current.episodes.filter(episode=>!episode.inferred||!addedIds.has(episode.completion))}
}

export function saveViewing(title, mode, viewing, index) {
  const history = [...title.history]
  if (mode === 'edit') history[index] = { ...history[index], ...viewing }
  else history.push({ ...viewing, ...(mode === 'finish' && title.active?.id ? { run: title.active.id } : {}),
    ...(mode==='finish'&&title.active?.position!==undefined?{position:title.active.position}:{}),
    ...(mode==='finish'&&title.active?.notes!==undefined?{notes:title.active.notes}:{}) })
  return completeSeriesEpisodes({ ...title, history, active: mode === 'finish' ? null : title.active })
}

export function validDate(date) {
  if (date === null) return true
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false
  const parsed = new Date(date)
  return !Number.isNaN(+parsed) && parsed.toISOString().slice(0, 10) === date
}

export function validReleaseInfo(value) {
  return !!value && /^tt\d{7,}$/.test(value.imdb) && Number.isFinite(value.checkedAt) && value.checkedAt>0 &&
    (value.ended===undefined||typeof value.ended==='boolean') &&
    (value.show===null || Number.isSafeInteger(value.show)&&value.show>0) && Array.isArray(value.episodes) && value.episodes.length<=10000 &&
    value.episodes.every(e=>e&&typeof e==='object') && new Set(value.episodes.map(e=>e.season+':'+e.episode)).size===value.episodes.length &&
    value.episodes.every(e=>Number.isInteger(e.season)&&e.season>0&&e.season<=9999&&Number.isInteger(e.episode)&&e.episode>0&&e.episode<=99999&&
      typeof e.name==='string'&&e.name.length<=300&&validDate(e.airdate)&&
      (e.airstamp===null||typeof e.airstamp==='string'&&e.airstamp.length<=40&&Number.isFinite(Date.parse(e.airstamp))))
}

export function releaseProgress(title, now=Date.now(), lifetime=false) {
  const info=title.releases?.imdb===title.imdb?title.releases:null
  if(!info?.show||!info.episodes.length)return null
  const watched=new Set((lifetime?title.episodes:episodeProgress(title)).map(e=>e.season+':'+e.episode))
  const released=[], upcoming=[], unknown=[]
  for(const episode of info.episodes) {
    if(watched.has(episode.season+':'+episode.episode))continue
    if(episode.airstamp ? Date.parse(episode.airstamp)<=now : episode.airdate && episode.airdate<=todayAt(now))released.push(episode)
    else if(episode.airstamp||episode.airdate)upcoming.push(episode)
    else unknown.push(episode)
  }
  const order=(a,b)=>a.season-b.season||a.episode-b.episode
  return {released:released.sort(order),upcoming:upcoming.sort((a,b)=>(a.airstamp??a.airdate).localeCompare(b.airstamp??b.airdate)),unknown:unknown.sort(order)}
}

function todayAt(now) {
  const date=new Date(now)
  return [date.getFullYear(),date.getMonth()+1,date.getDate()].map(n=>String(n).padStart(2,'0')).join('-')
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
      (title.poster === undefined || validPoster(title.poster)) &&
      (title.group === undefined || validGroup(title.group)) &&
      (title.franchiseCheck === undefined || validFranchiseCheck(title.franchiseCheck)) &&
      (title.releases === undefined || validReleaseInfo(title.releases)) &&
      (title.episodic === undefined || typeof title.episodic === 'boolean') &&
      (title.episodes === undefined || validEpisodes(title.episodes)) &&
      (title.seasons === undefined || validSeasons(title.seasons)) &&
      (title.active === null || validActive(title.active)) &&
      Array.isArray(title.history) && new Set(title.history.map((view, index) => view?.id ?? 'legacy-' + String(index).padStart(8, '0'))).size === title.history.length && title.history.every(view =>
        !!view && (view.id === undefined || typeof view.id === 'string' && /^[a-zA-Z0-9_-]{1,200}$/.test(view.id)) && validDate(view.started) && validDate(view.finished) &&
        (!view.started || !view.finished || view.started <= view.finished) && validCompletion(view))
  })
}

export function isEpisodic(format) {
  return /\b(series|miniseries|show|serial|sitcom|anime|soap)\b/i.test(format)
}

export function seriesReleaseTargets(titles, includeEnded=false) {
  return titles.filter(title=>title.imdb&&(isEpisodic(title.format)||title.episodic&&!/^(movie|tv movie|short|special|video|episode)$/i.test(title.format.trim()))&&
    (includeEnded||title.releases?.imdb!==title.imdb||title.releases.ended!==true))
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

export function logSeasonRange(title, from, through, date=null) {
  if(!Number.isInteger(from)||!Number.isInteger(through)||from<0||through<from||through>9999||!validDate(date))throw Error('Choose a valid season range and date.')
  const counts=new Map(title.seasons.map(s=>[s.season,s.count]))
  let total=0
  for(let season=from;season<=through;season++) {
    if(!counts.has(season))throw Error('Episode counts are missing for season '+season+'.')
    total+=counts.get(season)
  }
  if(total>10000)throw Error('Choose fewer seasons (up to 10,000 episodes at once).')
  const known=new Set(episodeProgress(title).map(e=>e.season+':'+e.episode))
  const releases=title.releases?.imdb===title.imdb&&title.releases.show
    ? new Map(title.releases.episodes.map(e=>[e.season+':'+e.episode,e])):null
  const added=[]
  let skipped=0
  for(let season=from;season<=through;season++)for(let episode=1;episode<=counts.get(season);episode++) {
    const key=season+':'+episode
    if(known.has(key))continue
    if(releases){
      const release=releases.get(key)
      if(release?.airdate&&(release.airdate>(date??today())||(!date||date===today())&&release.airstamp&&Date.parse(release.airstamp)>Date.now())){skipped++;continue}
    }
    added.push({id:crypto.randomUUID(),season,episode,name:releases?.get(key)?.name??'',date,run:title.active?.id??null})
  }
  return {title:reconcileEpisodeActivity({...title,episodes:[...title.episodes,...added]},date),added:added.length,skipped}
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
  return validPlayback(view) && (view.run === undefined || typeof view.run === 'string' && /^[a-zA-Z0-9_-]{1,100}$/.test(view.run)) &&
    (view.coverage === undefined || validSeasons(view.coverage))
}

export function completeSeriesEpisodes(title) {
  if (!(title.episodic ?? isEpisodic(title.format)) || !title.seasons?.length || !title.history.length) return title
  const episodes = (title.episodes ?? []).map(view => ({...view}))
  const releases = title.releases?.imdb===title.imdb && title.releases.show
    ? new Map(title.releases.episodes.map(e=>[e.season+':'+e.episode,e])) : null
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
    for (const {season,count} of view.coverage === undefined ? title.seasons : []) {
      for (let episode = (previous.get(season) ?? 0) + 1; episode <= count; episode++) {
        if(releases) {
          const release=releases.get(season+':'+episode)
          const cutoff=view.finished??today()
          if(!release?.airdate||release.airdate>cutoff||cutoff===today()&&release.airstamp&&Date.parse(release.airstamp)>Date.now())continue
        }
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
