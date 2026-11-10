// Client for /api/backup/*: drives a Filester → R2 copy one part at a time.

export interface BackupInfo {
  key: string
  slug: string
  name: string
  size: number
  backedUpAt: string
  expiresAt: string
}

export interface PendingUpload {
  key: string
  uploadId: string
  slug: string
  name: string
  size: number
  startedAt: string
}

export interface BackupList {
  backups: BackupInfo[]
  /** Unfinished (interrupted) multipart uploads still holding space in R2 */
  pending: PendingUpload[]
  /** Name of the user's connected bucket */
  bucket: string
  used: number
  limit: number
  retentionDays: number
}

interface Ticket { server: string; file: string; token: string; name: string; expiresAt: number }

export class BackupApiError extends Error {
  status: number
  code?: string
  constructor(message: string, status: number, code?: string) { super(message); this.status = status; this.code = code }
}

async function call<T>(action: string, body?: unknown, signal?: AbortSignal): Promise<T> {
  const res = await fetch(`/api/backup/${action}`, body === undefined
    ? { credentials: 'same-origin', signal }
    : { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal })
  const j = (await res.json().catch(() => ({}))) as { success?: boolean; message?: string; code?: string }
  if (!res.ok || !j.success) throw new BackupApiError(j.message || `Backup request failed (${res.status})`, res.status, j.code)
  return j as T
}

export const listBackups = () => call<BackupList>('list')

/** The user's backup bucket settings (keys are never sent back; only a hint). */
export interface BackupConfigView {
  accountId: string
  bucket: string
  accessKeyHint: string
  retentionDays: number
  limitGb: number
  connectedAt: string
}
export interface DailyUsage {
  used: number
  /** null = no daily cap */
  cap: number | null
  remaining: number | null
  resetsAt: string
}
export const getBackupConfig = () => call<{ connected: boolean; config: BackupConfigView | null; usage: DailyUsage }>('config')
export const connectBucket = (c: { accountId: string; accessKeyId: string; secretAccessKey: string; bucket: string }) =>
  call<{ config: BackupConfigView }>('connect', c)
export const saveBackupSettings = (s: { retentionDays: number; limitGb: number }) => call<{ config: BackupConfigView }>('settings', s)
export const disconnectBucket = (deleteBackups: boolean) => call<{ deleted: number }>('disconnect', { deleteBackups })
export const deleteBackups = (keys: string[]) => call<{ deleted: number }>('delete', { keys })
export const discardPending = (keys: string[] | 'all') => call<{ discarded: number }>('discard', keys === 'all' ? { all: true } : { keys })
export const backupDownloadUrl = (key: string) => `/api/backup/download?key=${encodeURIComponent(key)}`

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const RETRYABLE = new Set([0, 429, 500, 502, 503, 504])

/** Saved progress of a multipart copy, so an interrupted backup can resume. */
export interface MultipartState {
  key: string
  uploadId: string
  size: number
  partSize: number
  parts: number
  done: { partNumber: number; etag: string }[]
}

/**
 * Copy one Filester file into R2. Resolves with the stored backup.
 * Pass `resume` to continue an interrupted multipart copy; `onState` is called
 * after every finished part so the caller can persist progress.
 */
export async function runBackup(
  file: { slug: string; type?: string },
  onProgress: (copied: number, total: number) => void,
  signal: AbortSignal,
  opts: { resume?: MultipartState | null; onState?: (s: MultipartState | null) => void } = {},
): Promise<BackupInfo> {
  type Init =
    | { done: true; backup: BackupInfo }
    | { done: false; key: string; uploadId: string; size: number; partSize: number; parts: number; ticket: Ticket }

  let state: MultipartState
  let ticket: Ticket
  if (opts.resume && opts.resume.done.length < opts.resume.parts) {
    state = { ...opts.resume, done: [...opts.resume.done] }
    ticket = (await call<{ ticket: Ticket }>('ticket', { slug: file.slug }, signal)).ticket
  } else {
    const init = await call<Init>('init', file, signal)
    if (init.done) { onProgress(init.backup.size, init.backup.size); opts.onState?.(null); return init.backup }
    state = { key: init.key, uploadId: init.uploadId, size: init.size, partSize: init.partSize, parts: init.parts, done: [] }
    ticket = init.ticket
    opts.onState?.(state)
  }

  const { key, uploadId, size, partSize, parts: total } = state
  const partBytes = (n: number) => Math.min(partSize, size - (n - 1) * partSize)
  const finished = new Set(state.done.map((d) => d.partNumber))
  let copied = state.done.reduce((n, d) => n + partBytes(d.partNumber), 0)
  onProgress(copied, size)
  const todo = Array.from({ length: total }, (_, i) => i + 1).filter((n) => !finished.has(n))

  try {
    // Two parts in flight keeps throughput up without hammering Filester's CDN.
    let next = 0
    const worker = async () => {
      while (next < todo.length) {
        const part = todo[next++]
        for (let attempt = 1; ; attempt++) {
          if (signal.aborted) throw new BackupApiError('Cancelled', 0)
          if (ticket.expiresAt - Date.now() < 120_000) ticket = (await call<{ ticket: Ticket }>('ticket', { slug: file.slug }, signal)).ticket
          try {
            const r = await call<{ partNumber: number; etag: string }>('part', { key, uploadId, size, part, ticket }, signal)
            state.done.push(r)
            copied += partBytes(part)
            onProgress(copied, size)
            opts.onState?.(state)
            break
          } catch (e) {
            const err = e as BackupApiError
            // Out of today's allowance: retrying won't help until it resets.
            if (signal.aborted || err.code === 'GONE' || err.code === 'CAP' || err.code === 'CAP_FILE') throw err
            if (err.code === 'TOKEN' && attempt < 4) { ticket = (await call<{ ticket: Ticket }>('ticket', { slug: file.slug }, signal)).ticket; continue }
            if (!RETRYABLE.has(err.status) || attempt >= 5) throw err
            await sleep(Math.min(15_000, 1000 * 2 ** attempt))
          }
        }
      }
    }
    await Promise.all([worker(), worker()])
    const parts = [...state.done].sort((a, b) => a.partNumber - b.partNumber)
    const r = await call<{ backup: BackupInfo | null }>('complete', { key, uploadId, parts }, signal)
    if (!r.backup) throw new BackupApiError('Backup finished but could not be found', 500)
    opts.onState?.(null)
    return r.backup
  } catch (e) {
    const err = e as BackupApiError
    if (signal.aborted) {
      // Cancelled by the user: release the parts now.
      call('abort', { key, uploadId }).catch(() => {})
      opts.onState?.(null)
    } else if (err.code === 'GONE') {
      opts.onState?.(null)
    }
    // Any other failure (e.g. the phone went offline): keep the finished parts so
    // Retry continues from here. Unfinished uploads are cleaned up after 24 hours.
    throw e
  }
}
