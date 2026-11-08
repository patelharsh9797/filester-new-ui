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

const keyFor = (slug: string) => `${PREFIX}${slug}`

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

export async function listBackups(): Promise<{ backups: BackupInfo[]; used: number; limit: number; retentionDays: number }> {
  const { limitBytes, retentionDays } = config()
  const backups: BackupInfo[] = []
  const expired: string[] = []
  let cursor: string | undefined
  do {
    const page = await env.BACKUPS.list({ prefix: PREFIX, cursor, include: ['customMetadata'] })
    for (const o of page.objects) {
      const m = o.customMetadata ?? {}
      const backedUpAt = m.backedUpAt || o.uploaded.toISOString()
      const expiresAt = new Date(Date.parse(backedUpAt) + retentionDays * 86_400_000).toISOString()
      if (Date.parse(expiresAt) <= Date.now()) { expired.push(o.key); continue }
      backups.push({ key: o.key, slug: m.slug || o.key.slice(PREFIX.length), name: m.name || o.key, folder: m.folder || '', size: o.size, backedUpAt, expiresAt })
    }
    cursor = page.truncated ? page.cursor : undefined
  } while (cursor)
  // Retention: drop expired backups whenever we list.
  for (let i = 0; i < expired.length; i += 1000) await env.BACKUPS.delete(expired.slice(i, i + 1000))
  backups.sort((a, b) => b.backedUpAt.localeCompare(a.backedUpAt))
  return { backups, used: backups.reduce((n, b) => n + b.size, 0), limit: limitBytes, retentionDays }
}

export type InitResult =
  | { done: true; backup: BackupInfo }
  | { done: false; key: string; uploadId: string; size: number; partSize: number; parts: number; ticket: DownloadTicket }

export async function initBackup(session: Session, slug: string, folder: string, contentType: string): Promise<InitResult> {
  // No API-key calls here: the name comes from the download token, the size from the CDN.
  const ticket = await getTicket(session, slug)
  const meta = { name: ticket.name, size: await remoteSize(ticket), type: contentType }
  const { used, limit } = await listBackups()
  const existing = await env.BACKUPS.head(keyFor(slug))
  const usedWithout = used - (existing?.size ?? 0)
  if (usedWithout + meta.size > limit) {
    throw new BackupError(`Backing up ${meta.name} would go over your ${+(limit / 1024 ** 3).toFixed(limit < 1024 ** 3 ? 1 : 0)} GB backup limit. Delete some backups first.`, 413, 'LIMIT')
  }
  const customMetadata = { slug, name: meta.name, folder, backedUpAt: new Date().toISOString() }
  const httpMetadata = { contentType: meta.type || 'application/octet-stream', contentDisposition: `attachment; filename*=UTF-8''${encodeURIComponent(meta.name)}` }

  if (meta.size <= PART_SIZE) {
    const res = await fetchRange(ticket, 0, Math.max(0, meta.size - 1))
    await env.BACKUPS.put(keyFor(slug), meta.size ? fixedLength(res, meta.size) : '', { customMetadata, httpMetadata })
    const { retentionDays } = config()
    return {
      done: true,
      backup: { key: keyFor(slug), slug, name: meta.name, folder, size: meta.size, backedUpAt: customMetadata.backedUpAt, expiresAt: new Date(Date.now() + retentionDays * 86_400_000).toISOString() },
    }
  }

  const upload = await env.BACKUPS.createMultipartUpload(keyFor(slug), { customMetadata, httpMetadata })
  return { done: false, key: upload.key, uploadId: upload.uploadId, size: meta.size, partSize: PART_SIZE, parts: Math.ceil(meta.size / PART_SIZE), ticket }
}

export async function copyPart(p: { key: string; uploadId: string; size: number; part: number; ticket: DownloadTicket }) {
  const start = (p.part - 1) * PART_SIZE
  const end = Math.min(p.size, start + PART_SIZE) - 1
  if (p.part < 1 || start >= p.size) throw new BackupError('Bad part number')
  const upload = env.BACKUPS.resumeMultipartUpload(p.key, p.uploadId)
  const res = await fetchRange(p.ticket, start, end)
  const uploaded = await upload.uploadPart(p.part, fixedLength(res, end - start + 1))
  return { partNumber: uploaded.partNumber, etag: uploaded.etag }
}

export async function completeBackup(p: { key: string; uploadId: string; parts: { partNumber: number; etag: string }[] }) {
  const upload = env.BACKUPS.resumeMultipartUpload(p.key, p.uploadId)
  await upload.complete(p.parts)
  return (await listBackups()).backups.find((b) => b.key === p.key) ?? null
}

export async function abortBackup(p: { key: string; uploadId: string }) {
  await env.BACKUPS.resumeMultipartUpload(p.key, p.uploadId).abort().catch(() => {})
}

export async function deleteBackups(keys: string[]) {
  const safe = keys.filter((k) => k.startsWith(PREFIX))
  for (let i = 0; i < safe.length; i += 1000) await env.BACKUPS.delete(safe.slice(i, i + 1000))
  return safe.length
}

export async function readBackup(key: string) {
  if (!key.startsWith(PREFIX)) return null
  return env.BACKUPS.get(key)
}
