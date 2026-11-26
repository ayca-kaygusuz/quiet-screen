export const franchiseRelations = ['P8345', 'P179', 'P361', 'P144', 'P155', 'P156']

export function validFranchiseCheck(value) {
  return Boolean(value && typeof value.imdb === 'string' && /^tt\d{7,}$/.test(value.imdb) &&
    typeof value.checkedAt === 'string' && value.checkedAt.length <= 40 && Number.isFinite(Date.parse(value.checkedAt)) &&
    (value.entity === null || typeof value.entity === 'string' && /^Q\d{1,16}$/.test(value.entity)) && Array.isArray(value.links) && value.links.length <= 200 &&
    value.links.every(link => link && typeof link.id === 'string' && /^Q\d{1,16}$/.test(link.id) && franchiseRelations.includes(link.relation) &&
      typeof link.label === 'string' && link.label.length <= 300))
}

export function franchiseChecked(title) {
  return Boolean(title && validFranchiseCheck(title.franchiseCheck) && title.franchiseCheck.imdb === title.imdb)
}

export function franchiseTargets(library, includeChecked = false, members = null) {
  const scope = members ? new Set(members) : null
  return library.filter(title => (!scope || scope.has(title.id)) && /^tt\d{7,}$/.test(title.imdb) &&
    (includeChecked || !franchiseChecked(title)))
}

export function franchiseSuggestions(library) {
  const matched = library.filter(title => franchiseChecked(title) && title.franchiseCheck.entity)
  const parents = new Map(matched.map(title => [title.id, title.id]))
  function root(id) {
    while (parents.get(id) !== id) id = parents.get(id)
    return id
  }
  const anchors = new Map()
  for (const title of matched) {
    for (const id of [title.franchiseCheck.entity, ...title.franchiseCheck.links.map(link => link.id)]) {
      if (anchors.has(id)) parents.set(root(title.id), root(anchors.get(id)))
      else anchors.set(id, title.id)
    }
  }
  const groups = new Map()
  for (const title of matched) {
    const key = root(title.id)
    const group = groups.get(key) ?? []
    group.push(title)
    groups.set(key, group)
  }
  return [...groups.values()].filter(titles => titles.length > 1).map(titles => {
    const frequency = new Map()
    for (const title of titles) {
      for (const link of title.franchiseCheck.links) {
        const entry = frequency.get(link.id) ?? { ...link, count: 0 }
        entry.count++
        frequency.set(link.id, entry)
      }
    }
    const anchor = [...frequency.values()].sort((a, b) =>
      Number(b.relation === 'P8345') - Number(a.relation === 'P8345') || b.count - a.count || a.id.localeCompare(b.id))[0]
    const first = [...titles].sort((a, b) => (Number(a.year) || 9999) - (Number(b.year) || 9999) || a.id.localeCompare(b.id))[0]
    return { id: 'wikidata-' + (anchor?.id ?? first.franchiseCheck.entity), members: titles.map(title => title.id), name: (anchor?.label || first.title).slice(0, 120),
      evidence: [...frequency.values()].filter(link => link.count > 1 || titles.some(title => title.franchiseCheck.entity === link.id)) }
  })
}

export function setBundle(library, members, name, previousMembers = [], id = crypto.randomUUID()) {
  const selected = new Set(members)
  const previous = new Set(previousMembers)
  const normalized = name.trim()
  if (!normalized || normalized.length > 120 || !/^[a-zA-Z0-9_-]{1,100}$/.test(id)) throw Error('Enter a bundle name.')
  return library.map(title => selected.has(title.id) ? { ...title, group: { mode: 'manual', name: normalized, id } }
    : previous.has(title.id) ? { ...title, group: { mode: 'none', name: '' } } : title)
}

export function unbundle(library, members) {
  const selected = new Set(members)
  return library.map(title => selected.has(title.id) ? { ...title, group: { mode: 'none', name: '' } } : title)
}
