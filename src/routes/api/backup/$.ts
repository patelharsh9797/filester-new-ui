// /api/backup/<action> — manual R2 backups of Filester files (signed-in users only).
import { createFileRoute } from '@tanstack/react-router'
import { readSession } from '../../../server/session.server'
import {
  BackupError, abortBackup, completeBackup, copyPart, deleteBackups, getTicket, initBackup, listBackups, readBackup,
  type DownloadTicket,
} from '../../../server/backup.server'

const json = (data: unknown, status = 200) => Response.json(data, { status, headers: { 'cache-control': 'private, no-store' } })
const str = (v: unknown, max = 200) => (typeof v === 'string' ? v.slice(0, max) : '')
const isKey = (k: string) => k.startsWith('backups/') && !k.includes('..')

function ticketFrom(v: unknown): DownloadTicket {
  const t = (v ?? {}) as Record<string, unknown>
  return { server: str(t.server), file: str(t.file, 300), token: str(t.token, 1000), name: str(t.name, 300), expiresAt: Number(t.expiresAt) || 0 }
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
    if (request.method === 'GET' && action === 'list') return json({ success: true, ...(await listBackups()) })

    if (request.method === 'GET' && action === 'download') {
      const key = new URL(request.url).searchParams.get('key') ?? ''
      const obj = isKey(key) ? await readBackup(key) : null
      if (!obj) return json({ success: false, message: 'Backup not found' }, 404)
      const headers = new Headers({ 'cache-control': 'private, no-store' })
      obj.writeHttpMetadata(headers)
      headers.set('content-length', String(obj.size))
      return new Response(obj.body, { headers })
    }

    if (request.method !== 'POST') return json({ success: false, message: 'Method not allowed' }, 405)
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>

    switch (action) {
      case 'init': {
        const slug = str(body.slug, 32)
        if (!/^[A-Za-z0-9_-]+$/.test(slug)) return json({ success: false, message: 'Bad file id' }, 400)
        return json({ success: true, ...(await initBackup(session, slug, str(body.folder, 500))) })
      }
      case 'ticket': {
        const slug = str(body.slug, 32)
        if (!/^[A-Za-z0-9_-]+$/.test(slug)) return json({ success: false, message: 'Bad file id' }, 400)
        return json({ success: true, ticket: await getTicket(session, slug) })
      }
      case 'part': {
        const key = str(body.key, 300)
        if (!isKey(key)) return json({ success: false, message: 'Bad key' }, 400)
        const part = await copyPart({ key, uploadId: str(body.uploadId, 1000), size: Number(body.size), part: Number(body.part), ticket: ticketFrom(body.ticket) })
        return json({ success: true, ...part })
      }
      case 'complete': {
        const key = str(body.key, 300)
        if (!isKey(key) || !Array.isArray(body.parts)) return json({ success: false, message: 'Bad request' }, 400)
        const parts = (body.parts as { partNumber: number; etag: string }[]).map((p) => ({ partNumber: Number(p.partNumber), etag: str(p.etag, 200) }))
        return json({ success: true, backup: await completeBackup({ key, uploadId: str(body.uploadId, 1000), parts }) })
      }
      case 'abort': {
        const key = str(body.key, 300)
        if (isKey(key)) await abortBackup({ key, uploadId: str(body.uploadId, 1000) })
        return json({ success: true })
      }
      case 'delete': {
        const keys = Array.isArray(body.keys) ? (body.keys as unknown[]).map((k) => str(k, 300)).filter(isKey) : []
        return json({ success: true, deleted: await deleteBackups(keys) })
      }
      default:
        return json({ success: false, message: 'Unknown action' }, 404)
    }
  } catch (e) {
    const err = e as BackupError
    return json({ success: false, message: err.message || 'Backup failed', code: err.code }, err.status && err.status >= 400 ? err.status : 500)
  }
}

export const Route = createFileRoute('/api/backup/$')({
  server: { handlers: { GET: handle, POST: handle } },
})
