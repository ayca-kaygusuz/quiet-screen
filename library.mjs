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
  return title.active ? title : { ...title, active: { started: date } }
}

export function saveViewing(title, mode, viewing, index) {
  const history = [...title.history]
  if (mode === 'edit') history[index] = viewing
  else history.push(viewing)
  return { ...title, history, active: mode === 'finish' ? null : title.active }
}

function validDate(date) {
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
      (title.active === null || !!title.active && validDate(title.active.started)) &&
      Array.isArray(title.history) && title.history.every(view =>
        !!view && validDate(view.started) && validDate(view.finished) &&
        (!view.started || !view.finished || view.started <= view.finished))
  })
}
