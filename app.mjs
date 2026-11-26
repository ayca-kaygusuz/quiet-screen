import {franchiseChecked, franchiseTargets, franchiseSuggestions, setBundle, unbundle, validFranchiseCheck} from './franchises.mjs'
import './sync/sync-core.js'
import { completeSeriesEpisodes, clearEpisodeViewings, episodeProgress, validSeasons, librarySorts, sortTitles, viewingInsights, isEpisodic, nextEpisode, seriesGroups, validEpisode, validLists, imdbId, saveViewing, start, status, statuses, today, validLibrary } from './library.mjs'

const $ = id => document.getElementById(id)
const titleForm = $('title-form')
const viewForm = $('view-form')
const fields = titleForm.elements
const dates = viewForm.elements
const storageKey = 'quiet-screen-v1'
const episodeLookups = new Map()
let episodeLookupTimer
const listsKey = 'quiet-screen-lists-v1'
let lists = []
let listSelection = null
let detailTab = 'overview'
const libraryViewKey = 'quiet-screen-library-view-v1'
const libraryView = { sort: 'added', groups: true, standalone: true, plain: false }
const collapsedGroups = new Set()
try {
  const saved = JSON.parse(localStorage.getItem(libraryViewKey) ?? '{}')
  if (librarySorts.includes(saved.sort)) libraryView.sort = saved.sort
  for (const key of ['groups', 'standalone', 'plain']) {
    if (typeof saved[key] === 'boolean') libraryView[key] = saved[key]
  }
  if (Array.isArray(saved.collapsed)) for (const key of saved.collapsed) {
    if (typeof key === 'string') collapsedGroups.add(key)
  }
} catch {}
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
  library = normalizeTitles(saved)
  const savedLists = JSON.parse(localStorage.getItem(listsKey) ?? '[]')
  if (!validLists(savedLists)) throw new Error()
  lists = savedLists
} catch {
  notice('Could not read saved titles. Restore a backup if available.')
}

function commit(next, selection, message) {
  next = normalizeTitles(next)
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
  syncApp.changed?.()
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
  scheduleEpisodeLookups()
  renderInsights()
  const tabs = ['All titles', ...statuses].map(label => {
    const count = label === 'All titles' ? library.length : library.filter(title => status(title) === label).length
    const tab = button(label + ' · ' + count, () => {
      listSelection = null
      filter = label
      render()
      $('filters').querySelector('[aria-pressed="true"]').focus()
    })
    tab.setAttribute('aria-pressed', String(!listSelection && label === filter))
    return tab
  })
  $('filters').replaceChildren(...tabs)
  const query = $('library-search').value.trim().toLowerCase()
  const groups = seriesGroups(library)
  const currentList = lists.find(list => list.id === listSelection)
  renderLists(currentList)
  let visible = library.filter(title => (currentList ? currentList.members.includes(title.id) : filter === 'All titles' || status(title) === filter) &&
    (title.title + ' ' + metadata(title) + ' ' + (groups.get(title.id)?.name ?? '')).toLowerCase().includes(query))
  if (!currentList && !libraryView.plain) {
    visible = visible.filter(title => groups.has(title.id) ? libraryView.groups : libraryView.standalone)
  }
  if (currentList?.rewatch) visible = currentList.members.map(id => visible.find(title => title.id === id)).filter(Boolean)
  else visible = sortTitles(visible, libraryView.sort)
  const visibleGroups = new Set(visible.map(title => groups.get(title.id)?.key).filter(Boolean))
  const groupButton = $('collapse-groups')
  groupButton.hidden = Boolean(currentList || libraryView.plain || !visibleGroups.size)
  const expanded = [...visibleGroups].some(key => !collapsedGroups.has(key))
  groupButton.textContent = expanded ? 'Collapse all groups' : 'Expand all groups'
  groupButton.onclick = () => {
    for (const key of visibleGroups) {
      if (expanded) collapsedGroups.add(key)
      else collapsedGroups.delete(key)
    }
    rememberLibraryView()
    render()
    groupButton.focus()
  }
  $('count').textContent = visible.length + (visible.length === 1 ? ' title' : ' titles')
  function titleRow(title) {
    const row = button('', () => {
      if (selected !== title.id) detailTab = 'overview'
      selected = title.id
      render()
      $('detail').querySelector('h2').focus()
    }, 'row')
    row.setAttribute('aria-current', String(title.id === selected))
    const label = node('span')
    label.append(node('strong', title.title), node('small', metadata(title)))
    row.append(label, node('span', status(title), 'badge'))
    const item = listItem(row)
    if (!currentList && filter === 'Watchlist') {
      const tick = button('✓', () => update(saveViewing(title, 'past', {
        id: viewingId(), started: null, finished: today(),
      }), 'Marked watched.'), 'watch-tick')
      tick.setAttribute('aria-label', 'Mark ' + title.title + ' watched today')
      tick.title = tick.getAttribute('aria-label')
      item.append(tick)
    }
    return item
  }
  const rows = []
  const grouped = new Map()
  for (const title of visible) {
    const group = !currentList && !libraryView.plain && groups.get(title.id)
    if (!group) {
      rows.push(titleRow(title))
      continue
    }
    let groupList = grouped.get(group.key)
    if (!groupList) {
      const groupHeader = node('div', '', 'group-heading')
      const toggle = button(group.name, () => {
        if (collapsedGroups.has(group.key)) collapsedGroups.delete(group.key)
        else collapsedGroups.add(group.key)
        rememberLibraryView()
        render()
        document.getElementById(groupId + '-toggle')?.focus()
      }, 'group-toggle')
      const groupId = 'title-group-' + rows.length
      toggle.id = groupId + '-toggle'
      toggle.setAttribute('aria-controls', groupId)
      toggle.setAttribute('aria-expanded', String(!collapsedGroups.has(group.key)))
      groupHeader.append(toggle)
      groupHeader.append(button('Manage bundle', () => openBundle(group)),
        button(group.members.every(id => franchiseChecked(library.find(title => title.id === id))) ? 'Recheck connections' : 'Check connections',
          () => openFranchiseLookup(group.members)))
      if (group.members.length > 1) groupHeader.append(button('Start group rewatch', () => beginGroupRewatch(group)))
      groupList = node('ul')
      groupList.id = groupId
      groupList.hidden = collapsedGroups.has(group.key)
      rows.push(listItem(groupHeader, groupList))
      grouped.set(group.key, groupList)
    }
    groupList.append(titleRow(title))
  }
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
  const tabs = [{ id: 'overview', label: 'Overview' }, { id: 'history', label: 'Viewing history' }]
  if (title.episodic || title.episodes.length) tabs.push({ id: 'episodes', label: 'Episodes' })
  if (!tabs.some(tab => tab.id === detailTab)) detailTab = 'overview'
  const heading = node('h2', title.title)
  heading.tabIndex = -1
  const navigation = node('nav', '', 'detail-tabs')
  navigation.setAttribute('aria-label', 'Title details views')
  for (const tab of tabs) {
    const control = button(tab.label, () => {
      detailTab = tab.id
      renderDetail(title)
      detail.querySelector('[aria-pressed="true"]')?.focus()
    })
    control.setAttribute('aria-pressed', String(tab.id === detailTab))
    navigation.append(control)
  }
  detail.append(heading, node('p', metadata(title) + ' · ' + status(title)), navigation)
  if (detailTab === 'episodes') {
    renderEpisodes(detail, title)
    return
  }
  if (detailTab === 'history') {
    renderViewingHistory(detail, title)
    return
  }
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
  actions.append(button('Log past viewing', () => openViewing(title, 'past')), button('Edit title', () => openTitle(title)), button('Add to lists', () => openMemberships(title)))
  actions.append(button(franchiseChecked(title) ? 'Recheck franchise' : 'Check franchise', () => openFranchiseLookup([title.id])))
  detail.append(actions)
  if (title.episodic || title.episodes.length) detail.append(episodeControls(title))
  const summary = title.history.length + (title.history.length === 1 ? ' completed viewing' : ' completed viewings')
  detail.append(node('p', summary, 'viewing-summary'))
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

function renderViewingHistory(detail, title) {
  detail.append(button('Log past viewing', () => openViewing(title, 'past')))
  const history = node('ul', '', 'history')
  title.history.slice().reverse().forEach((view, reverseIndex) => {
    const info = node('div', view.finished ? 'Watched ' + formatDate(view.finished) : 'Watched · date unknown')
    if (view.started) info.append(node('span', 'Started ' + formatDate(view.started)))
    const index = title.history.length - 1 - reverseIndex
    history.append(listItem(info, button('Edit dates', () => openViewing(title, 'edit', index))))
  })
  if (!title.history.length) history.append(listItem('No completed viewings yet.'))
  detail.append(history)
}

function existingBundleIdentity(name) {
  if (editing?.group?.mode === 'manual' && editing.group.name === name && editing.group.id) return {id:editing.group.id}
  const ids = new Set(library.filter(title => title.group?.mode === 'manual' && title.group.name === name && title.group.id)
    .map(title => title.group.id))
  return ids.size === 1 ? {id:[...ids][0]} : {}
}

function openTitle(title) {
  editing = title
  titleForm.reset()
  episodePreferenceChanged = false
  resetSearch()
  $('title-heading').textContent = title ? 'Edit title' : 'Add title'
  $('initial').hidden = Boolean(title)
  $('initial-date').hidden = true
  for (const key of ['title', 'imdb']) fields[key].setCustomValidity('')
  if (title) for (const key of ['title', 'format', 'year', 'imdb']) fields[key].value = title[key]
  fields.groupMode.value = title?.group.mode ?? 'auto'
  fields.groupName.value = title?.group.name ?? ''
  fields.groupName.setCustomValidity('')
  fields.episodic.checked = title?.episodic ?? isEpisodic(fields.format.value)
  episodePreferenceChanged = Boolean(title)
  refreshGroupField()
  const groups = new Map([...seriesGroups(library).values()].map(group => [group.key, group.name]))
  $('group-options').replaceChildren(...[...groups.values()].map(name => {
    const option = node('option')
    option.value = name
    return option
  }))
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
  if (fields.groupMode.value === 'manual' && !fields.groupName.value.trim()) {
    return invalid(fields.groupName, 'Enter a group name.')
  }
  if (editing) editing = library.find(title => title.id === editing.id) ?? editing
  const initial = fields.status.value
  const record = {
    id: editing?.id ?? crypto.randomUUID(),
    order: editing?.order ?? viewingId(),
    title, format: fields.format.value.trim() || 'Other', year: fields.year.value ? String(fields.year.valueAsNumber) : '', imdb,
    ...(editing?.franchiseCheck?.imdb === imdb ? {franchiseCheck:editing.franchiseCheck} : {}),
    group: { mode: fields.groupMode.value, name: fields.groupMode.value === 'manual' ? fields.groupName.value.trim() : '',
      ...(fields.groupMode.value === 'manual' ? existingBundleIdentity(fields.groupName.value.trim()) : {}) },
    episodic: fields.episodic.checked,
    episodes: editing?.episodes ?? [],
    seasons: editing?.seasons ?? [],
    active: editing ? editing.active : initial === 'Watching' ? start({ active: null }).active : null,
    history: editing?.history ?? (initial === 'Watched' ? [{ id: viewingId(), started: null, finished: fields.finished.value || null }] : []),
  }
  if (!editing) { filter = 'All titles'; listSelection = null }
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
  if (update(saveViewing(title, mode, { id: title.history[index]?.id ?? viewingId(), started, finished }, index), 'Viewing saved.')) $('view-dialog').close()
}

const queryInput = $('query')
const results = $('results')
let searchTimer
let activeResult = -1

function closeSuggestions() {
  activeResult = -1
  results.replaceChildren()
  results.hidden = true
  queryInput.setAttribute('aria-expanded', 'false')
  queryInput.removeAttribute('aria-activedescendant')
}

function resetSearch() {
  clearTimeout(searchTimer)
  request?.abort()
  request = null
  const query = queryInput.value.trim()
  const id = imdbId(query)
  $('imdb-search').href = id ? 'https://www.imdb.com/title/' + id + '/'
    : 'https://www.imdb.com/find/?s=tt&q=' + encodeURIComponent(query)
  closeSuggestions()
  $('lookup-status').textContent = ''
}

function selectImdb(match) {
  for (const key of ['title', 'format', 'year', 'imdb']) fields[key].value = match[key]
  refreshEpisodeDefault()
  fields.title.setCustomValidity('')
  fields.imdb.setCustomValidity('')
  closeSuggestions()
  $('lookup-status').textContent = 'Selected ' + match.title + '.'
  fields.title.focus()
}

async function searchImdb(query) {
  const controller = new AbortController()
  request = controller
  $('lookup-status').textContent = 'Searching IMDb…'
  try {
    const response = await fetch('/api/imdb?q=' + encodeURIComponent(query), { signal: controller.signal })
    if (!response.ok) throw new Error()
    const matches = await response.json()
    if (controller.signal.aborted) return
    $('lookup-status').textContent = matches.length ? 'Choose an IMDb match.' : 'No matches found.'
    results.replaceChildren(...matches.map((match, index) => {
      const option = node('li', match.title + ' · ' + metadata(match), 'row')
      option.id = 'imdb-option-' + index
      option.setAttribute('role', 'option')
      option.setAttribute('aria-selected', 'false')
      option.onmousedown = event => event.preventDefault()
      option.onclick = () => selectImdb(match)
      return option
    }))
    results.hidden = !matches.length
    queryInput.setAttribute('aria-expanded', String(Boolean(matches.length)))
  } catch {
    if (!controller.signal.aborted) $('lookup-status').textContent = 'IMDb lookup is unavailable. Open IMDb or enter the title below.'
  } finally {
    if (request === controller) request = null
  }
}

function queueImdbSearch() {
  resetSearch()
  const query = queryInput.value.trim()
  if (query.length >= 2) searchTimer = setTimeout(() => searchImdb(query), 280)
}

queryInput.oninput = event => {
  if (!event.isComposing) queueImdbSearch()
}
queryInput.oncompositionend = queueImdbSearch
queryInput.onkeydown = event => {
  if (event.isComposing) return
  const options = results.children
  if (event.key === 'Escape' && (options.length || request)) {
    event.preventDefault()
    resetSearch()
    return
  }
  if (event.key === 'Enter') {
    event.preventDefault()
    options[activeResult]?.click()
    return
  }
  if (!options.length || !['ArrowDown', 'ArrowUp'].includes(event.key)) return
  event.preventDefault()
  options[activeResult]?.setAttribute('aria-selected', 'false')
  if (event.key === 'ArrowDown') activeResult = (activeResult + 1) % options.length
  else activeResult = activeResult <= 0 ? options.length - 1 : activeResult - 1
  const option = options[activeResult]
  option.setAttribute('aria-selected', 'true')
  queryInput.setAttribute('aria-activedescendant', option.id)
  option.scrollIntoView({ block: 'nearest' })
}
$('title-dialog').onclose = () => {
  resetSearch()
  globalThis.QuietScreenAccount?.resume()
}
$('view-dialog').onclose = () => globalThis.QuietScreenAccount?.resume()
for (const close of document.querySelectorAll('[data-close]')) {
  close.onclick = () => close.closest('dialog').close()
}
$('add').onclick = () => openTitle()
$('library-search').oninput = render
function downloadBackup({ library: titles, preferences, lists: savedLists }, prefix = 'quiet-screen') {
  const blob = new Blob([JSON.stringify({ version: 1, titles, preferences, lists: savedLists }, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const download = node('a')
  download.href = url
  download.download = prefix + '-' + today() + '.json'
  download.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

$('account-backup').onclick = $('backup').onclick = () => downloadBackup(syncApp.snapshot())
$('account-restore').onclick = () => $('backup-file').click()
$('restore').onclick = () => $('backup-file').click()
$('backup-file').onchange = async event => {
  const file = event.target.files[0]
  event.target.value = ''
  if (!file) return
  try {
    const backup = JSON.parse(await file.text())
    if (backup?.version !== 1 || !validLibrary(backup.titles) || !validLists(backup.lists ?? [])) throw new Error()
    if (confirm('Replace your current library with ' + backup.titles.length + ' titles from this backup?')) {
      filter = 'All titles'
      replaceWorkspace(validateDocument({
        library: backup.titles,
        lists: backup.lists ?? [],
        preferences: { theme: validTheme(backup.preferences?.theme) ? backup.preferences.theme : themePicker.value },
      }), null)
      notice('Library restored.')
      syncApp.changed?.()
    }
  } catch {
    notice('This file is not a valid Quiet Screen backup.')
  }
}

const themePicker = $('theme')
const themeKey = 'quiet-screen-theme'
const validTheme = value => [...themePicker.options].some(option => option.value === value)

function setTheme(theme) {
  themePicker.value = theme
  document.documentElement.dataset.theme = theme
  localStorage.setItem(themeKey, theme)
}

try {
  const savedTheme = localStorage.getItem(themeKey)
  if (validTheme(savedTheme)) themePicker.value = savedTheme
} catch {
  // Browser storage may be unavailable.
}
document.documentElement.dataset.theme = themePicker.value
themePicker.onchange = () => {
  try {
    setTheme(themePicker.value)
    syncApp.changed?.()
  } catch {
    notice('Could not save your theme preference.')
  }
}

function viewingId() {
  return 'view-' + String(Date.now()).padStart(16, '0') + '-' + crypto.randomUUID()
}

function normalizeTitles(titles) {
  return titles.map((title, index) => completeSeriesEpisodes({
    ...title,
    order: title.order ?? 'legacy-' + String(index).padStart(8, '0'),
    group: title.group ?? { mode: 'auto', name: '' },
    episodic: title.episodic ?? isEpisodic(title.format),
    episodes: title.episodes ?? [],
    seasons: title.seasons ?? [],
    history: title.history.map((view, index) => ({
      ...view,
      id: view.id ?? 'legacy-' + String(index).padStart(8, '0'),
    })),
  }))
}

function validateDocument({ library: titles, preferences = {}, lists: syncedLists = [] }) {
  if (!validLibrary(titles) || !validLists(syncedLists) || (preferences.theme !== undefined && !validTheme(preferences.theme))) {
    throw new Error('Invalid Quiet Screen library.')
  }
  return { library: normalizeTitles(titles), preferences, lists: syncedLists }
}

function replaceWorkspace(next, selection) {
  const theme = next.preferences.theme ?? 'ink'
  const changes = [
    [storageKey, JSON.stringify(next.library)],
    [listsKey, JSON.stringify(next.lists)],
    [themeKey, theme],
  ]
  const previous = changes.map(([key]) => [key, localStorage.getItem(key)])
  try {
    for (const [key, value] of changes) localStorage.setItem(key, value)
  } catch (error) {
    for (const [key, value] of previous) {
      try {
        if (value === null) localStorage.removeItem(key)
        else localStorage.setItem(key, value)
      } catch {
        // The saved account state and recovery copies remain available.
      }
    }
    throw error
  }
  library = next.library
  lists = next.lists
  selected = selection
  if (!lists.some(list => list.id === listSelection)) listSelection = null
  themePicker.value = theme
  document.documentElement.dataset.theme = theme
  render()
}

const syncApp = {
  snapshot: () => ({ library, lists, preferences: { theme: themePicker.value } }),
  apply(document) {
    replaceWorkspace(validateDocument(document), selected)
  },
  validateDocument,
  message: notice,
  downloadBackup,
  hasDraft: () => Boolean(document.querySelector('dialog[open]')),
  themeLabel: value => [...themePicker.options].find(option => option.value === value)?.text ?? 'Default theme',
  esc: value => String(value).replace(/[&<>"']/g, character =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]),
}

let episodePreferenceChanged = false
function refreshEpisodeDefault() {
  if (!episodePreferenceChanged) fields.episodic.checked = isEpisodic(fields.format.value)
}
function refreshGroupField() {
  const manual = fields.groupMode.value === 'manual'
  $('group-name').hidden = !manual
  fields.groupName.required = manual
  fields.groupName.setCustomValidity('')
}
fields.groupMode.onchange = refreshGroupField
fields.groupName.oninput = () => fields.groupName.setCustomValidity('')
fields.format.oninput = refreshEpisodeDefault
fields.episodic.onchange = () => { episodePreferenceChanged = true }

const episodeForm = $('episode-form')
const episodeFields = episodeForm.elements
let episodeEdit

function openEpisode(title, defaults, existing) {
  episodeEdit = { titleId: title.id, existing }
  const values = existing ?? defaults
  $('episode-heading').textContent = existing ? 'Edit episode viewing' : 'Log episode'
  episodeFields.episode.setCustomValidity('')
  episodeFields.season.value = values.season
  episodeFields.episode.value = values.episode
  episodeFields.name.value = values.name ?? ''
  episodeFields.date.value = existing ? existing.date ?? '' : today()
  $('episode-dialog').showModal()
}

function saveEpisode(title, values, existing) {
  const view = {
    id: existing?.id ?? viewingId(),
    season: values.season,
    episode: values.episode,
    name: values.name ?? '',
    date: values.date,
    run: existing ? existing.run ?? null : title.active?.id ?? null,
    ...(existing?.completion ? {completion:existing.completion, inferred:false} : {}),
  }
  if (!validEpisode(view)) return false
  const season = title.seasons.find(item => item.season === view.season)
  if (season && view.episode > season.count && (!existing || existing.season !== view.season || existing.episode !== view.episode)) {
    invalid(episodeFields.episode, 'This season has ' + season.count + ' episodes. Update its count if needed.')
    return false
  }
  const episodes = existing ? title.episodes.map(item => item.id === view.id ? view : item) : [...title.episodes, view]
  return update({ ...title, episodes }, 'Episode viewing saved.')
}

episodeForm.oninput = () => episodeFields.episode.setCustomValidity('')
episodeForm.onsubmit = event => {
  event.preventDefault()
  const title = library.find(item => item.id === episodeEdit.titleId)
  if (title && saveEpisode(title, {
    season: episodeFields.season.valueAsNumber,
    episode: episodeFields.episode.valueAsNumber,
    name: episodeFields.name.value.trim(),
    date: episodeFields.date.value || null,
  }, episodeEdit.existing)) $('episode-dialog').close()
}

function episodeControls(title) {
  const next = nextEpisode(episodeProgress(title), title.seasons)
  const controls = node('div', '', 'actions')
  if (next) controls.append(button('Mark next episode watched · S' + next.season + ' E' + next.episode,
    () => saveEpisode(title, {...next, date:today()}), 'primary'))
  else controls.append(node('p', title.seasons.length
    ? 'All known episodes watched.'
    : episodeLookups.get(title.imdb)?.phase === 'failed'
      ? 'IMDb episode information could not be loaded. Try again when online.'
      : episodeLookups.get(title.imdb)?.phase === 'empty'
        ? 'IMDb has no numbered episode information for this title yet.'
        : title.imdb ? 'Loading episodes from IMDb…' : 'Add an IMDb title link to load its episodes.'))
  controls.append(button('Log episode…', () => openEpisode(title, next ?? {season:1,episode:1})),
    button('Edit season counts…', () => openSeasons(title)))
  if (title.imdb) {
    const loading = episodeLookups.get(title.imdb)?.phase === 'loading'
    const refresh = button(loading ? 'Loading IMDb episodes…' : 'Refresh IMDb episodes',
      () => void fetchTitleEpisodes(title.imdb, true))
    refresh.disabled = loading
    controls.append(refresh)
  }
  return controls
}

function renderEpisodes(detail, title) {
  const section = node('section', '', 'episodes')
  const unique = new Set(title.episodes.map(view => view.season + ':' + view.episode)).size
  section.append(node('h3', 'Episodes'), node('p', unique + ' distinct episodes watched'), episodeControls(title))
  const selectedViews = new Set()
  const selectionCount = node('span', '0 viewings selected')
  const clearSelected = button('Clear selected viewings', () => {
    if (!selectedViews.size || !confirm('Clear ' + selectedViews.size + ' selected episode viewings?')) return
    const current = library.find(item => item.id === title.id)
    if (current) update(clearEpisodeViewings(current, selectedViews), 'Episode viewings cleared.')
  })
  clearSelected.disabled = true
  const checkboxes = []
  function selector(label, views) {
    const ids = views.map(view => view.id)
    const wrapper = node('label', '', 'episode-toggle')
    const input = node('input')
    input.type = 'checkbox'
    input.onchange = () => {
      for (const id of ids) {
        if (input.checked) selectedViews.add(id)
        else selectedViews.delete(id)
      }
      selectionCount.textContent = selectedViews.size + ' viewings selected'
      clearSelected.disabled = !selectedViews.size
      for (const entry of checkboxes) {
        const count = entry.ids.filter(id => selectedViews.has(id)).length
        entry.input.checked = count === entry.ids.length
        entry.input.indeterminate = count > 0 && count < entry.ids.length
      }
    }
    checkboxes.push({input,ids})
    wrapper.append(input, ' ' + label)
    return wrapper
  }
  if (title.episodes.length) {
    const actions = node('div', '', 'actions')
    actions.append(selector('Select all viewings', title.episodes),selectionCount,clearSelected)
    section.append(actions)
  }
  const seasons = new Map()
  for (const view of title.episodes) {
    const season = seasons.get(view.season) ?? []
    season.push(view)
    seasons.set(view.season, season)
  }
  const latest = Math.max(...seasons.keys())
  for (const [seasonNumber, views] of [...seasons].sort(([a], [b]) => a - b)) {
    const season = node('details')
    season.open = seasonNumber === latest
    const summary = node('summary', seasonNumber ? 'Season ' + seasonNumber : 'Specials')
    const items = node('ul', '', 'history')
    views.sort((a, b) => a.episode - b.episode || b.id.localeCompare(a.id))
    const episodeGroups = new Map()
    for (const view of views) {
      const group = episodeGroups.get(view.episode) ?? []
      group.push(view)
      episodeGroups.set(view.episode, group)
    }
    for (const [number, watched] of episodeGroups) {
      const first = watched[0]
      const name = watched.find(view => view.name)?.name
      const label = node('div', 'Episode ' + number + (name ? ' · ' + name : ''))
      label.prepend(selector('Select episode ' + number + ' viewings', watched))
      label.append(node('span', watched.length + (watched.length === 1 ? ' viewing' : ' viewings')))
      const episode = node('details')
      episode.append(node('summary', 'View dates'))
      for (const view of watched) {
        const row = node('div', '', 'actions')
        row.append(selector('Select viewing', [view]), node('span', view.date ? formatDate(view.date) : 'Date unknown'),
          button('Edit', () => openEpisode(title, view, view)),
          button('Remove', () => {
            if (confirm('Remove this episode viewing?')) {
              update({ ...title, episodes: title.episodes.filter(item => item.id !== view.id) }, 'Episode viewing removed.')
            }
          }))
        episode.append(row)
      }
      items.append(listItem(label, button('Log rewatch', () => openEpisode(title, { ...first, name })), episode))
    }
    season.append(summary, selector('Select season ' + seasonNumber + ' viewings', views), items)
    section.append(season)
  }
  detail.append(section)
}

function saveLists(next) {
  if (!validLists(next)) throw new Error('Invalid lists.')
  localStorage.setItem(listsKey, JSON.stringify(next))
  lists = next
  if (!lists.some(list => list.id === listSelection)) listSelection = null
  render()
  syncApp.changed?.()
}

function editLists(next, message) {
  try {
    saveLists(next)
    notice(message)
    return true
  } catch {
    notice('Could not save your lists.')
    return false
  }
}

const listForm = $('list-form')
const listName = listForm.elements.name
let editingList
let addToNewList

function openList(list, titleId) {
  editingList = list
  addToNewList = titleId
  listName.value = list?.name ?? ''
  listName.setCustomValidity('')
  $('list-heading').textContent = list ? 'Edit list' : 'New list'
  $('delete-list').hidden = !list
  $('list-dialog').showModal()
}

listName.oninput = () => listName.setCustomValidity('')
listForm.onsubmit = event => {
  event.preventDefault()
  const name = listName.value.trim()
  if (!name) return invalid(listName, 'Enter a list name.')
  const list = editingList ? { ...editingList, name }
    : { id: crypto.randomUUID(), name, members: addToNewList ? [addToNewList] : [] }
  const next = editingList ? lists.map(item => item.id === list.id ? list : item) : [...lists, list]
  listSelection = list.id
  if (editLists(next, 'List saved.')) $('list-dialog').close()
}
$('delete-list').onclick = () => {
  if (editingList && confirm('Delete this list? Titles will stay in your library.') &&
      editLists(lists.filter(list => list.id !== editingList.id), 'List deleted.')) $('list-dialog').close()
}

let membershipTitle
function openMemberships(title) {
  const regular = lists.filter(list => !list.rewatch)
  if (!regular.length) {
    openList(undefined, title.id)
    return
  }
  membershipTitle = title.id
  $('membership-heading').textContent = 'Add ' + title.title + ' to lists'
  $('memberships').replaceChildren(...regular.map(list => {
    const label = node('label', '', 'episode-toggle')
    const input = node('input')
    input.type = 'checkbox'
    input.value = list.id
    input.checked = list.members.includes(title.id)
    label.append(input, ' ' + list.name)
    return label
  }), button('+ New list', () => {
    $('membership-dialog').close()
    openList(undefined, title.id)
  }))
  $('membership-dialog').showModal()
}

$('membership-form').onsubmit = event => {
  event.preventDefault()
  const checked = new Set([...$('memberships').querySelectorAll('input:checked')].map(input => input.value))
  const next = lists.map(list => {
    if (list.rewatch || checked.has(list.id) === list.members.includes(membershipTitle)) return list
    return { ...list, members: checked.has(list.id)
      ? [...list.members, membershipTitle] : list.members.filter(id => id !== membershipTitle) }
  })
  if (editLists(next, 'List membership saved.')) $('membership-dialog').close()
}

function rewatchProgress(list) {
  const remaining = []
  let total = 0
  for (const [index, id] of list.members.entries()) {
    const title = library.find(item => item.id === id)
    if (!title) continue
    total++
    if (title.history.length <= list.rewatch.baseline[index]) remaining.push(title)
  }
  return { remaining, total }
}

function startInstallment(title) {
  if (!title.active) update(start(title), 'Installment started.')
  else { selected = title.id; render() }
}

function beginGroupRewatch(group) {
  const pending = lists.find(list => list.rewatch?.group === group.key && rewatchProgress(list).remaining.length)
  if (pending) {
    listSelection = pending.id
    render()
    return
  }
  if (!confirm('Start a rewatch of ' + group.name + '? Installments are queued in release order.')) return
  const members = library.filter(title => group.members.includes(title.id))
    .sort((a, b) => (Number(a.year) || 9999) - (Number(b.year) || 9999) ||
      a.title.localeCompare(b.title, undefined, { numeric: true }))
  const list = {
    id: crypto.randomUUID(), name: group.name.slice(0, 112) + ' rewatch',
    members: members.map(title => title.id),
    rewatch: { group: group.key, baseline: members.map(title => title.history.length) },
  }
  listSelection = list.id
  if (editLists([...lists, list], 'Group rewatch started.')) {
    startInstallment(members.find(title => title.active) ?? members[0])
  }
}

function renderLists(current) {
  $('list-tabs').replaceChildren(button('+ New list', () => openList()), ...lists.map(list => {
    const tab = button(list.name, () => {
      listSelection = list.id
      render()
      $('list-tabs').querySelector('[aria-pressed="true"]').focus()
    })
    tab.setAttribute('aria-pressed', String(list.id === current?.id))
    return tab
  }))
  const context = $('list-context')
  context.hidden = !current
  if (!current) return
  const heading = node('div', '', 'bar')
  heading.append(node('h2', current.name), button('Edit list', () => openList(current)))
  context.replaceChildren(heading)
  if (current.rewatch) {
    const { remaining, total } = rewatchProgress(current)
    context.append(node('p', (total - remaining.length) + ' of ' + total + ' installments watched on this rewatch'))
    const next = remaining.find(title => title.active) ?? remaining[0]
    if (next) context.append(button((next.active ? 'Open current installment · ' : 'Start next installment · ') + next.title,
      () => startInstallment(next), 'primary'))
  } else if (!current.members.some(id => library.some(title => title.id === id))) {
    context.append(node('p', 'Open a title and use Add to lists to put it here.'))
  }
}

for (const dialog of document.querySelectorAll('dialog')) {
  dialog.addEventListener('close', () => globalThis.QuietScreenAccount?.resume())
}

const seasonsForm = $('seasons-form')
function openSeasons(title) {
  seasonsForm.dataset.title = title.id
  seasonsForm.elements.seasons.value = title.seasons.map(item => item.season + ', ' + item.count).join('\n')
  seasonsForm.elements.seasons.setCustomValidity('')
  $('seasons-dialog').showModal()
}
seasonsForm.oninput = () => seasonsForm.elements.seasons.setCustomValidity('')
seasonsForm.onsubmit = event => {
  event.preventDefault()
  const input = seasonsForm.elements.seasons
  const seasons = input.value.split(/\r?\n/).filter(line => line.trim()).map(line => {
    const match = /^\s*(\d+)\s*,\s*(\d+)\s*$/.exec(line)
    return match ? {season:Number(match[1]), count:Number(match[2])} : null
  })
  if (!validSeasons(seasons)) return invalid(input, 'Use one unique season per line, such as 1, 10.')
  const title = library.find(item => item.id === seasonsForm.dataset.title)
  if (title && update({...title,seasons},'Season counts saved.')) $('seasons-dialog').close()
}

function scheduleEpisodeLookups() {
  clearTimeout(episodeLookupTimer)
  episodeLookupTimer = setTimeout(() => {
    const ids = new Set(library.filter(title => title.episodic && title.imdb && !title.seasons.length)
      .map(title => title.imdb))
    for (const id of ids) if (!episodeLookups.has(id)) void fetchTitleEpisodes(id)
  }, 50)
}

async function fetchTitleEpisodes(id, refresh = false) {
  if (episodeLookups.get(id)?.phase === 'loading') return
  episodeLookups.set(id, {phase:'loading'})
  if (selected) renderDetail(library.find(title => title.id === selected))
  try {
    const response = await fetch('/api/imdb-episodes?id=' + encodeURIComponent(id))
    if (!response.ok) throw Error()
    const result = await response.json()
    if (result.imdb !== id || !validSeasons(result.seasons)) throw Error()
    episodeLookups.set(id, {phase:result.seasons.length ? 'loaded' : 'empty'})
    if (result.seasons.length) {
      // Read current records after the download, preserving edits made while waiting.
      const next = library.map(title => title.imdb === id && title.episodic &&
        (refresh || !title.seasons.length) ? {...title,seasons:result.seasons} : title)
      if (next.some((title,index) => title !== library[index])) {
        if (!commit(next, selected, 'Episode information loaded from IMDb.')) throw Error()
      } else render()
    } else render()
  } catch {
    episodeLookups.set(id, {phase:'failed'})
    if (selected) renderDetail(library.find(title => title.id === selected))
  }
}


let franchiseMembers = null
let franchiseRequest = null
let franchiseBusy = false
let franchiseEpoch = 0
let franchiseProposals = []
const bundleForm = $('bundle-form')
let originalBundleMembers = []
let bundleIdentity

function openBundle(group) {
  originalBundleMembers = group ? [...group.members] : []
  bundleIdentity = group?.id ?? crypto.randomUUID()
  bundleForm.elements.name.value = group?.name ?? ''
  bundleForm.elements.name.setCustomValidity('')
  $('bundle-heading').textContent = group ? 'Manage bundle' : 'Bundle titles'
  $('bundle-message').textContent = ''
  $('unbundle-titles').hidden = !group
  const selected = new Set(originalBundleMembers)
  $('bundle-members').replaceChildren(...library.map(title => {
    const label = node('label', '', 'episode-toggle')
    const input = node('input')
    input.type = 'checkbox'
    input.value = title.id
    input.checked = selected.has(title.id)
    label.append(input, ' ' + title.title)
    return label
  }))
  $('bundle-dialog').showModal()
}

bundleForm.elements.name.oninput = () => bundleForm.elements.name.setCustomValidity('')
bundleForm.onsubmit = event => {
  event.preventDefault()
  const name = bundleForm.elements.name.value.trim()
  if (!name) return invalid(bundleForm.elements.name, 'Enter a bundle name.')
  const members = [...$('bundle-members').querySelectorAll('input:checked')].map(input => input.value)
  if (!members.length) {
    $('bundle-message').textContent = 'Select at least one title, or use Unbundle all.'
    return
  }
  if (commit(setBundle(library, members, name, originalBundleMembers, bundleIdentity), selected, 'Bundle saved.')) $('bundle-dialog').close()
}
$('unbundle-titles').onclick = () => {
  if (confirm('Unbundle these titles? Each title will become standalone.') &&
      commit(unbundle(library, originalBundleMembers), selected, 'Titles unbundled.')) $('bundle-dialog').close()
}
$('bundle-titles').onclick = () => openBundle()

function lookupScope() {
  return franchiseMembers ? library.filter(title => franchiseMembers.includes(title.id)) : library
}

function renderFranchiseScope() {
  const scoped = lookupScope()
  const checked = scoped.filter(franchiseChecked).length
  const targets = franchiseTargets(scoped, $('franchise-scope').value === 'all')
  const missing = scoped.filter(title => !/^tt\d{7,}$/.test(title.imdb)).length
  $('franchise-scope-summary').textContent = targets.length + ' titles to look up · ' + checked +
    ' already checked' + (missing ? ' · ' + missing + ' need an IMDb link' : '')
  $('run-franchise-lookup').disabled = franchiseBusy || !targets.length
  $('franchise-scope').disabled = franchiseBusy
  $('cancel-franchise-lookup').hidden = !franchiseBusy
}

function sourceLink(label, id) {
  const source = node('a', label)
  source.href = 'https://www.wikidata.org/wiki/' + id
  source.target = '_blank'
  source.rel = 'noopener noreferrer'
  return source
}

function renderFranchiseResults() {
  const scoped = lookupScope()
  const scopeIds = new Set(scoped.map(title => title.id))
  franchiseProposals = franchiseSuggestions(library).filter(group => group.members.some(id => scopeIds.has(id)))
  const results = []
  for (const [index, proposal] of franchiseProposals.entries()) {
    const card = node('section', '', 'franchise-proposal')
    const label = node('label', '', 'episode-toggle')
    const checkbox = node('input')
    checkbox.type = 'checkbox'
    checkbox.dataset.proposal = String(index)
    label.append(checkbox, ' Bundle as ' + proposal.name)
    const members = proposal.members.map(id => library.find(title => title.id === id))
    card.append(label, node('p', members.map(title => title.title).join(' · ')))
    const sources = node('div', '', 'actions')
    for (const evidence of proposal.evidence.slice(0, 5)) sources.append(sourceLink(evidence.label || 'Connection source', evidence.id))
    card.append(sources)
    results.push(card)
  }
  const rows = node('ul', '', 'franchise-checked')
  for (const title of scoped) {
    const checked = franchiseChecked(title)
    const connected = franchiseProposals.some(group => group.members.includes(title.id))
    const item = node('li')
    item.append(node('strong', title.title), node('span', !checked
      ? title.imdb ? 'Not checked' : 'Add an IMDb link to check'
      : !title.franchiseCheck.entity ? 'Checked · no matching source entry'
      : connected ? 'Checked · connections found'
      : 'Checked · no matching connections in your library'))
    if (checked && title.franchiseCheck.entity) item.append(sourceLink('Source ↗', title.franchiseCheck.entity))
    rows.append(item)
  }
  if (results.length) results.unshift(node('p', 'Select the bundles you want to apply. Saving lookup results only records that titles were checked.'))
  results.push(rows)
  $('franchise-results').replaceChildren(...results)
  $('apply-franchise-bundles').hidden = !franchiseProposals.length
  $('apply-franchise-bundles').disabled = franchiseBusy
}

function openFranchiseLookup(members = null) {
  franchiseEpoch++
  franchiseRequest?.abort()
  franchiseMembers = members ? [...members] : null
  franchiseBusy = false
  $('franchise-scope').value = members ? 'all' : 'unchecked'
  $('franchise-progress').textContent = ''
  renderFranchiseScope()
  renderFranchiseResults()
  $('franchise-dialog').showModal()
}
$('franchise-lookup').onclick = () => openFranchiseLookup()
$('franchise-scope').onchange = renderFranchiseScope
$('cancel-franchise-lookup').onclick = () => franchiseRequest?.abort()
$('franchise-dialog').addEventListener('close', () => {
  franchiseEpoch++
  franchiseRequest?.abort()
})

$('run-franchise-lookup').onclick = async () => {
  if (franchiseBusy) return
  const targets = franchiseTargets(lookupScope(), $('franchise-scope').value === 'all')
  const ids = [...new Set(targets.map(title => title.imdb))]
  if (!ids.length) return
  const epoch = franchiseEpoch
  const controller = new AbortController()
  franchiseRequest = controller
  franchiseBusy = true
  renderFranchiseScope()
  renderFranchiseResults()
  let completed = 0
  try {
    for (let offset = 0; offset < ids.length; offset += 30) {
      const batch = ids.slice(offset, offset + 30)
      $('franchise-progress').textContent = 'Looking up connections… ' + completed + ' of ' + ids.length
      const response = await fetch('/api/franchises', {
        method: 'POST', signal: controller.signal,
        headers: { 'Content-Type': 'application/json', 'X-Quiet-Screen-Catalogue': '1' },
        body: JSON.stringify({ids:batch}),
      })
      const data = await response.json()
      if (!response.ok) throw Error(data.error || 'Franchise lookup failed.')
      if (!Array.isArray(data.results) || data.results.length !== batch.length ||
          !data.results.every(validFranchiseCheck) ||
          new Set(data.results.map(result => result.imdb)).size !== batch.length ||
          data.results.some(result => !batch.includes(result.imdb))) throw Error('The lookup returned invalid title results.')
      if (controller.signal.aborted || epoch !== franchiseEpoch) return
      const matches = new Map(data.results.map(result => [result.imdb, result]))
      const next = library.map(title => matches.has(title.imdb) && targets.some(target => target.id === title.id && target.imdb === title.imdb)
        ? {...title,franchiseCheck:matches.get(title.imdb)} : title)
      if (!commit(next, selected, 'Franchise lookup results saved.')) throw Error('Could not save checked titles.')
      completed += batch.length
      renderFranchiseResults()
    }
    $('franchise-progress').textContent = 'Checked ' + completed + ' titles. Review suggested bundles below.'
  } catch (error) {
    if (epoch !== franchiseEpoch) return
    $('franchise-progress').textContent = controller.signal.aborted
      ? 'Lookup cancelled. Completed checks were kept.'
      : error.message + ' Completed checks were kept; failed titles can be retried.'
  } finally {
    if (epoch === franchiseEpoch) {
      franchiseBusy = false
      franchiseRequest = null
      renderFranchiseScope()
      renderFranchiseResults()
    }
  }
}

$('apply-franchise-bundles').onclick = () => {
  if (franchiseBusy) return
  const choices = [...$('franchise-results').querySelectorAll('input[data-proposal]:checked')]
    .map(input => franchiseProposals[Number(input.dataset.proposal)]).filter(Boolean)
  if (!choices.length) {
    $('franchise-progress').textContent = 'Select at least one suggested bundle.'
    return
  }
  let next = library
  for (const proposal of choices) next = setBundle(next, proposal.members, proposal.name, [], proposal.id)
  if (commit(next, selected, 'Selected franchise bundles saved.')) {
    $('franchise-progress').textContent = 'Selected bundles applied. You can manage or unbundle them from the library.'
    renderFranchiseResults()
  }
}

globalThis.QuietScreenApp = syncApp
initializeLibraryView()
render()
await import('./sync/account.js')

function rememberLibraryView() {
  try { localStorage.setItem(libraryViewKey, JSON.stringify({ ...libraryView, collapsed: [...collapsedGroups] })) }
  catch { notice('Could not save the library view.') }
}

function initializeLibraryView() {
  const sort = $('library-sort')
  sort.value = libraryView.sort
  sort.onchange = () => {
    libraryView.sort = sort.value
    rememberLibraryView()
    render()
  }
  for (const [id, key] of [['show-groups', 'groups'], ['show-standalone', 'standalone'], ['plain-library', 'plain']]) {
    const input = $(id)
    input.checked = libraryView[key]
    input.onchange = () => {
      libraryView[key] = input.checked
      $('show-groups').disabled = $('show-standalone').disabled = libraryView.plain
      rememberLibraryView()
      render()
    }
  }
  $('show-groups').disabled = $('show-standalone').disabled = libraryView.plain
}

function renderInsights() {
  const { counts, months, undated } = viewingInsights(library)
  $('status-breakdown').replaceChildren(...Object.entries(counts).map(([label, count]) => {
    const row = node('div', '', 'insight-status')
    row.append(node('span', label), node('strong', String(count)))
    return row
  }))
  const total = months.reduce((sum, month) => sum + month.count, 0)
  $('watch-activity-summary').textContent = total + ' in the past 12 months' +
    (undated ? ' · ' + undated + ' with unknown dates' : '')
  const scale = Math.max(1, ...months.map(month => month.count))
  const shortMonth = new Intl.DateTimeFormat(undefined, { month: 'short' })
  const fullMonth = new Intl.DateTimeFormat(undefined, { month: 'long', year: 'numeric' })
  $('watch-activity').replaceChildren(...months.map(({ date, count }) => {
    const column = node('li')
    const marker = node('span', '', 'month-bar')
    marker.style.height = (count / scale * 100) + '%'
    const track = node('span', '', 'month-track')
    track.setAttribute('aria-hidden', 'true')
    track.append(marker)
    column.setAttribute('aria-label', fullMonth.format(date) + ' · ' + count)
    column.title = fullMonth.format(date) + ' · ' + count
    column.append(track, node('span', shortMonth.format(date), 'month-label'))
    return column
  }))
}
