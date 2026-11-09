import { useState } from 'react'
import { Link } from '@tanstack/react-router'
import { Check, Download, Loader2, RotateCw, Trash2, X } from 'lucide-react'
import { backupDownloadUrl, deleteBackups, discardPending } from '../lib/backup'
import { formatBytes, formatDate, formatRelative, kindOf } from '../lib/format'
import { useBackupConfig, useBackupList, useBackups } from '../state/backups'
import { BackupSetup } from '../components/BackupSetup'
import { useLibrary } from '../lib/library'
import { useDialogs } from '../state/dialogs'
import { useToast } from '../state/toast'
import { useQueryClient } from '@tanstack/react-query'
import { FileKindIcon } from '../components/icons'
import { Skeleton } from './Overview'

export function BackupsPage() {
  const cfg = useBackupConfig()
  const list = useBackupList()
  const lib = useLibrary()
  const folderOf = (slug: string) => lib.files.find((f) => f.slug === slug)?.folderPath ?? ''
  const { jobs, cancel, clearFinished, enqueue } = useBackups()
  const { confirm } = useDialogs()
  const toast = useToast()
  const qc = useQueryClient()
  const [selected, setSelected] = useState<Set<string>>(new Set())

  const data = list.data
  const pct = data ? Math.min(100, (data.used / data.limit) * 100) : 0
  const activeJobs = [...jobs.values()]
  const backups = data?.backups ?? []

  const remove = async (keys: string[]) => {
    const ok = await confirm({
      title: keys.length === 1 ? 'Delete this backup?' : `Delete ${keys.length} backups?`,
      message: 'Only the copy in R2 is deleted. The file on Filester is not touched.',
      confirmLabel: 'Delete', danger: true,
    })
    if (!ok) return
    try {
      await deleteBackups(keys)
      toast('success', `Deleted ${keys.length} backup${keys.length === 1 ? '' : 's'}`)
      setSelected(new Set())
    } catch (e) {
      toast('error', (e as Error).message)
    }
    qc.invalidateQueries({ queryKey: ['backups'] })
  }

  return (
    <div className="max-w-6xl mx-auto p-4 sm:p-6 space-y-5">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Backups</h1>
        <p className="text-sm text-muted max-w-3xl">
          Copies of Filester files stored in your own Cloudflare R2 bucket. Start backups from the <Link to="/expiring" className="text-accent-ink underline">Expiring soon</Link> page.
          {data && <> Backups are deleted automatically after <b>{data.retentionDays} days</b>.</>}
        </p>
      </div>

      <BackupSetup />

      {cfg.data?.connected && <>
      <div className="card p-4">
        <div className="flex justify-between text-sm mb-2">
          <span className="text-muted">R2 backup space</span>
          <span className="tabular">{data ? `${formatBytes(data.used)} of ${formatBytes(data.limit, 0)}` : '…'}</span>
        </div>
        <div className="h-2 rounded-full bg-raised overflow-hidden"><div className={`h-full ${pct > 90 ? 'bg-danger' : 'bg-accent'}`} style={{ width: `${Math.max(pct, data?.used ? 1 : 0)}%` }} /></div>
        <p className="text-xs text-faint mt-2">In your bucket <b>{data?.bucket}</b>, including unfinished uploads. New backups are refused once they would go over your limit.</p>
      </div>

      {list.error && <p className="text-sm text-danger bg-danger-soft rounded-lg px-3 py-2">Couldn't load backups: {(list.error as Error).message}</p>}

      {activeJobs.length > 0 && (
        <section className="space-y-2">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold">This session</h2>
            <button className="text-xs text-muted hover:text-ink" onClick={clearFinished}>Clear finished</button>
          </div>
          <ul className="card divide-y divide-line">
            {activeJobs.map((j) => {
              const p = j.size ? Math.round((j.copied / j.size) * 100) : 100
              return (
                <li key={j.slug} className="px-3 py-2.5">
                  <div className="flex items-center gap-2 text-sm">
                    <FileKindIcon kind={kindOf(j.name, '')} />
                    <span className="truncate flex-1" title={j.name}>{j.name}</span>
                    <span className="text-xs text-faint tabular">{formatBytes(j.size)}</span>
                    {j.status === 'running' && <Loader2 className="size-4 animate-spin text-muted" />}
                    {j.status === 'done' && <Check className="size-4 text-ok" />}
                    {(j.status === 'running' || j.status === 'queued') && <button className="btn-icon size-6" onClick={() => cancel(j.slug)} aria-label="Cancel"><X className="size-3.5" /></button>}
                  </div>
                  {j.status === 'running' && <div className="mt-1.5 h-1.5 rounded-full bg-raised overflow-hidden"><div className="h-full bg-accent transition-[width]" style={{ width: `${p}%` }} /></div>}
                  <div className="text-[11px] mt-1">
                    {j.status === 'queued' && <span className="text-faint">Waiting…</span>}
                    {j.status === 'running' && <span className="text-faint tabular">{p}% · {formatBytes(j.copied)} of {formatBytes(j.size)}</span>}
                    {j.status === 'done' && <span className="text-ok">Backed up</span>}
                    {j.status === 'cancelled' && <span className="text-faint">Cancelled</span>}
                    {j.status === 'error' && <span className="text-danger">{j.error}</span>}
                    {j.status === 'interrupted' && <span className="text-accent-ink">Interrupted — resume it from the backup panel</span>}
                  </div>
                </li>
              )
            })}
          </ul>
          {activeJobs.some((j) => j.status === 'running' || j.status === 'queued') && <p className="text-xs text-faint">Keep this tab open until copying finishes.</p>}
        </section>
      )}

      {(data?.pending.length ?? 0) > 0 && (
        <section className="space-y-2">
          <div className="flex items-center gap-2">
            <h2 className="font-semibold mr-auto">Unfinished uploads <span className="text-faint font-normal text-sm">{data!.pending.length}</span></h2>
            <button className="btn h-8 text-danger" onClick={async () => {
              const ok = await confirm({ title: 'Discard unfinished uploads?', message: 'Frees the space these partial copies use in R2. Files on Filester are not touched.', confirmLabel: 'Discard', danger: true })
              if (!ok) return
              try { const r = await discardPending('all'); toast('success', `Discarded ${r.discarded} unfinished upload${r.discarded === 1 ? '' : 's'}`) } catch (e) { toast('error', (e as Error).message) }
              qc.invalidateQueries({ queryKey: ['backups'] })
            }}><Trash2 className="size-4" /> Discard all</button>
          </div>
          <p className="text-xs text-faint">Backups that stopped part-way (tab closed, phone call, lost connection). Their pieces still take space in R2 — Cloudflare shows them in the bucket size but not as objects. They can be resumed from the backup panel on the device that started them, and are discarded automatically after 24 hours.</p>
          <ul className="card divide-y divide-line">
            {data!.pending.map((u) => (
              <li key={u.key} className="flex items-center gap-2.5 px-3 py-2 text-sm">
                <FileKindIcon kind={kindOf(u.name, '')} />
                <span className="truncate flex-1" title={u.name}>{u.name}</span>
                <span className="text-xs text-faint tabular">{formatBytes(u.size)}</span>
                <span className="text-xs text-faint whitespace-nowrap">started {formatRelative(u.startedAt)}</span>
                <button className="btn-icon" aria-label="Discard" title="Discard" onClick={async () => { await discardPending([u.key]).catch(() => {}); qc.invalidateQueries({ queryKey: ['backups'] }) }}><Trash2 className="size-4" /></button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="space-y-2">
        <div className="flex items-center gap-2">
          <h2 className="font-semibold mr-auto">Stored backups <span className="text-faint font-normal text-sm">{backups.length}</span></h2>
          {selected.size > 0 && <button className="btn h-8 text-danger" onClick={() => remove([...selected])}><Trash2 className="size-4" /> Delete {selected.size}</button>}
          <button className="btn-icon" onClick={() => qc.invalidateQueries({ queryKey: ['backups'] })} aria-label="Refresh"><RotateCw className={`size-4 ${list.isFetching ? 'animate-spin' : ''}`} /></button>
        </div>
        {list.isPending ? <Skeleton rows={4} /> : backups.length === 0 ? (
          <div className="card p-10 text-center text-sm text-faint">No backups stored.</div>
        ) : (
          <div className="card overflow-x-auto">
            <table className="w-full min-w-[640px]">
              <thead className="border-b border-line">
                <tr>
                  <th className="w-10 pl-4"><input type="checkbox" aria-label="Select all" checked={selected.size === backups.length} onChange={() => setSelected(selected.size === backups.length ? new Set() : new Set(backups.map((b) => b.key)))} /></th>
                  <th className="th">File</th>
                  <th className="th text-right w-24">Size</th>
                  <th className="th w-32">Backed up</th>
                  <th className="th w-32 hidden sm:table-cell">Auto-delete</th>
                  <th className="w-24" />
                </tr>
              </thead>
              <tbody>
                {backups.map((b) => (
                  <tr key={b.key} className="border-b border-line last:border-0 hover:bg-raised">
                    <td className="pl-4"><input type="checkbox" aria-label={`Select ${b.name}`} checked={selected.has(b.key)} onChange={() => setSelected((s) => { const n = new Set(s); if (n.has(b.key)) n.delete(b.key); else n.add(b.key); return n })} /></td>
                    <td className="td max-w-0 w-full">
                      <div className="flex items-center gap-2.5 min-w-0">
                        <FileKindIcon kind={kindOf(b.name, '')} />
                        <span className="min-w-0">
                          <span className="block truncate" title={b.name}>{b.name}</span>
                          <span className="block truncate text-xs text-faint">{folderOf(b.slug) || 'Top level'}</span>
                        </span>
                      </div>
                    </td>
                    <td className="td text-right text-muted tabular whitespace-nowrap">{formatBytes(b.size)}</td>
                    <td className="td text-muted whitespace-nowrap">{formatRelative(b.backedUpAt)}</td>
                    <td className="td text-muted whitespace-nowrap hidden sm:table-cell">{formatDate(b.expiresAt)}</td>
                    <td className="pr-2 text-right whitespace-nowrap">
                      <a className="btn-icon" href={backupDownloadUrl(b.key)} aria-label="Download backup" title="Download from R2"><Download className="size-4" /></a>
                      <button className="btn-icon" onClick={() => enqueue([{ slug: b.slug, name: b.name, size: b.size, folderPath: folderOf(b.slug) }])} aria-label="Back up again" title="Copy again from Filester"><RotateCw className="size-4" /></button>
                      <button className="btn-icon" onClick={() => remove([b.key])} aria-label="Delete backup" title="Delete backup"><Trash2 className="size-4" /></button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      </>}
    </div>
  )
}
