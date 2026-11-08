import { useMemo, useState } from 'react'
import { Link } from '@tanstack/react-router'
import { Check, ChevronDown, ChevronUp, DatabaseBackup, Loader2, RotateCw, X } from 'lucide-react'
import { useBackups, type BackupJob, type BackupStatus } from '../state/backups'
import { formatBytes, kindOf } from '../lib/format'
import { FileKindIcon } from './icons'

type Tab = 'active' | 'failed' | 'done'

function duration(sec: number) {
  if (sec < 60) return `${Math.max(1, Math.round(sec))}s`
  if (sec < 3600) return `${Math.round(sec / 60)} min`
  return `${Math.floor(sec / 3600)}h ${Math.round((sec % 3600) / 60)}m`
}

/** Floating panel showing the backup queue. Shown on every page while there are jobs. */
export function BackupDock() {
  const { jobs, stats, cancel, cancelAll, retryFailed, clearFinished } = useBackups()
  const [collapsed, setCollapsed] = useState(false)
  const [tab, setTab] = useState<Tab>('active')

  const groups = useMemo(() => {
    const all = [...jobs.values()].sort((a, b) => a.seq - b.seq)
    const by = (...s: BackupStatus[]) => all.filter((j) => s.includes(j.status))
    return {
      active: [...by('running'), ...by('queued')],
      failed: by('error', 'cancelled'),
      done: by('done').sort((a, b) => (b.finishedAt ?? 0) - (a.finishedAt ?? 0)),
    }
  }, [jobs])

  if (!jobs.size) return null
  const pct = stats.bytesTotal ? Math.min(100, (stats.bytesDone / stats.bytesTotal) * 100) : 0
  const finished = stats.done + stats.failed
  const list = groups[tab]

  return (
    <div className="card shadow-2xl overflow-hidden">
      <div className="px-3 pt-2.5 pb-2 border-b border-line">
        <div className="flex items-center gap-2">
          {stats.active ? <Loader2 className="size-4 animate-spin text-accent" /> : <DatabaseBackup className="size-4 text-muted" />}
          <span className="text-sm font-medium flex-1 truncate">
            {stats.active ? `Backing up · ${finished} of ${stats.total} finished` : `Backups finished · ${stats.done} of ${stats.total} saved`}
          </span>
          <Link to="/backups" className="text-xs text-muted hover:text-ink">Open</Link>
          <button className="btn-icon size-7" onClick={() => setCollapsed((c) => !c)} aria-label={collapsed ? 'Expand' : 'Collapse'}>{collapsed ? <ChevronUp className="size-4" /> : <ChevronDown className="size-4" />}</button>
          {!stats.active && <button className="btn-icon size-7" onClick={clearFinished} aria-label="Close"><X className="size-4" /></button>}
        </div>
        <div className="mt-2 h-2 rounded-full bg-raised overflow-hidden">
          <div className={`h-full transition-[width] ${stats.failed ? 'bg-accent' : 'bg-ok'}`} style={{ width: `${pct}%` }} />
        </div>
        <div className="mt-1 flex flex-wrap gap-x-3 text-[11px] text-faint tabular">
          <span>{formatBytes(stats.bytesDone)} / {formatBytes(stats.bytesTotal)}</span>
          {stats.active && stats.speed > 0 && <span>{formatBytes(stats.speed)}/s</span>}
          {stats.active && stats.eta !== null && <span>~{duration(stats.eta)} left</span>}
          <span className="text-ok">{stats.done} done</span>
          {stats.failed > 0 && <span className="text-danger">{stats.failed} failed</span>}
          {stats.queued > 0 && <span>{stats.queued} waiting</span>}
        </div>
      </div>

      {!collapsed && (
        <>
          <div className="flex items-center gap-1 px-2 py-1.5 border-b border-line text-xs">
            {(['active', 'failed', 'done'] as Tab[]).map((t) => (
              <button key={t} onClick={() => setTab(t)} className={`px-2 h-6 rounded-md ${tab === t ? 'bg-hover text-ink font-medium' : 'text-muted hover:text-ink'}`}>
                {t === 'active' ? `In progress ${groups.active.length}` : t === 'failed' ? `Failed ${groups.failed.length}` : `Done ${groups.done.length}`}
              </button>
            ))}
            <span className="ml-auto flex gap-1">
              {tab === 'failed' && groups.failed.length > 0 && <button className="inline-flex items-center gap-1 px-2 h-6 rounded-md text-muted hover:text-ink hover:bg-hover" onClick={retryFailed}><RotateCw className="size-3" /> Retry all</button>}
              {tab === 'active' && stats.active && <button className="px-2 h-6 rounded-md text-danger hover:bg-hover" onClick={cancelAll}>Cancel all</button>}
            </span>
          </div>
          <ul className="max-h-64 overflow-y-auto divide-y divide-line">
            {list.length === 0 && <li className="px-3 py-4 text-xs text-faint text-center">Nothing here.</li>}
            {list.slice(0, 200).map((j) => <JobRow key={j.slug} j={j} onCancel={() => cancel(j.slug)} />)}
            {list.length > 200 && <li className="px-3 py-2 text-xs text-faint">+ {list.length - 200} more</li>}
          </ul>
          {stats.active
            ? <p className="px-3 py-1.5 border-t border-line text-[11px] text-faint">Keep this tab open until the queue finishes.</p>
            : stats.done > 0 && <p className="px-3 py-1.5 border-t border-line text-[11px] text-faint">Filester updates "last download" dates a few minutes later; the Expiring list re-checks automatically.</p>}
        </>
      )}
    </div>
  )
}

function JobRow({ j, onCancel }: { j: BackupJob; onCancel: () => void }) {
  const pct = j.size ? Math.round((j.copied / j.size) * 100) : 0
  return (
    <li className="px-3 py-2">
      <div className="flex items-center gap-2 text-sm">
        <FileKindIcon kind={kindOf(j.name, j.type)} />
        <span className="truncate flex-1" title={`${j.folder ? j.folder + ' / ' : ''}${j.name}`}>{j.name}</span>
        <span className="text-[11px] text-faint tabular whitespace-nowrap">
          {j.status === 'running' ? `${pct}%` : j.status === 'queued' ? 'waiting' : formatBytes(j.size)}
        </span>
        {j.status === 'done' && <Check className="size-3.5 text-ok" />}
        {(j.status === 'running' || j.status === 'queued') && <button className="btn-icon size-6" onClick={onCancel} aria-label={`Cancel ${j.name}`}><X className="size-3.5" /></button>}
      </div>
      {j.status === 'running' && <div className="mt-1 h-1 rounded-full bg-raised overflow-hidden"><div className="h-full bg-accent transition-[width]" style={{ width: `${pct}%` }} /></div>}
      {j.status === 'error' && <div className="text-[11px] text-danger mt-0.5 break-words">{j.error}</div>}
      {j.status === 'cancelled' && <div className="text-[11px] text-faint mt-0.5">Cancelled</div>}
    </li>
  )
}
