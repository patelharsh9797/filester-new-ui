// /api/prefs: the signed-in user's synced pins and saved searches (opt-in).
//   GET    → { enabled, prefs }     (enabled = a synced copy exists for this account)
//   PUT    → store the given prefs  (turns sync on)
//   DELETE → remove the synced copy (turns sync off; each browser keeps its own)
import { createFileRoute } from '@tanstack/react-router'
import { readSession } from '../../server/session.server'
import { ConfigError, userIdOf } from '../../server/r2config.server'
import { deletePrefs, loadPrefs, parsePrefs, savePrefs, MAX_PREFS_BYTES } from '../../server/prefs.server'

const json = (data: unknown, status = 200) => Response.json(data, { status, headers: { 'cache-control': 'private, no-store' } })

async function handle({ request }: { request: Request }) {
  if (request.method !== 'GET') {
    const origin = request.headers.get('origin')
    if (origin && origin !== new URL(request.url).origin) return json({ success: false, message: 'Cross-site request blocked' }, 403)
  }
  const session = await readSession()
  if (!session) return json({ success: false, message: 'Not signed in' }, 401)
  try {
    const userId = await userIdOf(session)
    if (request.method === 'GET') {
      const prefs = await loadPrefs(userId)
      return json({ success: true, enabled: !!prefs, prefs })
    }
    if (request.method === 'PUT') {
      const text = await request.text()
      if (text.length > MAX_PREFS_BYTES * 2) return json({ success: false, message: 'Too much to sync' }, 413)
      const prefs = parsePrefs(JSON.parse(text || '{}'))
      await savePrefs(userId, prefs)
      return json({ success: true, updatedAt: prefs.updatedAt, syncId: prefs.syncId })
    }
    if (request.method === 'DELETE') {
      await deletePrefs(userId)
      return json({ success: true })
    }
    return json({ success: false, message: 'Method not allowed' }, 405)
  } catch (e) {
    if (e instanceof ConfigError) return json({ success: false, message: e.message }, e.status)
    if (e instanceof SyntaxError) return json({ success: false, message: 'Bad request' }, 400)
    throw e
  }
}

export const Route = createFileRoute('/api/prefs')({
  server: { handlers: { GET: handle, PUT: handle, DELETE: handle } },
})
