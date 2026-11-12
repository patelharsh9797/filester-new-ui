import { Check, Download, ExternalLink, LogOut, Share, Smartphone, SquarePlus } from 'lucide-react'
import { usePwaInstall } from '../lib/pwa'
import { BackupSetup } from '../components/BackupSetup'
import { ConnectionCheck } from '../components/ConnectionCheck'
import { PrivacyDetails } from '../components/PrivacyNote'
import { useSession, useSignOut } from '../state/session'
import { useAccount, useLibrary } from '../lib/library'
import { formatBytes } from '../lib/format'

export function SettingsPage() {
  const session = useSession()
  const signOut = useSignOut()
  const account = useAccount()
  const lib = useLibrary()
  const exp = session.exp
  const a = account.data
  const pwa = usePwaInstall()

  const exportCsv = () => {
    const rows = [['name', 'folder', 'size_bytes', 'type', 'uploaded', 'downloads', 'url']]
    for (const f of lib.files) rows.push([f.name, f.folderPath, String(f.size), f.type, f.created_at, String(f.downloads), f.url])
    const csv = rows.map((r) => r.map((c) => `"${c.replace(/"/g, '""')}"`).join(',')).join('\n')
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }))
    const link = Object.assign(document.createElement('a'), { href: url, download: 'filester-files.csv' })
    link.click()
    URL.revokeObjectURL(url)
  }

  const row = (k: string, v: React.ReactNode) => <div className="flex justify-between gap-4 py-2.5 text-sm"><span className="text-muted">{k}</span><span className="text-right min-w-0">{v}</span></div>

  return (
    <div className="max-w-2xl mx-auto p-4 sm:p-6 space-y-6">
      <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>

      <section className="card px-4 divide-y divide-line">
        {row('Username', session?.username)}
        {row('Account ID', a?.id ?? '…')}
        {row('Storage', a ? `${formatBytes(a.storage_used)} of ${formatBytes(a.storage_limit, 0)}` : '…')}
        {row('API requests today', a ? `${a.api_requests_today} (limit 1,000 / hour)` : '…')}
        {row('Session expires', exp ? new Date(exp * 1000).toLocaleString() : 'Unknown')}
        {row('Credentials', <span className="text-muted">Encrypted in an HttpOnly cookie (not readable by page scripts) · <a href="#privacy-h" className="underline">Privacy</a></span>)}
      </section>

      <div className="flex flex-wrap gap-2">
        <button className="btn" onClick={exportCsv} disabled={lib.filesLoading}><Download className="size-4" /> Export file list (CSV)</button>
        <a className="btn" href="https://filester.me/account" target="_blank" rel="noreferrer"><ExternalLink className="size-4" /> Filester account settings</a>
        <button className="btn text-danger ml-auto" onClick={() => signOut()}><LogOut className="size-4" /> Sign out</button>
      </div>

      <BackupSetup />

      <ConnectionCheck />

      <PrivacyDetails />

      <section className="card p-4 space-y-3">
        <div className="flex items-center gap-3">
          <img src="/icons/icon-192.png" alt="" className="size-10 rounded-xl" />
          <div className="flex-1">
            <h2 className="font-semibold flex items-center gap-1.5"><Smartphone className="size-4" /> Install as an app</h2>
            <p className="text-xs text-muted">Full screen, its own icon, opens like any other app on your phone or computer.</p>
          </div>
          {pwa.installed
            ? <span className="inline-flex items-center gap-1 text-sm text-ok"><Check className="size-4" /> Installed</span>
            : pwa.canPrompt && <button className="btn-primary" onClick={() => pwa.install()}><Download className="size-4" /> Install</button>}
        </div>
        {!pwa.installed && !pwa.canPrompt && (
          <div className="text-sm text-muted border-t border-line pt-3 space-y-1.5">
            {pwa.ios ? <>
              <p className="flex items-center gap-1.5"><b className="text-ink">iPhone / iPad:</b> in Safari tap <Share className="size-4 text-accent-ink" /> Share → <SquarePlus className="size-4 text-accent-ink" /> Add to Home Screen.</p>
            </> : <>
              <p><b className="text-ink">Android (Chrome):</b> menu ⋮ → <i>Install app</i> or <i>Add to Home screen</i>.</p>
              <p><b className="text-ink">Desktop Chrome / Edge:</b> the install icon at the right end of the address bar.</p>
              <p><b className="text-ink">iPhone / iPad:</b> open this site in Safari → Share → Add to Home Screen.</p>
            </>}
          </div>
        )}
      </section>

      <section className="text-sm text-muted space-y-2">
        <h2 className="font-semibold text-ink">Keyboard shortcuts</h2>
        <ul className="space-y-1">
          <li><kbd className="border border-line rounded px-1.5 text-xs">Ctrl/⌘ K</kbd> or <kbd className="border border-line rounded px-1.5 text-xs">/</kbd> — search folders &amp; files</li>
          <li><kbd className="border border-line rounded px-1.5 text-xs">Tab</kbd> in search — switch between All / Folders / Files</li>
          <li><kbd className="border border-line rounded px-1.5 text-xs">F</kbd> on the Folders page — focus the folder filter</li>
          <li>Shift-click checkboxes to select a range of files</li>
          <li>Drop files anywhere to upload into the folder you're viewing</li>
        </ul>
      </section>
    </div>
  )
}
