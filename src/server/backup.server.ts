// Manual backups of Filester files into R2.
//
// The browser drives the copy one part at a time so every request stays short
// and a failure only retries one part:
//   init     → look up the file, get a Filester download token, start an R2 multipart upload
//   part     → copy one byte range from Filester's CDN into one R2 part
//   complete → finish the multipart upload
// Small files (≤ one part) are copied in a single `init` call.
import { env } from 'cloudflare:workers'
import type { Session } from './session.server'
import { filesterOrigins, UA } from './filester.server'

export const PART_SIZE = 64 * 1024 * 1024 // R2: all parts except the last must be the same size
const PREFIX = 'backups/'
/**
 * Markers for multipart uploads that haven't completed yet. R2 keeps the parts of
 * an unfinished upload (they use storage but aren't listed as objects), and the
 * Workers binding can't list them, so we record each one ourselves.
 */
const PENDING = 'pending/'
/** Unfinished uploads older than this are aborted automatically. */
const PENDING_TTL_MS = 24 * 3600_000

export interface DownloadTicket {
  server: string
  file: string
  token: string
  name: string
  expiresAt: number
}

export interface BackupInfo {
  key: string
  slug: string
  name: string
  folder: string
  size: number
  backedUpAt: string
  expiresAt: string
}

function config() {
  const e = env as unknown as Record<string, string | undefined>
  return {
    limitBytes: Math.max(0, Number(e.BACKUP_LIMIT_GB ?? 10) || 10) * 1024 ** 3,
    retentionDays: Math.max(1, Number(e.BACKUP_RETENTION_DAYS ?? 7) || 7),
    // Dev/test only: route CDN downloads through a local forwarder.
    cdnRewrite: e.FILESTER_CDN_REWRITE,
  }
}

/** Each user's backups live under their own prefix: backups/<owner>/<slug>. */
export const ownerOf = (session: Session) => session.username.trim().toLowerCase().replace(/[^a-z0-9_-]/g, '_')
const userPrefix = (owner: string) => `${PREFIX}${owner}/`
const pendingPrefix = (owner: string) => `${PENDING}${owner}/`
const keyFor = (owner: string, slug: string) => `${userPrefix(owner)}${slug}`
/** pending/<owner>/<slug> marker for a backups/<owner>/<slug> key */
const markerFor = (key: string) => `${PENDING}${key.slice(PREFIX.length)}`
/** True if `key` is one of this owner's backup keys. */
export const ownsKey = (owner: string, key: string) => key.startsWith(userPrefix(owner)) && !key.includes('..')

class BackupError extends Error {
  status: number
  code?: string
  constructor(message: string, status = 400, code?: string) {
    super(message)
    this.status = status
    this.code = code
  }
}
export { BackupError }

// ---------------------------------------------------------------- Filester

/** Size from the CDN without downloading the file (a 1-byte range request). */
async function remoteSize(t: DownloadTicket): Promise<number> {
  const r = await fetch(cdnUrl(t), { headers: { range: 'bytes=0-0', 'user-agent': UA } })
  await r.body?.cancel()
  if (r.status === 401 || r.status === 403 || r.status === 410) throw new BackupError('Download token rejected or expired', 409, 'TOKEN')
  if (r.status === 416) return 0 // empty file
  const total = /\/(\d+)\s*$/.exec(r.headers.get('content-range') ?? '')?.[1]
  if (r.status === 206 && total) return Number(total)
  if (r.status === 200 && r.headers.get('content-length')) return Number(r.headers.get('content-length'))
  throw new BackupError(`Couldn't read the file size from Filester (${r.status})`, 502)
}

/** Same call Filester's own download button makes; tokens last 30 minutes. */
export async function getTicket(session: Session, slug: string): Promise<DownloadTicket> {
  const { WEB } = filesterOrigins()
  const r = await fetch(`${WEB}/v2/api/public/download`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'user-agent': UA, cookie: `auth_token=${session.token}`, referer: `https://filester.me/d/${slug}` },
    body: JSON.stringify({ file_slug: slug }),
  })
  const j = (await r.json().catch(() => ({}))) as { success?: boolean; server?: string; file?: string; token?: string; name?: string; expires_in?: number; message?: string }
  if (!r.ok || !j.success || !j.server || !j.file || !j.token) {
    throw new BackupError(j.message || `Filester refused a download token (${r.status})`, 502, 'TOKEN')
  }
  return { server: j.server, file: j.file, token: j.token, name: j.name ?? slug, expiresAt: Date.now() + (j.expires_in ?? 1800) * 1000 }
}

function cdnUrl(t: DownloadTicket) {
  // Only ever fetch from Filester's CDN hosts.
  const host = new URL(t.server).hostname
  if (!/(^|\.)cdn\.cr$|(^|\.)filester\.me$/.test(host)) throw new BackupError(`Unexpected download host ${host}`, 502)
  const path = `/v2/${encodeURIComponent(t.file)}?token=${encodeURIComponent(t.token)}&download=true`
  const rewrite = config().cdnRewrite
  return rewrite ? `${rewrite.replace(/\/$/, '')}/${host}${path}` : `${t.server.replace(/\/$/, '')}${path}`
}

/** Fetch a byte range from the CDN. Throws code TOKEN when the ticket is rejected. */
async function fetchRange(t: DownloadTicket, start: number, end: number) {
  const r = await fetch(cdnUrl(t), { headers: { range: `bytes=${start}-${end}`, 'user-agent': UA } })
  if (r.status === 401 || r.status === 403 || r.status === 410) {
    await r.body?.cancel()
    throw new BackupError('Download token rejected or expired', 409, 'TOKEN')
  }
  if (r.status !== 206 && !(r.status === 200 && start === 0)) {
    await r.body?.cancel()
    throw new BackupError(`Filester CDN returned ${r.status}`, 502)
  }
  const len = end - start + 1
  // A 200 means the server ignored Range; only acceptable when we wanted the whole file.
  if (r.status === 200 && Number(r.headers.get('content-length')) !== len) {
    await r.body?.cancel()
    throw new BackupError('CDN ignored the byte range', 502)
  }
  return r
}

/** Pipe a response body into a stream with a known length (R2 requires it). */
function fixedLength(res: Response, len: number) {
  const { readable, writable } = new FixedLengthStream(len)
  res.body!.pipeTo(writable).catch(() => {})
  return readable
}

// ---------------------------------------------------------------- R2

export interface PendingInfo {
  key: string
  slug: string
  name: string
  size: number
  startedAt: string
}

async function readPending(owner: string): Promise<{ live: (PendingInfo & { marker: string; uploadId: string })[]; stale: { marker: string; key: string; uploadId: string }[] }> {
  const live: (PendingInfo & { marker: string; uploadId: string })[] = []
  const stale: { marker: string; key: string; uploadId: string }[] = []
  let cursor: string | undefined
  do {
    const page = await env.BACKUPS.list({ prefix: pendingPrefix(owner), cursor, include: ['customMetadata'] })
    for (const o of page.objects) {
      const m = o.customMetadata ?? {}
      const startedAt = m.startedAt || o.uploaded.toISOString()
      if (Date.now() - Date.parse(startedAt) > PENDING_TTL_MS) stale.push({ marker: o.key, key: m.key, uploadId: m.uploadId })
      else live.push({ marker: o.key, key: m.key, uploadId: m.uploadId, slug: m.slug, name: m.name, size: Number(m.size) || 0, startedAt })
    }
    cursor = page.truncated ? page.cursor : undefined
  } while (cursor)
  return { live, stale }
}

async function dropPending(items: { marker: string; key?: string; uploadId?: string }[]) {
  for (const it of items) {
    if (it.key && it.uploadId) await env.BACKUPS.resumeMultipartUpload(it.key, it.uploadId).abort().catch(() => {})
  }
  const markers = items.map((i) => i.marker)
  for (let i = 0; i < markers.length; i += 1000) await env.BACKUPS.delete(markers.slice(i, i + 1000))
}

/** Unfinished uploads (still reserved in the bucket). Stale ones are aborted on the way. */
export async function listPending(owner: string): Promise<PendingInfo[]> {
  const { live, stale } = await readPending(owner)
  if (stale.length) await dropPending(stale)
  return live.map(({ key, slug, name, size, startedAt }) => ({ key, slug, name, size, startedAt }))
}

/** Abort unfinished uploads by backup key (or all of them). */
export async function discardPending(owner: string, keys: string[] | 'all') {
  const { live, stale } = await readPending(owner)
  const pick = keys === 'all' ? live : live.filter((p) => keys.includes(p.key))
  await dropPending([...pick, ...stale])
  return pick.length
}

/**
 * Bytes stored in the whole bucket (all users, finished + unfinished): what the limit
 * protects. Also expires legacy items saved before backups were split per user
 * (backups/<slug>, pending/<slug>), which no user can see any more.
 */
async function bucketUsage(): Promise<number> {
  const { retentionDays } = config()
  let total = 0
  const legacyBackups: string[] = []
  const legacyPending: { marker: string; key?: string; uploadId?: string }[] = []
  for (const prefix of [PREFIX, PENDING]) {
    let cursor: string | undefined
    do {
      const page = await env.BACKUPS.list({ prefix, cursor, include: ['customMetadata'] })
      for (const o of page.objects) {
        const legacy = !o.key.slice(prefix.length).includes('/')
        const m = o.customMetadata ?? {}
        if (prefix === PENDING) {
          const started = Date.parse(m.startedAt || o.uploaded.toISOString())
          if (legacy && Date.now() - started > PENDING_TTL_MS) { legacyPending.push({ marker: o.key, key: m.key, uploadId: m.uploadId }); continue }
          total += Number(m.size) || 0
        } else {
          const at = Date.parse(m.backedUpAt || o.uploaded.toISOString())
          if (legacy && Date.now() - at > retentionDays * 86_400_000) { legacyBackups.push(o.key); continue }
          total += o.size
        }
      }
      cursor = page.truncated ? page.cursor : undefined
    } while (cursor)
  }
  if (legacyPending.length) await dropPending(legacyPending)
  for (let i = 0; i < legacyBackups.length; i += 1000) await env.BACKUPS.delete(legacyBackups.slice(i, i + 1000))
  return total
}

export async function listBackups(owner: string): Promise<{ backups: BackupInfo[]; pending: PendingInfo[]; used: number; limit: number; retentionDays: number }> {
  const { limitBytes, retentionDays } = config()
  const backups: BackupInfo[] = []
  const expired: string[] = []
  let cursor: string | undefined
  do {
    const page = await env.BACKUPS.list({ prefix: userPrefix(owner), cursor, include: ['customMetadata'] })
    for (const o of page.objects) {
      const m = o.customMetadata ?? {}
      const backedUpAt = m.backedUpAt || o.uploaded.toISOString()
      const expiresAt = new Date(Date.parse(backedUpAt) + retentionDays * 86_400_000).toISOString()
      if (Date.parse(expiresAt) <= Date.now()) { expired.push(o.key); continue }
      backups.push({ key: o.key, slug: m.slug || o.key.slice(userPrefix(owner).length), name: m.name || o.key, folder: m.folder || '', size: o.size, backedUpAt, expiresAt })
    }
    cursor = page.truncated ? page.cursor : undefined
  } while (cursor)
  // Retention: drop expired backups whenever we list.
  for (let i = 0; i < expired.length; i += 1000) await env.BACKUPS.delete(expired.slice(i, i + 1000))
  backups.sort((a, b) => b.backedUpAt.localeCompare(a.backedUpAt))
  const pending = await listPending(owner)
  // The limit protects the bucket (your storage bill), so usage is bucket-wide and
  // includes unfinished uploads.
  const used = await bucketUsage()
  return { backups, pending, used, limit: limitBytes, retentionDays }
}

export type InitResult =
  | { done: true; backup: BackupInfo }
  | { done: false; key: string; uploadId: string; size: number; partSize: number; parts: number; ticket: DownloadTicket }

export async function initBackup(session: Session, slug: string, folder: string, contentType: string): Promise<InitResult> {
  // No API-key calls here: the name comes from the download token, the size from the CDN.
  const ticket = await getTicket(session, slug)
  const meta = { name: ticket.name, size: await remoteSize(ticket), type: contentType }
  // Restarting a file whose earlier backup was interrupted: release those parts first.
  const owner = ownerOf(session)
  await discardPending(owner, [keyFor(owner, slug)])
  const { used, limit } = await listBackups(owner)
  const existing = await env.BACKUPS.head(keyFor(owner, slug))
  const usedWithout = used - (existing?.size ?? 0)
  if (usedWithout + meta.size > limit) {
    throw new BackupError(`Backing up ${meta.name} would go over your ${+(limit / 1024 ** 3).toFixed(limit < 1024 ** 3 ? 1 : 0)} GB backup limit. Delete some backups first.`, 413, 'LIMIT')
  }
  const customMetadata = { slug, name: meta.name, folder, backedUpAt: new Date().toISOString() }
  const httpMetadata = { contentType: meta.type || 'application/octet-stream', contentDisposition: `attachment; filename*=UTF-8''${encodeURIComponent(meta.name)}` }

  if (meta.size <= PART_SIZE) {
    const res = await fetchRange(ticket, 0, Math.max(0, meta.size - 1))
    await env.BACKUPS.put(keyFor(owner, slug), meta.size ? fixedLength(res, meta.size) : '', { customMetadata, httpMetadata })
    const { retentionDays } = config()
    return {
      done: true,
      backup: { key: keyFor(owner, slug), slug, name: meta.name, folder, size: meta.size, backedUpAt: customMetadata.backedUpAt, expiresAt: new Date(Date.now() + retentionDays * 86_400_000).toISOString() },
    }
  }

  const upload = await env.BACKUPS.createMultipartUpload(keyFor(owner, slug), { customMetadata, httpMetadata })
  await env.BACKUPS.put(markerFor(upload.key), '', {
    customMetadata: { key: upload.key, uploadId: upload.uploadId, slug, name: meta.name, size: String(meta.size), startedAt: new Date().toISOString() },
  })
  return { done: false, key: upload.key, uploadId: upload.uploadId, size: meta.size, partSize: PART_SIZE, parts: Math.ceil(meta.size / PART_SIZE), ticket }
}

export async function copyPart(p: { key: string; uploadId: string; size: number; part: number; ticket: DownloadTicket }) {
  const start = (p.part - 1) * PART_SIZE
  const end = Math.min(p.size, start + PART_SIZE) - 1
  if (p.part < 1 || start >= p.size) throw new BackupError('Bad part number')
  const upload = env.BACKUPS.resumeMultipartUpload(p.key, p.uploadId)
  const res = await fetchRange(p.ticket, start, end)
  try {
    const uploaded = await upload.uploadPart(p.part, fixedLength(res, end - start + 1))
    return { partNumber: uploaded.partNumber, etag: uploaded.etag }
  } catch (e) {
    if (/does not exist|NoSuchUpload|10024/i.test(String((e as Error).message))) {
      throw new BackupError('This unfinished backup was cleaned up; it will start again from the beginning', 410, 'GONE')
    }
    throw e
  }
}

export async function completeBackup(owner: string, p: { key: string; uploadId: string; parts: { partNumber: number; etag: string }[] }) {
  const upload = env.BACKUPS.resumeMultipartUpload(p.key, p.uploadId)
  try {
    await upload.complete(p.parts)
  } catch (e) {
    if (/does not exist|NoSuchUpload|10024/i.test(String((e as Error).message))) throw new BackupError('This unfinished backup was cleaned up', 410, 'GONE')
    throw e
  }
  await env.BACKUPS.delete(markerFor(p.key))
  return (await listBackups(owner)).backups.find((b) => b.key === p.key) ?? null
}

export async function abortBackup(p: { key: string; uploadId: string }) {
  await env.BACKUPS.resumeMultipartUpload(p.key, p.uploadId).abort().catch(() => {})
  await env.BACKUPS.delete(markerFor(p.key))
}

export async function deleteBackups(owner: string, keys: string[]) {
  const safe = keys.filter((k) => ownsKey(owner, k))
  for (let i = 0; i < safe.length; i += 1000) await env.BACKUPS.delete(safe.slice(i, i + 1000))
  return safe.length
}

export async function readBackup(owner: string, key: string) {
  if (!ownsKey(owner, key)) return null
  return env.BACKUPS.get(key)
}
