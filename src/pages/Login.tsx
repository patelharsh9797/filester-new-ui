import { useState } from 'react'
import { KeyRound, Loader2 } from 'lucide-react'
import { login } from '../lib/api'
import { useAuth } from '../state/auth'
import { FolderIcon } from '../components/icons'

export function LoginPage() {
  const { signIn } = useAuth()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [code, setCode] = useState('')
  const [needs2fa, setNeeds2fa] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [manualKey, setManualKey] = useState('')
  const [askKey, setAskKey] = useState<{ username: string; token: string } | null>(null)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      const r = await login(username.trim(), password, needs2fa ? code.trim() : undefined)
      if (r.requires2fa) { setNeeds2fa(true); return }
      if (!r.session.apiKey) { setAskKey({ username: r.session.username, token: r.session.token }); return }
      signIn(r.session)
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
        {askKey ? (
          <form className="card p-6 space-y-4" onSubmit={(e) => { e.preventDefault(); if (manualKey.trim()) signIn({ ...askKey, apiKey: manualKey.trim() }) }}>
            <p className="text-sm text-muted">Signed in, but the API key couldn't be read automatically. Paste it from <a className="text-accent-ink underline" href="https://filester.me/account" target="_blank" rel="noreferrer">Account Settings</a> on Filester.</p>
            <input className="input font-mono" placeholder="API key" value={manualKey} onChange={(e) => setManualKey(e.target.value)} autoFocus />
            <button className="btn-primary w-full" disabled={!manualKey.trim()}><KeyRound className="size-4" /> Continue</button>
          </form>
        ) : (
          <form className="card p-6 space-y-4" onSubmit={submit}>
            <div>
              <label className="block text-sm text-muted mb-1.5" htmlFor="u">Filester username</label>
              <input id="u" className="input" autoComplete="username" value={username} onChange={(e) => setUsername(e.target.value)} autoFocus required />
            </div>
            <div>
              <label className="block text-sm text-muted mb-1.5" htmlFor="p">Password</label>
              <input id="p" type="password" className="input" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
            </div>
            {needs2fa && (
              <div>
                <label className="block text-sm text-muted mb-1.5" htmlFor="c">2FA code or backup code</label>
                <input id="c" className="input font-mono tracking-widest" inputMode="text" maxLength={8} value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} autoFocus required />
              </div>
            )}
            {error && <p className="text-sm text-danger">{error}</p>}
            <button className="btn-primary w-full" disabled={busy}>{busy && <Loader2 className="size-4 animate-spin" />}Sign in</button>
            <p className="text-xs text-faint leading-relaxed">
              Your credentials go only to filester.me through the local server. The session token and API key are kept in this browser's local storage.
            </p>
          </form>
        )}
      </div>
    </div>
  )
}
