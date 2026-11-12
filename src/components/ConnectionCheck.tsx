import { useState } from 'react'
import { AlertTriangle, CheckCircle2, CircleSlash, Loader2, PlugZap, XCircle } from 'lucide-react'
import { getAccount, getFileInfo, getFilesPage, getFolderFlags, getFolderInfo, getFolders, getFromExport } from '../lib/api'
import { getBackupConfig, listBackups } from '../lib/backup'
import { FilesterChangedError } from '../lib/shape'
import { plural } from '../lib/format'

type Status = 'ok' | 'changed' | 'error' | 'skipped'
interface Result { name: string; what: string; status: Status; detail: string; ms: number }

/**
 * Read-only probes of every Filester endpoint the app depends on, so a user can tell
 * "Filester changed something" apart from "my session expired" or "Filester is down".
 * Never asks for a download token (Filester counts that as a download).
 */
export function ConnectionCheck() {
  const [results, setResults] = useState<Result[]>([])
  const [running, setRunning] = useState(false)

  const run = async () => {
    setRunning(true)
    setResults([])
    const ctx: { slug?: string; folder?: string } = {}
    const probes: { name: string; what: string; run: () => Promise<string | null> }[] = [
      { name: 'API key', what: 'v1/account', run: async () => { const a = await getAccount(); return `Signed in as ${a.username}` } },
      { name: 'Folder list', what: 'v1/folders', run: async () => { const f = await getFolders(); ctx.folder = f[0]?.id; return plural(f.length, 'folder') } },
      { name: 'File list', what: 'files/export.csv', run: async () => { const r = await getFromExport(); ctx.slug = r.files[0]?.url.split('/d/')[1]; return `${plural(r.files.length, 'file')} with activity dates` } },
      { name: 'File list (API fallback)', what: 'v1/files', run: async () => { const r = await getFilesPage(1, 1); return `${plural(r.pagination.total, 'file')} reported` } },
      { name: 'Folder settings', what: 'manager/data', run: async () => { const m = await getFolderFlags(); return m.size ? `Hide-related and password flags for ${plural(m.size, 'folder')}` : 'No folders returned (normal if you have none)' } },
      { name: 'File details', what: 'file/info', run: async () => ctx.slug ? `Read “${(await getFileInfo(ctx.slug)).original_name}”` : null },
      { name: 'Folder details', what: 'folder/info', run: async () => ctx.folder ? `Read “${(await getFolderInfo(ctx.folder)).name}”` : null },
      {
        name: 'Backup bucket', what: 'your R2 bucket', run: async () => {
          if (!(await getBackupConfig()).connected) return null
          const l = await listBackups()
          return `Reachable · ${plural(l.backups.length, 'backup')}`
        },
      },
    ]
    for (const p of probes) {
      const t = performance.now()
      let r: Result
      try {
        const detail = await p.run()
        r = { name: p.name, what: p.what, status: detail === null ? 'skipped' : 'ok', detail: detail ?? 'Nothing to check', ms: 0 }
      } catch (e) {
        const changed = e instanceof FilesterChangedError
        r = { name: p.name, what: p.what, status: changed ? 'changed' : 'error', detail: changed ? e.detail : (e as Error).message, ms: 0 }
      }
      r.ms = Math.round(performance.now() - t)
      setResults((list) => [...list, r])
    }
    setRunning(false)
  }

  const changed = results.filter((r) => r.status === 'changed').length
  const failed = results.filter((r) => r.status === 'error').length
  const icon = (s: Status) =>
    s === 'ok' ? <CheckCircle2 className="size-4 text-ok shrink-0" />
      : s === 'changed' ? <AlertTriangle className="size-4 text-accent-ink shrink-0" />
      : s === 'error' ? <XCircle className="size-4 text-danger shrink-0" />
      : <CircleSlash className="size-4 text-faint shrink-0" />

  return (
    <section className="card p-4 space-y-3" aria-labelledby="conn-h">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex-1 min-w-0">
          <h2 id="conn-h" className="font-semibold flex items-center gap-1.5"><PlugZap className="size-4" /> Filester connection</h2>
          <p className="text-xs text-muted">Checks every Filester feature this app uses, read-only. Use it when something looks wrong.</p>
        </div>
        <button className="btn" onClick={run} disabled={running}>
          {running ? <Loader2 className="size-4 animate-spin" /> : <PlugZap className="size-4" />} {results.length ? 'Check again' : 'Check connection'}
        </button>
      </div>

      {results.length > 0 && (
        <ul className="divide-y divide-line border-t border-line text-sm" aria-label="Connection check results">
          {results.map((r) => (
            <li key={r.name} className="flex items-start gap-2 py-2" data-status={r.status}>
              <span className="mt-0.5">{icon(r.status)}</span>
              <span className="flex-1 min-w-0">
                <span className="font-medium">{r.name}</span> <span className="text-xs text-faint font-mono">{r.what}</span>
                <span className={`block break-words ${r.status === 'ok' || r.status === 'skipped' ? 'text-muted' : r.status === 'changed' ? 'text-accent-ink' : 'text-danger'}`}>{r.detail}</span>
              </span>
              <span className="text-xs text-faint tabular">{r.status === 'skipped' ? '' : `${r.ms} ms`}</span>
            </li>
          ))}
        </ul>
      )}

      {!running && results.length > 0 && (
        <p className={`text-sm rounded-lg px-3 py-2 ${changed ? 'bg-accent-soft text-accent-ink' : failed ? 'bg-danger-soft text-danger' : 'bg-raised text-muted'}`}>
          {changed
            ? <>Filester changed {plural(changed, 'endpoint')} this app depends on. Features using {changed === 1 ? 'it' : 'them'} are paused to avoid acting on wrong data; the app needs an update.</>
            : failed
              ? <>Some checks failed. If it says “sign in again”, your session expired; otherwise Filester may be down or rate-limiting — try again in a few minutes.</>
              : <>Everything works. (Downloads aren’t tested: Filester counts every download link it hands out.)</>}
        </p>
      )}
    </section>
  )
}
