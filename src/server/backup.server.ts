// Manual backups of Filester files into the user's OWN R2 bucket (bring your own bucket).
//
// The browser drives the copy one part at a time so every request stays short
// and a failure only retries one part:
//   init     → get a Filester download token, start a multipart upload in the user's bucket
//   part     → copy one byte range from Filester's CDN into one part
//   complete → finish the multipart upload
// Small files (≤ one part) are copied in a single `init` call.
import { env } from 'cloudflare:workers'
import type { Session } from './session.server'
import { filesterOrigins, UA } from './filester.server'
import { addUsage, remainingToday, type R2Config } from './r2config.server'
import { S3Error, type Bucket } from './s3.server'

/** All parts except the last must be the same size (S3 minimum 5 MB). */
const DEFAULT_PART_SIZE = 64 * 1024 * 1024
function partSize() {
  // Dev/test only: smaller parts (e.g. BACKUP_PART_MB=5) to exercise multipart with small files.
  const mb = Number((env as unknown as Record<string, string | undefined>).BACKUP_PART_MB)
  return mb >= 5 ? mb * 1024 * 1024 : DEFAULT_PART_SIZE
}
/** Everything this app writes goes under this prefix in the user's bucket. */
export const PREFIX = 'filester-navigator/'
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
  size: number
  backedUpAt: string
  expiresAt: string
}

export interface PendingInfo {
  key: string
  uploadId: string
  slug: string
  name: string
  size: number
  startedAt: string
}

/** Everything a backup operation needs: who, their settings and a client for their bucket. */
export interface BackupContext {
  session: Session
  userId: number
  cfg: R2Config
  bucket: Bucket
}

function config() {
  const e = env as unknown as Record<string, string | undefined>
  // Dev/test only: route CDN downloads through a local forwarder.
  return { cdnRewrite: e.FILESTER_CDN_REWRITE }
}

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

/** filester-navigator/<slug>/<file name> */
// Control characters, slashes and backslashes become "_" so the name stays one path segment.
const safeName = (name: string) => [...name].map((c) => (c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127 || c === '/' || c === '\\' ? '_' : c)).join('').slice(0, 200) || 'file'
const keyFor = (slug: string, name: string) => `${PREFIX}${slug}/${safeName(name)}`
const parseKey = (key: string) => {
  const rest = key.slice(PREFIX.length)
  const i = rest.indexOf('/')
  return i < 0 ? { slug: rest, name: rest } : { slug: rest.slice(0, i), name: rest.slice(i + 1) }
}
export const isBackupKey = (key: string) => key.startsWith(PREFIX) && !key.includes('..') && key.length < 600

/** Map bucket errors to backup errors the client understands. */
function wrap(e: unknown): never {
  if (e instanceof S3Error) {
    if (e.code === 'NoSuchUpload') throw new BackupError('This unfinished backup was cleaned up; it will start again from the beginning', 410, 'GONE')
    throw new BackupError(e.message, e.status === 403 || e.status === 401 ? 403 : 502, 'BUCKET')
  }
  throw e
}

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

// ---------------------------------------------------------------- user's bucket

export async function listBackups(ctx: BackupContext) {
  const { bucket, cfg } = ctx
  const now = Date.now()
  const retentionMs = cfg.retentionDays * 86_400_000
  let objects, uploads
  try {
    ;[objects, uploads] = await Promise.all([bucket.list(PREFIX), bucket.listMultipart(PREFIX)])
  } catch (e) { wrap(e) }

  // Retention: drop backups older than the user's setting.
  const expired = objects.filter((o) => now - Date.parse(o.lastModified) > retentionMs)
  await Promise.all(expired.map((o) => bucket.del(o.key).catch(() => {})))
  const backups: BackupInfo[] = objects
    .filter((o) => !expired.includes(o))
    .map((o) => ({ key: o.key, ...parseKey(o.key), size: o.size, backedUpAt: o.lastModified, expiresAt: new Date(Date.parse(o.lastModified) + retentionMs).toISOString() }))
    .sort((a, b) => b.backedUpAt.localeCompare(a.backedUpAt))

  // Unfinished uploads: stale ones are aborted, the rest are listed with the space they hold.
  // Ignore clearly bogus start dates (some S3-compatible servers report a fixed old date)
  // rather than discarding uploads that may still be in progress.
  const started = (u: { initiated: string }) => Date.parse(u.initiated)
  const stale = uploads.filter((u) => started(u) > Date.UTC(2020, 0, 1) && now - started(u) > PENDING_TTL_MS)
  await Promise.all(stale.map((u) => bucket.abortMultipart(u.key, u.uploadId).catch(() => {})))
  const live = uploads.filter((u) => !stale.includes(u))
  const pending: PendingInfo[] = await Promise.all(live.map(async (u) => ({
    key: u.key, uploadId: u.uploadId, ...parseKey(u.key), size: await bucket.partsSize(u.key, u.uploadId), startedAt: u.initiated,
  })))

  const used = backups.reduce((n, b) => n + b.size, 0) + pending.reduce((n, p) => n + p.size, 0)
  return { backups, pending, used, limit: cfg.limitGb * 1024 ** 3, retentionDays: cfg.retentionDays, bucket: cfg.bucket }
}

export type InitResult =
  | { done: true; backup: BackupInfo }
  | { done: false; key: string; uploadId: string; size: number; partSize: number; parts: number; ticket: DownloadTicket }

export async function initBackup(ctx: BackupContext, slug: string, contentType: string): Promise<InitResult> {
  const { bucket, cfg, userId } = ctx
  const ticket = await getTicket(ctx.session, slug)
  const size = await remoteSize(ticket)
  const key = keyFor(slug, ticket.name)
  const slugPrefix = `${PREFIX}${slug}/`

  // Restarting a file whose earlier backup was interrupted: release those parts first.
  try {
    for (const u of await bucket.listMultipart(slugPrefix)) await bucket.abortMultipart(u.key, u.uploadId)
  } catch (e) { wrap(e) }

  const { used, limit } = await listBackups(ctx)
  const existing = (await bucket.list(slugPrefix).catch(() => [])).reduce((n, o) => n + o.size, 0)
  if (used - existing + size > limit) {
    throw new BackupError(`Backing up ${ticket.name} would go over your ${cfg.limitGb} GB backup limit. Delete some backups or raise the limit in Settings.`, 413, 'LIMIT')
  }
  // Fair-use cap on what goes through this Worker per user per day.
  const left = await remainingToday(userId)
  if (size > left) {
    throw new BackupError(`Daily backup limit reached for today (${left <= 0 ? 'nothing' : `${Math.floor(left / 1024 ** 2)} MB`} left). Try again tomorrow.`, 429, 'CAP')
  }
  await addUsage(userId, size)

  const headers = { 'content-type': contentType || 'application/octet-stream', 'content-disposition': `attachment; filename*=UTF-8''${encodeURIComponent(ticket.name)}` }
  const now = new Date()
  try {
    const PART_SIZE = partSize()
    if (size <= PART_SIZE) {
      const res = await fetchRange(ticket, 0, Math.max(0, size - 1))
      await bucket.put(key, size ? fixedLength(res, size) : '', size, headers)
      await removeOtherCopies(bucket, slugPrefix, key)
      return { done: true, backup: { key, slug, name: ticket.name, size, backedUpAt: now.toISOString(), expiresAt: new Date(now.getTime() + cfg.retentionDays * 86_400_000).toISOString() } }
    }
    const uploadId = await bucket.createMultipart(key, headers)
    return { done: false, key, uploadId, size, partSize: PART_SIZE, parts: Math.ceil(size / PART_SIZE), ticket }
  } catch (e) { wrap(e) }
}

/** A file renamed on Filester gets a new key: drop its older copies once the new one is stored. */
async function removeOtherCopies(bucket: Bucket, slugPrefix: string, keep: string) {
  const others = (await bucket.list(slugPrefix).catch(() => [])).filter((o) => o.key !== keep)
  await Promise.all(others.map((o) => bucket.del(o.key).catch(() => {})))
}

export async function copyPart(ctx: BackupContext, p: { key: string; uploadId: string; size: number; part: number; ticket: DownloadTicket }) {
  const PART_SIZE = partSize()
  const start = (p.part - 1) * PART_SIZE
  const end = Math.min(p.size, start + PART_SIZE) - 1
  if (p.part < 1 || start >= p.size) throw new BackupError('Bad part number')
  const res = await fetchRange(p.ticket, start, end)
  try {
    const etag = await ctx.bucket.uploadPart(p.key, p.uploadId, p.part, fixedLength(res, end - start + 1), end - start + 1)
    return { partNumber: p.part, etag }
  } catch (e) { wrap(e) }
}

export async function completeBackup(ctx: BackupContext, p: { key: string; uploadId: string; parts: { partNumber: number; etag: string }[] }) {
  try {
    await ctx.bucket.completeMultipart(p.key, p.uploadId, p.parts)
  } catch (e) { wrap(e) }
  const { slug } = parseKey(p.key)
  await removeOtherCopies(ctx.bucket, `${PREFIX}${slug}/`, p.key)
  return (await listBackups(ctx)).backups.find((b) => b.key === p.key) ?? null
}

export async function abortBackup(ctx: BackupContext, p: { key: string; uploadId: string }) {
  await ctx.bucket.abortMultipart(p.key, p.uploadId).catch(() => {})
}

/** Abort unfinished uploads by backup key (or all of them). */
export async function discardPending(ctx: BackupContext, keys: string[] | 'all') {
  let uploads
  try { uploads = await ctx.bucket.listMultipart(PREFIX) } catch (e) { wrap(e) }
  const pick = keys === 'all' ? uploads : uploads.filter((u) => keys.includes(u.key))
  await Promise.all(pick.map((u) => ctx.bucket.abortMultipart(u.key, u.uploadId).catch(() => {})))
  return pick.length
}

export async function deleteBackups(ctx: BackupContext, keys: string[]) {
  const safe = keys.filter(isBackupKey)
  for (let i = 0; i < safe.length; i += 8) await Promise.all(safe.slice(i, i + 8).map((k) => ctx.bucket.del(k).catch(() => {})))
  return safe.length
}

/** Delete every backup and unfinished upload this app made in the user's bucket. */
export async function deleteEverything(ctx: BackupContext) {
  const { backups } = await listBackups(ctx)
  await discardPending(ctx, 'all')
  await deleteBackups(ctx, backups.map((b) => b.key))
  return backups.length
}

export async function readBackup(ctx: BackupContext, key: string) {
  if (!isBackupKey(key)) return null
  try {
    return await ctx.bucket.get(key)
  } catch (e) {
    if (e instanceof S3Error && e.status === 404) return null
    wrap(e)
  }
}
