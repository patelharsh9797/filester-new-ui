// /api/fs/<v1|v2|u1|web>/... → Filester, with the signed-in user's credentials.
import { createFileRoute } from '@tanstack/react-router'
import { readSession } from '../../../server/session.server'
import { proxy } from '../../../server/filester.server'

async function handle({ request, params }: { request: Request; params: { _splat?: string } }) {
  // CSRF: state-changing requests must come from this site.
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    const origin = request.headers.get('origin')
    if (origin && origin !== new URL(request.url).origin) {
      return Response.json({ success: false, message: 'Cross-site request blocked' }, { status: 403 })
    }
  }
  const session = await readSession()
  if (!session) return Response.json({ success: false, message: 'Not signed in' }, { status: 401 })
  try {
    return await proxy(request, params._splat ?? '', session)
  } catch (e) {
    return Response.json({ success: false, message: `Upstream error: ${(e as Error).message}` }, { status: 502 })
  }
}

export const Route = createFileRoute('/api/fs/$')({
  server: {
    handlers: { GET: handle, POST: handle, PUT: handle, DELETE: handle },
  },
})
