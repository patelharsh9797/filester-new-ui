// Client for /api/backup/*: drives a Filester → R2 copy one part at a time.

export interface BackupInfo {
  key: string
  slug: string
  name: string
  folder: string
  size: number
  backedUpAt: string
  expiresAt: string
}

export interface BackupList {
  backups: BackupInfo[]
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
export const deleteBackups = (keys: string[]) => call<{ deleted: number }>('delete', { keys })
export const backupDownloadUrl = (key: string) => `/api/backup/download?key=${encodeURIComponent(key)}`

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const RETRYABLE = new Set([0, 429, 500, 502, 503, 504])

/** Copy one Filester file into R2. Resolves with the stored backup. */
export async function runBackup(
  file: { slug: string; folder: string; type?: string },
  onProgress: (copied: number, total: number) => void,
  signal: AbortSignal,
): Promise<BackupInfo> {
  type Init =
    | { done: true; backup: BackupInfo }
    | { done: false; key: string; uploadId: string; size: number; partSize: number; parts: number; ticket: Ticket }
  const init = await call<Init>('init', file, signal)
  if (init.done) { onProgress(init.backup.size, init.backup.size); return init.backup }

  const { key, uploadId, size, partSize, parts: total } = init
  let ticket = init.ticket
  const done: { partNumber: number; etag: string }[] = []
  let copied = 0
  try {
    // Two parts in flight keeps throughput up without hammering Filester's CDN.
    let next = 1
    const worker = async () => {
      while (next <= total) {
        const part = next++
        for (let attempt = 1; ; attempt++) {
          if (signal.aborted) throw new BackupApiError('Cancelled', 0)
          if (ticket.expiresAt - Date.now() < 120_000) ticket = (await call<{ ticket: Ticket }>('ticket', { slug: file.slug }, signal)).ticket
          try {
            const r = await call<{ partNumber: number; etag: string }>('part', { key, uploadId, size, part, ticket }, signal)
            done.push(r)
            copied += Math.min(partSize, size - (part - 1) * partSize)
            onProgress(copied, size)
            break
          } catch (e) {
            const err = e as BackupApiError
            if (signal.aborted) throw err
            if (err.code === 'TOKEN' && attempt < 4) { ticket = (await call<{ ticket: Ticket }>('ticket', { slug: file.slug }, signal)).ticket; continue }
            if (!RETRYABLE.has(err.status) || attempt >= 5) throw err
            await sleep(Math.min(15_000, 1000 * 2 ** attempt))
          }
        }
      }
    }
    await Promise.all([worker(), worker()])
    done.sort((a, b) => a.partNumber - b.partNumber)
    const r = await call<{ backup: BackupInfo | null }>('complete', { key, uploadId, parts: done }, signal)
    if (!r.backup) throw new BackupApiError('Backup finished but could not be found', 500)
    return r.backup
  } catch (e) {
    call('abort', { key, uploadId }).catch(() => {})
    throw e
  }
}
