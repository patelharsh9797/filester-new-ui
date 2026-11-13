// Plan a bulk rename: work out every new name first, flag problems, change nothing.
// Pure, so it can be previewed live and unit-tested.

export interface RenameFile {
  id: number
  slug: string
  name: string
  folder_id: string | null
  created_at: string
}

export type RenameOrder = 'current' | 'name' | 'date'

export interface RenameOptions {
  mode: 'pattern' | 'replace'
  /** Tokens: {name} {folder} {n} {date} {ext}. The extension is kept automatically unless {ext} is used. */
  pattern: string
  /** First number for {n} */
  start: number
  /** Minimum digits for {n}; 0 = just enough for the count (e.g. 01…12) */
  pad: number
  /** Restart {n} in every folder */
  perFolder: boolean
  order: RenameOrder
  find: string
  replace: string
  matchCase: boolean
}

export const DEFAULT_RENAME: RenameOptions = {
  mode: 'pattern', pattern: '{folder} {n}', start: 1, pad: 0, perFolder: true, order: 'current',
  find: '', replace: '', matchCase: false,
}

export type RenameStatus = 'rename' | 'same' | 'clash' | 'invalid'
export interface RenameRow<F extends RenameFile = RenameFile> {
  file: F
  to: string
  status: RenameStatus
  reason?: string
}
export interface RenamePlan<F extends RenameFile = RenameFile> {
  rows: RenameRow<F>[]
  toRename: RenameRow<F>[]
  counts: Record<RenameStatus, number>
  /** True when anything would clash or is invalid: renaming is blocked until fixed */
  blocked: boolean
}

export const MAX_NAME = 200

export function splitName(name: string): { stem: string; ext: string } {
  const i = name.lastIndexOf('.')
  return i > 0 && i < name.length - 1 ? { stem: name.slice(0, i), ext: name.slice(i + 1) } : { stem: name, ext: '' }
}

/** Characters Filester (and most systems) can't take in a file name become "_"; spaces are tidied. */
export function cleanName(s: string): string {
  return [...s].map((c) => (c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127 || c === '/' || c === '\\' ? '_' : c)).join('')
    .replace(/\s+/g, ' ').trim()
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/**
 * @param folderName  display name for {folder} (null folder = unfiled)
 * @param others      names of files in each folder that are NOT being renamed (key: folder id or '' for unfiled)
 */
export function planRenames<F extends RenameFile>(
  files: F[],
  o: RenameOptions,
  folderName: (id: string | null) => string,
  others: (folderKey: string) => Iterable<string>,
): RenamePlan<F> {
  const ordered = o.order === 'current' ? [...files]
    : o.order === 'name' ? [...files].sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }))
    : [...files].sort((a, b) => a.created_at.localeCompare(b.created_at) || a.id - b.id)

  // Numbering: one sequence, or one per folder.
  const counters = new Map<string, number>()
  const totals = new Map<string, number>()
  for (const f of ordered) { const k = o.perFolder ? f.folder_id ?? '' : '*'; totals.set(k, (totals.get(k) ?? 0) + 1) }

  const rows: RenameRow<F>[] = ordered.map((f) => {
    const { stem, ext } = splitName(f.name)
    let to: string
    if (o.mode === 'replace') {
      if (!o.find) to = f.name
      else {
        const re = new RegExp(escapeRe(o.find), o.matchCase ? 'g' : 'gi')
        to = stem.replace(re, () => o.replace) + (ext ? `.${ext}` : '') // the extension is never touched
      }
    } else {
      const k = o.perFolder ? f.folder_id ?? '' : '*'
      const i = counters.get(k) ?? 0
      counters.set(k, i + 1)
      const last = o.start + (totals.get(k) ?? 1) - 1
      const width = Math.max(o.pad, o.pad === 0 ? String(last).length : 0)
      const n = String(o.start + i).padStart(width, '0')
      const body = o.pattern
        .replace(/\{name\}/gi, stem)
        .replace(/\{folder\}/gi, folderName(f.folder_id))
        .replace(/\{n\}/gi, n)
        .replace(/\{date\}/gi, (f.created_at || '').slice(0, 10))
        .replace(/\{ext\}/gi, ext)
      to = /\{ext\}/i.test(o.pattern) || !ext ? body : `${body}.${ext}`
    }
    to = cleanName(to)
    if (!splitName(to).stem || to.startsWith('.')) return { file: f, to, status: 'invalid', reason: 'Name is empty' }
    if (to.length > MAX_NAME) return { file: f, to, status: 'invalid', reason: `Longer than ${MAX_NAME} characters` }
    return { file: f, to, status: to === f.name ? 'same' : 'rename' }
  })

  // Clashes: two files ending up with the same name in one folder (case-insensitive),
  // counting the files that aren't part of this rename.
  const byFolder = new Map<string, RenameRow<F>[]>()
  for (const r of rows) { const k = r.file.folder_id ?? ''; byFolder.set(k, [...(byFolder.get(k) ?? []), r]) }
  for (const [k, list] of byFolder) {
    const taken = new Map<string, number>()
    for (const n of others(k)) taken.set(n.toLowerCase(), (taken.get(n.toLowerCase()) ?? 0) + 1)
    const planned = new Map<string, number>()
    for (const r of list) planned.set(r.to.toLowerCase(), (planned.get(r.to.toLowerCase()) ?? 0) + 1)
    for (const r of list) {
      if (r.status === 'invalid') continue
      const key = r.to.toLowerCase()
      if ((planned.get(key) ?? 0) > 1) { r.status = 'clash'; r.reason = 'Another selected file gets the same name' }
      else if (r.status === 'rename' && taken.has(key)) { r.status = 'clash'; r.reason = 'A file with this name is already in the folder' }
    }
  }

  const counts = { rename: 0, same: 0, clash: 0, invalid: 0 }
  for (const r of rows) counts[r.status]++
  return { rows, toRename: rows.filter((r) => r.status === 'rename'), counts, blocked: counts.clash + counts.invalid > 0 }
}
