// Filester has no versioned public contract for most of what this app uses (the web
// endpoints behind its own site, the CSV export). When it changes something, we'd
// rather say so clearly than show empty pages or, worse, act on wrong data.
//
// Each response the app depends on is checked against the few fields it actually
// reads. Extra fields are fine; missing or mistyped ones raise FilesterChangedError.

export type Kind = 'string' | 'number' | 'boolean' | 'array' | 'object' | 'null'
/** Field → allowed kinds, e.g. { id: 'number', parent: 'string|null' } */
export type Spec = Record<string, `${Kind}` | `${Kind}|${Kind}` | `${Kind}|${Kind}|${Kind}`>

export class FilesterChangedError extends Error {
  status = 502
  endpoint: string
  detail: string
  constructor(endpoint: string, detail: string) {
    super(`Filester changed how “${endpoint}” responds (${detail}). This app may need an update — check Settings → Filester connection.`)
    this.name = 'FilesterChangedError'
    this.endpoint = endpoint
    this.detail = detail
  }
}

export function kindOf(v: unknown): Kind {
  if (v === null || v === undefined) return 'null'
  if (Array.isArray(v)) return 'array'
  const t = typeof v
  return t === 'string' || t === 'number' || t === 'boolean' ? t : 'object'
}

/** Check one object; returns a description of the first problem, or null. */
export function problemIn(value: unknown, spec: Spec, where = 'response'): string | null {
  if (kindOf(value) !== 'object') return `${where} is ${kindOf(value)}, expected an object`
  const o = value as Record<string, unknown>
  for (const [field, kinds] of Object.entries(spec)) {
    const k = kindOf(o[field])
    if (!kinds.split('|').includes(k)) return k === 'null' ? `${where}.${field} is missing` : `${where}.${field} is ${k}, expected ${kinds.replace(/\|/g, ' or ')}`
  }
  return null
}

/** Throw if `value` doesn't match `spec`. */
export function expectShape<T>(endpoint: string, value: unknown, spec: Spec): T {
  const p = problemIn(value, spec)
  if (p) throw new FilesterChangedError(endpoint, p)
  return value as T
}

/** Throw if `list` isn't an array (null allowed) or its first items don't match. */
export function expectList<T>(endpoint: string, list: unknown, spec: Spec, sample = 3): T[] {
  if (list === null || list === undefined) return []
  if (!Array.isArray(list)) throw new FilesterChangedError(endpoint, `expected a list, got ${kindOf(list)}`)
  for (let i = 0; i < Math.min(sample, list.length); i++) {
    const p = problemIn(list[i], spec, `item ${i + 1}`)
    if (p) throw new FilesterChangedError(endpoint, p)
  }
  return list as T[]
}

// ---------------------------------------------------------------- what the app reads

export const SHAPES = {
  account: { id: 'number', username: 'string', storage_used: 'number', storage_limit: 'number' },
  folder: { id: 'string', name: 'string', file_count: 'number', created_at: 'string', parent: 'string|null', public: 'boolean' },
  file: { id: 'number', name: 'string', size: 'number', url: 'string', created_at: 'string', folder_id: 'string|null' },
  pagination: { pages: 'number', total: 'number' },
  fileInfo: { slug: 'string', original_name: 'string', size: 'number' },
  folderInfo: { name: 'string', has_password: 'boolean', hide_related: 'boolean' },
  managerFolder: { Identifier: 'string' },
  stats: { totals: 'object', sparkline: 'array', heatmap: 'array|null' },
  statsTotals: { d24: 'number', d7: 'number', d30: 'number' },
  statsDay: { day: 'string', downloads: 'number' },
  viewTicket: { server: 'string', file: 'string', token: 'string' },
} satisfies Record<string, Spec>

/** CSV export columns the app reads. */
export const EXPORT_COLUMNS = ['file_id', 'uuid', 'slug', 'original_name', 'size_bytes', 'upload_date', 'downloads', 'last_viewed', 'last_downloaded', 'album_slug', 'download_url']

export function expectColumns(endpoint: string, row: Record<string, string> | undefined) {
  if (!row) return
  const missing = EXPORT_COLUMNS.filter((c) => !(c in row))
  if (missing.length) throw new FilesterChangedError(endpoint, `column${missing.length > 1 ? 's' : ''} ${missing.join(', ')} missing`)
}
