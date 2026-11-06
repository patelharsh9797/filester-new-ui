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

const post = (body: unknown): RequestInit => ({ method: 'POST', body: JSON.stringify(body) })

// ---------------------------------------------------------------- read

export async function getAccount() {
  return (await request<{ data: Account }>('v1', 'account')).data
}

export async function getFolders() {
  return (await request<{ data: Folder[] | null }>('v1', 'folders')).data ?? []
}

export async function getFilesPage(page: number, perPage = 100, opts: { folder?: string; search?: string } = {}) {
  const q = new URLSearchParams({ page: String(page), per_page: String(perPage) })
  if (opts.folder) q.set('folder', opts.folder)
  if (opts.search) q.set('search', opts.search)
  const r = await request<{ data: FileItem[] | null; pagination: Pagination }>('v1', `files?${q}`)
  return { files: r.data ?? [], pagination: r.pagination }
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

export function getFileInfo(slug: string) {
  return request<FileInfo>('web', `file/info?id=${encodeURIComponent(slug)}`)
}

export function getFolderInfo(id: string) {
  return request<FolderInfo>('web', `folder/info?id=${encodeURIComponent(id)}`)
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
  return request<{ files_deleted: number }>('u1', 'folder/delete', post({ identifiers: ids }))
}

// ---------------------------------------------------------------- files

/** Rename a file (web endpoint). `folderId` must be the file's current folder or it moves. */
export function renameFile(slug: string, name: string, folderId: string | null) {
  return request('web', 'file/update', post({ fileId: slug, name, folderId }))
}

export function moveFiles(ids: string[], folder: string | null) {
  return request<{ message: string; data: { moved: number; failed: number } }>(
    'v1', 'files/move', post({ files: ids, folder: folder ?? 'root' }),
  )
}

export function deleteFiles(ids: string[]) {
  return request<{ successful_deletes: number; failed_deletes: number }>('u1', 'file/delete', post({ identifiers: ids }))
}
