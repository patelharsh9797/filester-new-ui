import { parseCsv } from './csv'
import { FilesterChangedError, SHAPES, expectColumns, expectList, expectShape } from './shape'
import type { Account, FileInfo, FileItem, Folder, FolderInfo, Pagination } from './types'

export class ApiError extends Error {
  status: number
  constructor(message: string, status: number) {
    super(message)
    this.status = status
  }
}

let onUnauthorized: (() => void) | null = null

export function setUnauthorizedHandler(fn: () => void) {
  onUnauthorized = fn
}

type Base = 'v1' | 'u1' | 'web'

async function request<T>(base: Base, path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers)
  if (init.body && typeof init.body === 'string') headers.set('content-type', 'application/json')
  // Credentials travel in the HttpOnly session cookie; the server attaches them.
  const res = await fetch(`/api/fs/${base}/${path}`, { ...init, headers, credentials: 'same-origin' })
  let data: unknown = null
  const text = await res.text()
  try {
    data = text ? JSON.parse(text) : null
  } catch {
    // A web page where JSON was expected: the endpoint moved or changed.
    if (res.ok) throw new FilesterChangedError(path.split('?')[0], 'got a web page instead of data')
    data = { message: text.slice(0, 200) }
  }
  const d = data as { success?: boolean; message?: string } | null
  if (res.status === 401) {
    onUnauthorized?.()
    throw new ApiError(d?.message || 'Session expired — please sign in again', 401)
  }
  if (res.status === 429) {
    const wait = res.headers.get('retry-after')
    throw new ApiError(`Rate limited by Filester${wait ? ` — retry in ${wait}s` : ''}`, 429)
  }
  if (!res.ok || (d && d.success === false)) {
    throw new ApiError(d?.message || `Request failed (${res.status})`, res.status)
  }
  return data as T
}

export interface FileActivity {
  uploadDate: string
  lastViewed: string
  lastDownloaded: string
  views: number
  downloads: number
}

export interface FileListing {
  files: FileItem[]
  /** Last view/download dates keyed by slug; null when only the API fallback worked */
  activity: Map<string, FileActivity> | null
  source: 'export' | 'api'
  /** Why the export failed, when we fell back to the API */
  exportError?: string
}

/**
 * Every file in the account. Uses Filester's CSV export (one web request,
 * doesn't count against the API key, and includes last view/download dates);
 * falls back to the paginated REST API (100 files per call) if that fails.
 */
export async function getFileListing(onProgress?: (loaded: number, total: number) => void): Promise<FileListing> {
  try {
    return await getFromExport()
  } catch (e) {
    if (e instanceof ApiError && e.status === 401) throw e
    // Changed export format: fall back to the API, but keep the reason visible.
    const files = await getAllFiles(onProgress)
    return { files, activity: null, source: 'api', exportError: (e as Error).message }
  }
}

/** The CSV export alone (no API fallback). */
export async function getFromExport(): Promise<FileListing> {
  const res = await fetch('/api/fs/web/files/export.csv', { credentials: 'same-origin' })
  if (res.status === 401) {
    onUnauthorized?.()
    throw new ApiError('Session expired — please sign in again', 401)
  }
  const text = await res.text()
  if (!res.ok || text.trimStart().startsWith('{') || text.trimStart().startsWith('<')) {
    let message = `File export failed (${res.status})`
    try { message = (JSON.parse(text) as { message?: string }).message || message } catch { /* not JSON */ }
    throw new ApiError(message, res.status)
  }
  const rows = parseCsv(text)
  expectColumns('files/export.csv', rows[0])
  const files: FileItem[] = []
  const activity = new Map<string, FileActivity>()
  for (const r of rows) {
    if (!r.slug) continue
    files.push({
      id: Number(r.file_id) || 0,
      uuid: r.uuid,
      name: r.original_name,
      size: Number(r.size_bytes) || 0,
      type: r.type || 'application/octet-stream',
      url: r.download_url || `https://filester.me/d/${r.slug}`,
      folder_id: r.album_slug || null,
      created_at: r.upload_date,
      downloads: Number(r.downloads) || 0,
    })
    activity.set(r.slug, {
      uploadDate: r.upload_date,
      lastViewed: r.last_viewed,
      lastDownloaded: r.last_downloaded,
      views: Number(r.views) || 0,
      downloads: Number(r.downloads) || 0,
    })
  }
  return { files, activity, source: 'export' }
}

const post = (body: unknown): RequestInit => ({ method: 'POST', body: JSON.stringify(body) })

// ---------------------------------------------------------------- read

export async function getAccount() {
  return expectShape<Account>('v1/account', (await request<{ data: unknown }>('v1', 'account')).data, SHAPES.account)
}

export async function getFolders() {
  return expectList<Folder>('v1/folders', (await request<{ data: unknown }>('v1', 'folders')).data, SHAPES.folder)
}

export async function getFilesPage(page: number, perPage = 100, opts: { folder?: string; search?: string } = {}) {
  const q = new URLSearchParams({ page: String(page), per_page: String(perPage) })
  if (opts.folder) q.set('folder', opts.folder)
  if (opts.search) q.set('search', opts.search)
  const r = await request<{ data: unknown; pagination: unknown }>('v1', `files?${q}`)
  return {
    files: expectList<FileItem>('v1/files', r.data, SHAPES.file),
    pagination: expectShape<Pagination>('v1/files', r.pagination, SHAPES.pagination),
  }
}

/** Load every file in the account (100 per request, 4 requests in flight). */
export async function getAllFiles(onProgress?: (loaded: number, total: number) => void) {
  const first = await getFilesPage(1)
  const all = [...first.files]
  const pages = first.pagination?.pages ?? 1
  onProgress?.(all.length, first.pagination?.total ?? all.length)
  const remaining = Array.from({ length: Math.max(0, pages - 1) }, (_, i) => i + 2)
  const results: FileItem[][] = []
  for (let i = 0; i < remaining.length; i += 4) {
    const batch = await Promise.all(remaining.slice(i, i + 4).map((p) => getFilesPage(p)))
    batch.forEach((b, j) => (results[i + j] = b.files))
    onProgress?.(all.length + results.flat().length, first.pagination.total)
  }
  return all.concat(results.flat())
}

export async function getFileInfo(slug: string) {
  return expectShape<FileInfo>('file/info', await request('web', `file/info?id=${encodeURIComponent(slug)}`), SHAPES.fileInfo)
}

export async function getFolderInfo(id: string) {
  // Editing a folder re-sends its password state, so a changed shape here must stop edits.
  return expectShape<FolderInfo>('folder/info', await request('web', `folder/info?id=${encodeURIComponent(id)}`), SHAPES.folderInfo)
}

// ---------------------------------------------------------------- folders

export async function createFolder(name: string, parent: string | null, isPublic: boolean, password?: string) {
  const r = await request<{ data: { identifier: string } }>(
    'v1',
    'folder',
    post({ name, parent: parent ?? 'root', public: isPublic ? 1 : 0, ...(password ? { password } : {}) }),
  )
  return r.data.identifier
}

/**
 * Edit a folder (web endpoint). NOTE: Filester clears an existing password when
 * `password` is empty, so callers must pass the password again to keep it.
 */
export interface FolderFlags {
  hideRelated: boolean
  hasPassword: boolean
}

/**
 * "Hide related" and password status for every folder, in one web request
 * (the data endpoint behind Filester's own file manager).
 */
export async function getFolderFlags(): Promise<Map<string, FolderFlags>> {
  type Raw = { Identifier: string; HideRelated?: boolean; HasPassword?: boolean; Subfolders?: Raw[] | null }
  const d = await request<{ allFoldersHierarchical?: Raw[] | null }>('web', 'manager/data?folders_page=1&all_folders=1&with_hierarchy=1&folder_sort=az')
  const map = new Map<string, FolderFlags>()
  const walk = (list: Raw[] | null | undefined) => {
    for (const f of list ?? []) {
      map.set(f.Identifier, { hideRelated: !!f.HideRelated, hasPassword: !!f.HasPassword })
      walk(f.Subfolders)
    }
  }
  walk(expectList<Raw>('manager/data', d.allFoldersHierarchical, SHAPES.managerFolder))
  return map
}

export function editFolder(p: { id: string; name: string; isPublic: boolean; password: string; hideRelated: boolean }) {
  return request('web', 'folder/edit', post({
    identifier: p.id, name: p.name, public: p.isPublic ? 1 : 0, password: p.password, hide_related: p.hideRelated ? 1 : 0,
  }))
}

export function moveFolders(ids: string[], parent: string | null) {
  return request<{ message: string; data: { moved: number; failed: number; results: { folder: string; success: boolean; error?: string }[] } }>(
    'v1', 'folders/move', post({ folders: ids, parent: parent ?? 'root' }),
  )
}

export function deleteFolders(ids: string[]) {
  return request<{ files_deleted: number; results?: { identifier: string; success: boolean; error?: string }[] }>('u1', 'folder/delete', post({ identifiers: ids }))
}

// ---------------------------------------------------------------- files

/** Rename a file (web endpoint). `folderId` must be the file's current folder or it moves. */
export function renameFile(slug: string, name: string, folderId: string | null) {
  return request('web', 'file/update', post({ fileId: slug, name, folderId }))
}

export function moveFiles(ids: string[], folder: string | null) {
  return request<{ message: string; data: { moved: number; failed: number; results?: { file: string; success: boolean; error?: string }[] } }>(
    'v1', 'files/move', post({ files: ids, folder: folder ?? 'root' }),
  )
}

export function deleteFiles(ids: string[]) {
  return request<{ successful_deletes: number; failed_deletes: number; results?: { file_id: string; success: boolean; error?: string }[] }>('u1', 'file/delete', post({ identifiers: ids }))
}

// ---------------------------------------------------------------- stats

/** A file or folder in one of Filester's stats lists (folders' exact fields vary, so normalized). */
export interface StatItem {
  /** File slug or folder identifier, when present */
  id: string | null
  name: string
  downloads: number
  kind: 'file' | 'folder'
}
type StatRange = '24h' | '7d' | '30d'

export interface AccountStats {
  totals: { d24: number; d7: number; d30: number }
  /** Downloads per day, oldest first (last 30 days) */
  days: { day: string; downloads: number }[]
  trendingFiles: Record<StatRange, StatItem[]>
  trendingFolders: Record<StatRange, StatItem[]>
  alltimeFiles: StatItem[]
  alltimeFolders: StatItem[]
  risingFiles: StatItem[]
  coolingFiles: StatItem[]
  /** 7 rows (Sunday first) × 24 hours, UTC; null if missing */
  heatmap: number[][] | null
  dataSince: string | null
}

function statItems(list: unknown, kind: 'file' | 'folder'): StatItem[] {
  if (!Array.isArray(list)) return []
  return list.flatMap((raw) => {
    if (!raw || typeof raw !== 'object') return []
    const o = raw as Record<string, unknown>
    const str = (...k: string[]) => k.map((x) => o[x]).find((v) => typeof v === 'string' && v) as string | undefined
    const num = (...k: string[]) => Number(k.map((x) => o[x]).find((v) => typeof v === 'number') ?? 0)
    const name = str('name', 'Name', 'folder_name', 'original_name')
    if (!name) return []
    return [{ id: str(kind === 'file' ? 'slug' : 'identifier', 'Identifier', 'slug') ?? null, name, downloads: num('downloads', 'Downloads', 'count'), kind }]
  })
}
const ranges = (v: unknown, kind: 'file' | 'folder') => {
  const o = (v && typeof v === 'object' ? v : {}) as Record<string, unknown>
  return { '24h': statItems(o['24h'], kind), '7d': statItems(o['7d'], kind), '30d': statItems(o['30d'], kind) }
}

/** Download statistics behind Filester's own dashboard (web endpoint). */
export async function getAccountStats(): Promise<AccountStats> {
  const d = expectShape<Record<string, unknown>>('account/stats', await request('web', 'account/stats'), SHAPES.stats)
  const totals = expectShape<AccountStats['totals']>('account/stats', d.totals, SHAPES.statsTotals)
  const days = expectList<{ day: string; downloads: number }>('account/stats', d.sparkline, SHAPES.statsDay)
  const hm = d.heatmap
  const heatmap = Array.isArray(hm) && hm.length === 7 && hm.every((r) => Array.isArray(r) && r.length === 24) ? (hm as number[][]) : null
  return {
    totals,
    days: [...days].sort((a, b) => a.day.localeCompare(b.day)),
    trendingFiles: ranges(d.trending_files, 'file'),
    trendingFolders: ranges(d.trending_folders, 'folder'),
    alltimeFiles: statItems(d.alltime_files, 'file'),
    alltimeFolders: statItems(d.alltime_folders, 'folder'),
    risingFiles: statItems(d.movers_files, 'file'),
    coolingFiles: statItems(d.cooling_files, 'file'),
    heatmap,
    dataSince: typeof d.data_since === 'string' ? d.data_since : null,
  }
}
