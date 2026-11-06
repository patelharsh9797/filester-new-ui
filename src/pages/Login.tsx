import { useEffect, useState } from 'react'
import { useRouter } from '@tanstack/react-router'
import { KeyRound, Loader2 } from 'lucide-react'
import { login } from '../server/auth.functions'
import { FolderIcon } from '../components/icons'

export function LoginPage() {
  const router = useRouter()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [code, setCode] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [step, setStep] = useState<'credentials' | '2fa' | 'api-key'>('credentials')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  // The page is server-rendered: block submits until React has hydrated so a
  // fast click can't trigger a native form submit.
  const [ready, setReady] = useState(false)
  useEffect(() => setReady(true), [])

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      const r = await login({ data: { username, password, code: code || undefined, apiKey: apiKey || undefined } })
      if (r.status === 'needs-2fa') setStep('2fa')
      else if (r.status === 'needs-api-key') setStep('api-key')
      else if (r.status === 'error') setError(r.message)
      else {
        await router.invalidate()
        await router.navigate({ to: '/' })
      }
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="min-h-full grid place-items-center p-4">
      <div className="w-full max-w-sm">
        <div className="flex items-center gap-2.5 justify-center mb-6">
          <FolderIcon className="size-8" />
          <h1 className="text-xl font-semibold tracking-tight">Filester <span className="text-faint font-normal">Navigator</span></h1>
        </div>
        <form className="card p-6 space-y-4" method="post" action="/login" onSubmit={submit}>
          <div>
            <label className="block text-sm text-muted mb-1.5" htmlFor="u">Filester username</label>
            <input id="u" className="input" autoComplete="username" value={username} onChange={(e) => setUsername(e.target.value)} autoFocus required disabled={step !== 'credentials'} />
          </div>
          <div>
            <label className="block text-sm text-muted mb-1.5" htmlFor="p">Password</label>
            <input id="p" type="password" className="input" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required disabled={step !== 'credentials'} />
          </div>
          {step === '2fa' && (
            <div>
              <label className="block text-sm text-muted mb-1.5" htmlFor="c">2FA code or backup code</label>
              <input id="c" className="input font-mono tracking-widest" maxLength={8} value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} autoFocus required />
            </div>
          )}
          {step === 'api-key' && (
            <div>
              <p className="text-sm text-muted mb-2">Signed in, but the API key couldn't be read automatically. Paste it from <a className="text-accent-ink underline" href="https://filester.me/account" target="_blank" rel="noreferrer">Account Settings</a> on Filester.</p>
              <input className="input font-mono" placeholder="API key" value={apiKey} onChange={(e) => setApiKey(e.target.value)} autoFocus required />
            </div>
          )}
          {error && <p className="text-sm text-danger">{error}</p>}
          <button className="btn-primary w-full" disabled={busy || !ready}>
            {busy ? <Loader2 className="size-4 animate-spin" /> : step === 'api-key' && <KeyRound className="size-4" />}
            {step === 'credentials' ? 'Sign in' : 'Continue'}
          </button>
          {step !== 'credentials' && (
            <button type="button" className="text-xs text-muted hover:text-ink underline w-full" onClick={() => { setStep('credentials'); setCode(''); setApiKey(''); setError('') }}>
              Start over
            </button>
          )}
          <p className="text-xs text-faint leading-relaxed">
            Your password is sent once to filester.me to sign in and is never stored. The session is kept in an encrypted, HttpOnly cookie for up to 30 days.
          </p>
        </form>
      </div>
    </div>
  )
}
