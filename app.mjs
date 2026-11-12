import { imdbId, saveViewing, start, status, statuses, today, validLibrary } from './library.mjs'

const $ = id => document.getElementById(id)
const titleForm = $('title-form')
const viewForm = $('view-form')
const fields = titleForm.elements
const dates = viewForm.elements
const storageKey = 'quiet-screen-v1'
let library = []
let selected
let filter = 'All titles'
let editing
let viewing
let request

function notice(message) {
  $('notice').textContent = message
}

try {
  const saved = JSON.parse(localStorage.getItem(storageKey) ?? '[]')
  if (!validLibrary(saved)) throw new Error()
  library = saved
} catch {
  notice('Could not read saved titles. Restore a backup if available.')
}

function commit(next, selection, message) {
  try {
    localStorage.setItem(storageKey, JSON.stringify(next))
  } catch {
    notice('Could not save your library.')
    return false
  }
  library = next
  selected = selection
  notice(message)
  render()
  return true
}

function update(title, message) {
  const next = library.some(item => item.id === title.id)
    ? library.map(item => item.id === title.id ? title : item)
    : [...library, title]
  return commit(next, title.id, message)
}

function node(tag, content = '', className = '') {
  const result = document.createElement(tag)
  result.textContent = content
  result.className = className
  return result
}

function button(label, action, className) {
  const result = node('button', label, className)
  result.type = 'button'
  result.onclick = action
  return result
}

function listItem(...children) {
  const result = node('li')
  result.append(...children)
  return result
}

function metadata(title) {
  return [title.format, title.year].filter(Boolean).join(' · ')
}

function render() {
  const tabs = ['All titles', ...statuses].map(label => {
    const count = label === 'All titles' ? library.length : library.filter(title => status(title) === label).length
    const tab = button(label + ' · ' + count, () => {
      filter = label
      render()
      $('filters').querySelector('[aria-pressed="true"]').focus()
    })
    tab.setAttribute('aria-pressed', String(label === filter))
    return tab
  })
  $('filters').replaceChildren(...tabs)
  const query = $('library-search').value.trim().toLowerCase()
  const visible = library.filter(title => (filter === 'All titles' || status(title) === filter) &&
    (title.title + ' ' + metadata(title)).toLowerCase().includes(query))
  $('count').textContent = visible.length + (visible.length === 1 ? ' title' : ' titles')
  const rows = visible.map(title => {
    const row = button('', () => {
      selected = title.id
      render()
      $('detail').querySelector('h2').focus()
    }, 'row')
    row.setAttribute('aria-current', String(title.id === selected))
    const label = node('span')
    label.append(node('strong', title.title), node('small', metadata(title)))
    row.append(label, node('span', status(title), 'badge'))
    return listItem(row)
  })
  $('titles').replaceChildren(...(rows.length ? rows : [listItem(library.length
    ? 'No matching titles.' : 'Your library is empty. Add a title to get started.')]))
  renderDetail(library.find(title => title.id === selected))
}

const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeZone: 'UTC' })
const formatDate = value => dateFormat.format(new Date(value))

function renderDetail(title) {
  const detail = $('detail')
  detail.replaceChildren()
  if (!title) {
    detail.append(node('h2', 'Viewing history'), node('p', 'Select a title to see its viewing history.'))
    return
  }
  const heading = node('h2', title.title)
  heading.tabIndex = -1
  detail.append(heading, node('p', metadata(title) + ' · ' + status(title)))
  if (title.imdb) {
    const source = node('a', 'IMDb ↗')
    source.href = 'https://www.imdb.com/title/' + title.imdb + '/'
    source.target = '_blank'
    source.rel = 'noopener noreferrer'
    detail.append(source)
  }
  const actions = node('div', '', 'actions')
  if (title.active) {
    detail.append(node('p', title.active.started ? 'Started ' + formatDate(title.active.started) : 'Start date unknown'))
    actions.append(button(title.history.length ? 'Finish rewatch' : 'Finish watching',
      () => openViewing(title, 'finish'), 'primary'))
  } else {
    actions.append(button(title.history.length ? 'Start rewatch' : 'Start watching',
      () => update(start(title), 'Start date saved.'), 'primary'))
  }
  actions.append(button('Log past viewing', () => openViewing(title, 'past')), button('Edit title', () => openTitle(title)))
  detail.append(actions, node('h3', 'Viewing history'))
  const history = node('ul', '', 'history')
  title.history.slice().reverse().forEach((view, reverseIndex) => {
    const info = node('div', view.finished ? 'Watched ' + formatDate(view.finished) : 'Watched · date unknown')
    if (view.started) info.append(node('span', 'Started ' + formatDate(view.started)))
    const index = title.history.length - 1 - reverseIndex
    history.append(listItem(info, button('Edit dates', () => openViewing(title, 'edit', index))))
  })
  if (!title.history.length) history.append(listItem('No completed viewings yet.'))
  detail.append(history)
  const secondary = node('div', '', 'actions end')
  if (title.active) secondary.append(button('Cancel current viewing', () => {
    if (confirm('Cancel the current viewing?')) update({ ...title, active: null }, 'Current viewing canceled.')
  }))
  secondary.append(button('Remove title', () => {
    if (confirm('Remove this title and its viewing history?')) {
      commit(library.filter(item => item.id !== title.id), null, 'Title removed.')
    }
  }))
  detail.append(secondary)
}

function openTitle(title) {
  editing = title
  titleForm.reset()
  resetSearch()
  $('title-heading').textContent = title ? 'Edit title' : 'Add title'
  $('initial').hidden = Boolean(title)
  $('initial-date').hidden = true
  for (const key of ['title', 'imdb']) fields[key].setCustomValidity('')
  if (title) for (const key of ['title', 'format', 'year', 'imdb']) fields[key].value = title[key]
  $('title-dialog').showModal()
}

fields.status.onchange = () => { $('initial-date').hidden = fields.status.value !== 'Watched' }
for (const key of ['title', 'imdb']) fields[key].oninput = () => fields[key].setCustomValidity('')

function invalid(field, message) {
  field.setCustomValidity(message)
  field.reportValidity()
}

titleForm.onsubmit = event => {
  event.preventDefault()
  const title = fields.title.value.trim()
  const imdb = imdbId(fields.imdb.value)
  if (!title) return invalid(fields.title, 'Enter a title.')
  if (fields.imdb.value.trim() && !imdb) return invalid(fields.imdb, 'Enter a valid IMDb title link or ID.')
  if (imdb && library.some(item => item.imdb === imdb && item.id !== editing?.id)) {
    return invalid(fields.imdb, 'This IMDb title is already in your library.')
  }
  const initial = fields.status.value
  const record = {
    id: editing?.id ?? crypto.randomUUID(),
    title, format: fields.format.value.trim() || 'Other', year: fields.year.value, imdb,
    active: editing ? editing.active : initial === 'Watching' ? { started: today() } : null,
    history: editing?.history ?? (initial === 'Watched' ? [{ started: null, finished: fields.finished.value || null }] : []),
  }
  if (!editing) filter = 'All titles'
  if (update(record, 'Title saved.')) $('title-dialog').close()
}

function openViewing(title, mode, index) {
  viewing = { title, mode, index }
  $('view-heading').textContent = { past: 'Log past viewing', finish: 'Finish viewing', edit: 'Edit viewing dates' }[mode]
  const existing = title.history[index]
  dates.started.value = existing?.started ?? (mode === 'finish' ? title.active.started ?? '' : '')
  dates.finished.value = existing?.finished ?? (mode === 'finish' ? today() : '')
  dates.finished.setCustomValidity('')
  $('view-dialog').showModal()
}

viewForm.oninput = () => dates.finished.setCustomValidity('')
viewForm.onsubmit = event => {
  event.preventDefault()
  const { title, mode, index } = viewing
  const started = dates.started.value || null
  const finished = dates.finished.value || null
  if (started && finished && started > finished) {
    return invalid(dates.finished, 'Choose a date on or after the start date.')
  }
  if (update(saveViewing(title, mode, { started, finished }, index), 'Viewing saved.')) $('view-dialog').close()
}

function resetSearch() {
  request?.abort()
  const query = $('query').value.trim()
  const id = imdbId(query)
  $('imdb-search').href = id ? 'https://www.imdb.com/title/' + id + '/'
    : 'https://www.imdb.com/find/?s=tt&q=' + encodeURIComponent(query)
  $('results').replaceChildren()
  $('lookup-status').textContent = ''
  $('find').disabled = false
}

async function searchImdb() {
  resetSearch()
  const query = $('query').value.trim()
  if (query.length < 2) {
    $('lookup-status').textContent = 'Enter at least two characters.'
    return
  }
  const controller = new AbortController()
  request = controller
  $('find').disabled = true
  $('lookup-status').textContent = 'Searching IMDb…'
  const id = imdbId(query)
  if (id) {
    fields.imdb.value = id
    fields.imdb.setCustomValidity('')
  }
  try {
    const response = await fetch('/api/imdb?q=' + encodeURIComponent(query), { signal: controller.signal })
    if (!response.ok) throw new Error()
    const matches = await response.json()
    if (controller.signal.aborted) return
    $('lookup-status').textContent = matches.length ? 'Choose a match to fill in the title details.' : 'No matches found.'
    $('results').replaceChildren(...matches.map(match => listItem(button(
      match.title + ' · ' + metadata(match), () => {
        for (const key of ['title', 'format', 'year', 'imdb']) fields[key].value = match[key]
        fields.title.setCustomValidity('')
        fields.imdb.setCustomValidity('')
        $('results').replaceChildren()
        $('lookup-status').textContent = 'Selected ' + match.title + '.'
        fields.title.focus()
      }, 'row'))))
  } catch {
    if (!controller.signal.aborted) $('lookup-status').textContent = 'IMDb lookup is unavailable. Open IMDb or enter the title below.'
  } finally {
    if (request === controller) $('find').disabled = false
  }
}

$('query').oninput = resetSearch
$('query').onkeydown = event => {
  if (event.key !== 'Enter') return
  event.preventDefault()
  searchImdb()
}
$('find').onclick = searchImdb
$('title-dialog').onclose = () => request?.abort()
for (const close of document.querySelectorAll('[data-close]')) {
  close.onclick = () => close.closest('dialog').close()
}
$('add').onclick = () => openTitle()
$('library-search').oninput = render
$('backup').onclick = () => {
  const blob = new Blob([JSON.stringify({ version: 1, titles: library }, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const download = node('a')
  download.href = url
  download.download = 'quiet-screen-' + today() + '.json'
  download.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
$('restore').onclick = () => $('backup-file').click()
$('backup-file').onchange = async event => {
  const file = event.target.files[0]
  event.target.value = ''
  if (!file) return
  try {
    const backup = JSON.parse(await file.text())
    if (backup?.version !== 1 || !validLibrary(backup.titles)) throw new Error()
    if (confirm('Replace your current library with ' + backup.titles.length + ' titles from this backup?')) {
      filter = 'All titles'
      commit(backup.titles, null, 'Library restored.')
    }
  } catch {
    notice('This file is not a valid Quiet Screen backup.')
  }
}
render()

const themePicker = $('theme')
const themeKey = 'quiet-screen-theme'
try {
  const savedTheme = localStorage.getItem(themeKey)
  if ([...themePicker.options].some(option => option.value === savedTheme)) {
    themePicker.value = savedTheme
  }
} catch {
  // Theme changes still work for the current page when storage is unavailable.
}
document.documentElement.dataset.theme = themePicker.value
themePicker.onchange = () => {
  document.documentElement.dataset.theme = themePicker.value
  try {
    localStorage.setItem(themeKey, themePicker.value)
  } catch {
    notice('Could not save your theme preference.')
  }
}
