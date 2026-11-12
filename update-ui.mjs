const $ = id => document.getElementById(id)
const desktop = location.protocol === 'quiet-screen:'
const preferenceKey = 'quiet-screen-auto-updates'
const releases = 'https://github.com/ayca-kaygusuz/quiet-screen/releases/latest'
const busyPhases = ['checking', 'downloading', 'verifying', 'installing']
const progressPhases = ['downloading', 'verifying', 'ready', 'installing']
let state = { phase: 'idle', enabled: true }
let preference = true
let requested = false
let dismissed = false
let pending = false
let pollTimer
let lastAttempt = 0
let networkSent = ''
let connectionQueue = Promise.resolve()

try { preference = localStorage.getItem(preferenceKey) !== 'false' } catch {}
$('auto-updates').checked = preference

function connection() {
  const account = globalThis.QuietScreenAccount?.status()
  const online = account?.online ?? navigator.onLine
  const metered = account?.metered ?? (navigator.connection?.saveData === true || navigator.connection?.type === 'cellular')
  return { online, metered, autoCheck: preference }
}

const size = bytes => (Math.max(0, Number(bytes) || 0) / 1024 ** 2).toFixed(1) + ' MB'
function view() {
  const { phase, enabled, version, currentVersion, lastChecked } = state
  const busy = pending || busyPhases.includes(phase)
  const network = connection()
  const offline = !network.online || state.pausedReason === 'offline'
  const metered = network.metered || state.pausedReason === 'metered'
  const percentage = Math.min(100, Math.max(0, Math.round((state.progress ?? 0) * 100)))
  const heading = {
    idle: 'Updates', checking: 'Checking for updates…', available: 'Update available',
    downloading: 'Downloading update…', verifying: 'Verifying installer…', ready: 'Update ready',
    installing: 'Installing update…', 'up-to-date': 'You’re up to date',
    unavailable: 'GitHub sign-in may be required', error: 'Update check failed',
  }[phase] ?? 'Updates'
  const detail = {
    idle: 'Check GitHub for the latest release.',
    checking: 'Looking for a newer release.',
    available: desktop ? 'Download the verified installer when you’re ready.' : 'Open GitHub Releases for the latest version.',
    downloading: size(state.downloaded) + ' of ' + size(state.total) + ' · ' + percentage + '%',
    verifying: 'Checking the downloaded installer’s size and SHA-256 checksum.',
    ready: 'The installer is verified. Restart when you’re ready.',
    installing: 'Quiet Screen will reopen after installation.',
    'up-to-date': 'You have the latest available version.',
    unavailable: 'Open GitHub Releases in your browser. A private repository requires GitHub sign-in.',
    error: 'The update could not be completed. Try checking again.',
  }[phase] ?? ''
  $('current-version').textContent = currentVersion ? 'v' + currentVersion : ''
  $('update-policy').textContent = !enabled ? 'In-app updates are available in installed Windows builds.'
    : offline ? 'Update checks are paused while offline.'
    : !preference ? 'Automatic checks are off. You can still check manually.'
    : metered ? 'Automatic checks are paused on this metered connection.'
    : 'Quiet Screen checks automatically while open.'
  $('update-status').textContent = heading + (version ? ' · v' + version : '') + '. ' + detail
  $('update-checked').textContent = lastChecked ? 'Last checked ' + new Date(lastChecked).toLocaleString() : ''
  $('check-updates').disabled = busy || offline || !enabled
  const next = phase === 'available' ? (desktop ? 'download' : 'release') : phase === 'ready' ? 'install' : ''
  const actionText = { download: 'Download update', install: 'Restart and update', release: 'Open release' }[next]
  for (const id of ['inline-update', 'card-update']) {
    const button = $(id)
    button.hidden = !next
    button.textContent = actionText || ''
    button.disabled = busy || (offline && next !== 'install')
    button.onclick = next ? () => void perform(next) : null
  }
  const chip = $('update-chip')
  chip.hidden = !progressPhases.includes(phase) && phase !== 'available' && !requested
  chip.textContent = phase === 'downloading' ? 'Update · ' + percentage + '%' : phase === 'ready' ? 'Update ready' : 'Updates'
  const visible = (requested || progressPhases.includes(phase)) && !dismissed
  chip.setAttribute('aria-expanded', String(visible))
  $('update-card').hidden = !visible
  $('update-heading').textContent = heading + (version ? ' · v' + version : '')
  $('update-detail').textContent = detail
  const progress = $('update-progress')
  progress.hidden = !progressPhases.includes(phase)
  if (phase === 'verifying') progress.removeAttribute('value')
  else progress.value = percentage
}

function apply(next) {
  state = { ...state, ...next }
  view()
}

async function desktopAction(action, body) {
  const response = await fetch('/api/update-action?action=' + action, {
    method: 'POST',
    headers: { 'X-Quiet-Screen-Update': '1', ...(body ? { 'Content-Type': 'application/json' } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  })
  if (!response.ok) throw new Error('Update request failed.')
  return response.json()
}

let polling = false
async function poll() {
  clearTimeout(pollTimer)
  if (polling) return
  polling = true
  try {
    const response = await fetch('/api/update-status', { cache: 'no-store' })
    if (!response.ok) throw new Error()
    apply(await response.json())
  } catch {
    apply({ phase: 'error' })
  } finally {
    polling = false
    if (state.enabled) pollTimer = setTimeout(poll, busyPhases.includes(state.phase) ? 400 : 1800)
  }
}

async function browserCheck(manual) {
  const current = connection()
  if (pending || !current.online || (!manual && (!current.autoCheck || current.metered ||
    document.hidden || Date.now() - lastAttempt < 86_400_000))) return
  lastAttempt = Date.now()
  pending = true
  apply({ phase: 'checking' })
  try {
    const response = await fetch('/api/update-check', { cache: 'no-store' })
    if (!response.ok) throw new Error()
    const result = await response.json()
    apply({ ...result, version: result.version ?? '', lastChecked: result.checkedAt })
  } catch {
    lastAttempt = Date.now() - 86_100_000
    apply({ phase: 'error' })
  } finally {
    pending = false
    view()
  }
}

async function perform(action) {
  if (action === 'release') {
    window.open(releases, '_blank', 'noopener,noreferrer')
    return
  }
  if (!desktop) return browserCheck(true)
  if (pending) return
  if (action === 'install' && document.querySelector('dialog[open]')) {
    $('update-detail').textContent = 'Save or close the open form before restarting.'
    return
  }
  pending = true
  if (action === 'download') { requested = true; dismissed = false }
  view()
  try {
    await connectionQueue
    apply(await desktopAction(action))
  } catch {
    apply({ phase: 'error' })
  } finally {
    pending = false
    void poll()
  }
}

function connectionChanged() {
  view()
  if (!desktop || !state.enabled) return
  const settings = connection()
  const key = JSON.stringify(settings)
  if (key === networkSent) return
  networkSent = key
  connectionQueue = connectionQueue.then(async () => {
    try { apply(await desktopAction('configure', settings)) }
    catch { networkSent = '' }
  })
}

$('check-updates').onclick = () => void perform('check')
$('auto-updates').onchange = () => {
  preference = $('auto-updates').checked
  try { localStorage.setItem(preferenceKey, String(preference)) } catch {}
  connectionChanged()
  if (!desktop) void browserCheck(false)
}
$('update-chip').onclick = () => {
  requested = true
  dismissed = false
  view()
  $('update-card').focus()
}
$('hide-update-card').onclick = () => {
  requested = false
  dismissed = true
  view()
  if (!$('update-chip').hidden) $('update-chip').focus()
}
globalThis.QuietScreenUpdates = { connectionChanged }
for (const event of ['online', 'offline']) {
  addEventListener(event, () => {
    connectionChanged()
    if (!desktop) void browserCheck(false)
  })
}
navigator.connection?.addEventListener('change', connectionChanged)
document.addEventListener('visibilitychange', () => {
  if (document.hidden) return
  if (desktop) void poll()
  else void browserCheck(false)
})
view()
if (desktop) void poll().then(connectionChanged)
else {
  setTimeout(() => void browserCheck(false), 15_000)
  setInterval(() => void browserCheck(false), 60_000)
}
