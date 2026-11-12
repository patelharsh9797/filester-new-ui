import { useEffect, useRef } from 'react'

interface TurnstileApi {
  render: (el: HTMLElement, opts: Record<string, unknown>) => string
  reset: (id: string) => void
  remove: (id: string) => void
}
declare global {
  interface Window { turnstile?: TurnstileApi }
}

const SRC = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'
let loading: Promise<TurnstileApi> | null = null
function loadTurnstile(): Promise<TurnstileApi> {
  if (window.turnstile) return Promise.resolve(window.turnstile)
  loading ??= new Promise((resolve, reject) => {
    const s = Object.assign(document.createElement('script'), { src: SRC, async: true })
    s.onload = () => (window.turnstile ? resolve(window.turnstile) : reject(new Error('Turnstile failed to load')))
    s.onerror = () => { loading = null; reject(new Error('Turnstile failed to load')) }
    document.head.appendChild(s)
  })
  return loading
}

/**
 * Cloudflare Turnstile widget. Calls onToken with a fresh token (or '' when it expires).
 * Tokens are single-use: bump `resetKey` after each submit to get a new one.
 */
export function Turnstile({ siteKey, onToken, resetKey, onError }: { siteKey: string; onToken: (t: string) => void; resetKey: number; onError?: (m: string) => void }) {
  const el = useRef<HTMLDivElement>(null)
  const id = useRef<string | null>(null)
  const cb = useRef({ onToken, onError })
  cb.current = { onToken, onError }

  useEffect(() => {
    let cancelled = false
    loadTurnstile().then((t) => {
      if (cancelled || !el.current) return
      id.current = t.render(el.current, {
        sitekey: siteKey,
        theme: 'auto',
        size: 'flexible',
        callback: (tok: string) => cb.current.onToken(tok),
        'expired-callback': () => cb.current.onToken(''),
        'error-callback': () => { cb.current.onToken(''); cb.current.onError?.('The human check couldn’t run — reload the page and try again.') },
      })
    }).catch((e: Error) => cb.current.onError?.(e.message))
    return () => {
      cancelled = true
      if (id.current) window.turnstile?.remove(id.current)
      id.current = null
    }
  }, [siteKey])

  useEffect(() => {
    if (resetKey && id.current) {
      cb.current.onToken('')
      window.turnstile?.reset(id.current)
    }
  }, [resetKey])

  return <div ref={el} className="min-h-[65px]" data-testid="turnstile" />
}
