// /api/backup/<action> — backups into the signed-in user's OWN R2 bucket.
//
// Setup:   GET config · POST connect · POST settings · POST disconnect
// Backups: GET list · GET download · POST init · ticket · part · complete · abort · discard · delete
import { createFileRoute } from '@tanstack/react-router'
import { readSession, type Session } from '../../../server/session.server'
import {
  ConfigError, deleteConfig, getUsage, loadConfig, maskConfig, parseCredentials, parseSettings, saveConfig, userIdOf, type R2Config,
} from '../../../server/r2config.server'
import { S3Error, s3 } from '../../../server/s3.server'
import {
  BackupError, PREFIX, abortBackup, completeBackup, copyPart, deleteBackups, deleteEverything, discardPending, getTicket,
  initBackup, isBackupKey, listBackups, readBackup, type BackupContext, type DownloadTicket,
} from '../../../server/backup.server'

const json = (data: unknown, status = 200) => Response.json(data, { status, headers: { 'cache-control': 'private, no-store' } })
const str = (v: unknown, max = 200) => (typeof v === 'string' ? v.slice(0, max) : '')
const SLUG_RE = /^[A-Za-z0-9_-]{1,32}$/

function ticketFrom(v: unknown): DownloadTicket {
  const t = (v ?? {}) as Record<string, unknown>
  return { server: str(t.server), file: str(t.file, 300), token: str(t.token, 1000), name: str(t.name, 300), expiresAt: Number(t.expiresAt) || 0 }
}

/** Check the credentials really work: write, read back and delete a small test object. */
async function testBucket(cfg: R2Config) {
  const b = s3(cfg)
  const key = `${PREFIX}.connection-test-${crypto.randomUUID()}`
  const body = `filester-navigator connection test ${new Date().toISOString()}`
  try {
    await b.put(key, body, new TextEncoder().encode(body).length, { 'content-type': 'text/plain' })
    const back = await (await b.get(key)).text()
    if (back !== body) throw new ConfigError('The bucket returned different data than was written.')
    await b.del(key)
    await b.listMultipart(PREFIX)
  } catch (e) {
    if (e instanceof S3Error) throw new ConfigError(e.message, 400)
    throw e
  }
}

async function context(session: Session): Promise<BackupContext | null> {
  const userId = await userIdOf(session)
  const cfg = await loadConfig(userId)
  return cfg ? { session, userId, cfg, bucket: s3(cfg) } : null
}

async function handle({ request, params }: { request: Request; params: { _splat?: string } }) {
  if (request.method !== 'GET') {
    const origin = request.headers.get('origin')
    if (origin && origin !== new URL(request.url).origin) return json({ success: false, message: 'Cross-site request blocked' }, 403)
  }
  const session = await readSession()
  if (!session) return json({ success: false, message: 'Not signed in' }, 401)
  const action = params._splat ?? ''

  try {
    const body = request.method === 'POST' ? ((await request.json().catch(() => ({}))) as Record<string, unknown>) : {}

    // ---------------------------------------------------------------- setup
    if (action === 'config' && request.method === 'GET') {
      const userId = await userIdOf(session)
      const [cfg, usage] = await Promise.all([loadConfig(userId), getUsage(userId)])
      // remaining is Infinity without a cap, which JSON can't carry
      return json({ success: true, connected: !!cfg, config: cfg ? maskConfig(cfg) : null, usage: { ...usage, remaining: usage.cap === null ? null : usage.remaining } })
    }
    if (action === 'connect' && request.method === 'POST') {
      const userId = await userIdOf(session)
      const creds = parseCredentials(body)
      const current = await loadConfig(userId)
      const cfg: R2Config = {
        ...creds,
        retentionDays: current?.retentionDays ?? 7,
        limitGb: current?.limitGb ?? 10,
        connectedAt: new Date().toISOString(),
      }
      await testBucket(cfg)
      await saveConfig(userId, cfg)
      return json({ success: true, connected: true, config: maskConfig(cfg) })
    }
    if (action === 'settings' && request.method === 'POST') {
      const userId = await userIdOf(session)
      const cfg = await loadConfig(userId)
      if (!cfg) return json({ success: false, message: 'Connect a bucket first', code: 'NOT_CONNECTED' }, 409)
      const next = { ...cfg, ...parseSettings(body) }
      await saveConfig(userId, next)
      return json({ success: true, config: maskConfig(next) })
    }
    if (action === 'disconnect' && request.method === 'POST') {
      const userId = await userIdOf(session)
      let deleted = 0
      if (body.deleteBackups === true) {
        const ctx = await context(session)
        if (ctx) deleted = await deleteEverything(ctx).catch(() => 0)
      }
      await deleteConfig(userId)
      return json({ success: true, deleted })
    }

    // ---------------------------------------------------------------- backups
    const ctx = await context(session)
    if (!ctx) return json({ success: false, message: 'Backups are off. Connect your R2 bucket in Settings to turn them on.', code: 'NOT_CONNECTED' }, 409)

    if (request.method === 'GET' && action === 'list') return json({ success: true, ...(await listBackups(ctx)) })

    if (request.method === 'GET' && action === 'download') {
      const key = new URL(request.url).searchParams.get('key') ?? ''
      const obj = isBackupKey(key) ? await readBackup(ctx, key) : null
      if (!obj) return json({ success: false, message: 'Backup not found' }, 404)
      const headers = new Headers({ 'cache-control': 'private, no-store' })
      for (const h of ['content-type', 'content-length', 'content-disposition']) { const v = obj.headers.get(h); if (v) headers.set(h, v) }
      if (!headers.has('content-disposition')) headers.set('content-disposition', `attachment; filename*=UTF-8''${encodeURIComponent(key.split('/').pop() ?? 'backup')}`)
      return new Response(obj.body, { headers })
    }

    if (request.method !== 'POST') return json({ success: false, message: 'Method not allowed' }, 405)

    switch (action) {
      case 'init': {
        const slug = str(body.slug, 32)
        if (!SLUG_RE.test(slug)) return json({ success: false, message: 'Bad file id' }, 400)
        return json({ success: true, ...(await initBackup(ctx, slug, str(body.type, 100) || 'application/octet-stream')) })
      }
      case 'ticket': {
        const slug = str(body.slug, 32)
        if (!SLUG_RE.test(slug)) return json({ success: false, message: 'Bad file id' }, 400)
        return json({ success: true, ticket: await getTicket(session, slug) })
      }
      case 'part': {
        const key = str(body.key, 600)
        if (!isBackupKey(key)) return json({ success: false, message: 'Bad key' }, 400)
        return json({ success: true, ...(await copyPart(ctx, { key, uploadId: str(body.uploadId, 1000), size: Number(body.size), part: Number(body.part), ticket: ticketFrom(body.ticket) })) })
      }
      case 'complete': {
        const key = str(body.key, 600)
        if (!isBackupKey(key) || !Array.isArray(body.parts)) return json({ success: false, message: 'Bad request' }, 400)
        const parts = (body.parts as { partNumber: number; etag: string }[]).map((p) => ({ partNumber: Number(p.partNumber), etag: str(p.etag, 200) }))
        return json({ success: true, backup: await completeBackup(ctx, { key, uploadId: str(body.uploadId, 1000), parts }) })
      }
      case 'abort': {
        const key = str(body.key, 600)
        if (isBackupKey(key)) await abortBackup(ctx, { key, uploadId: str(body.uploadId, 1000) })
        return json({ success: true })
      }
      case 'discard': {
        const keys = body.all === true ? 'all' as const : Array.isArray(body.keys) ? (body.keys as unknown[]).map((k) => str(k, 600)).filter(isBackupKey) : []
        return json({ success: true, discarded: await discardPending(ctx, keys) })
      }
      case 'delete': {
        const keys = Array.isArray(body.keys) ? (body.keys as unknown[]).map((k) => str(k, 600)).filter(isBackupKey) : []
        return json({ success: true, deleted: await deleteBackups(ctx, keys) })
      }
      default:
        return json({ success: false, message: 'Unknown action' }, 404)
    }
  } catch (e) {
    if (e instanceof ConfigError) return json({ success: false, message: e.message, code: 'CONFIG' }, e.status)
    const err = e as BackupError
    // Never echo credentials: messages come from our own code or mapped bucket errors.
    return json({ success: false, message: err.message || 'Backup failed', code: err.code }, err.status && err.status >= 400 ? err.status : 500)
  }
}

export const Route = createFileRoute('/api/backup/$')({
  server: { handlers: { GET: handle, POST: handle } },
})
