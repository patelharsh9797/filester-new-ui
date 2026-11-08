import { useMemo, useState } from 'react'
import { Link, useNavigate, useSearch } from '@tanstack/react-router'
import { AlertTriangle, Check, Copy, DatabaseBackup, Download, ExternalLink, FolderInput, Info, Loader2, Search, Trash2, X } from 'lucide-react'
import { LEVELS, RULES, useExpiring, useExpiryRule, type ExpiringFile, type ExpiryRule } from '../lib/expiry'
import { searchItems } from '../lib/search'
import { formatBytes, formatDate, formatRelative } from '../lib/format'
import { ExpiryBadge } from '../components/ExpiryBadge'
import { FileKindIcon, FolderIcon } from '../components/icons'
import { Highlight } from '../components/Highlight'
import { Menu } from '../components/Menu'
import { FileInfoDialog } from '../components/FileInfo'
import { copyText, useActions } from '../state/actions'
import { useOpenDialog } from '../state/dialogs'
import { useToast } from '../state/toast'
import { useBackupList, useBackups, type BackupJob } from '../state/backups'
import { backupDownloadUrl, type BackupInfo } from '../lib/backup'
import { Skeleton } from './Overview'

const WINDOWS = { '3': 3, '7': 7, '14': 14, '30': 30, all: Infinity } as const
type Win = keyof typeof WINDOWS

export function ExpiringPage() {
  const params = useSearch({ from: '/_app/expiring' })
  const navigate = useNavigate({ from: '/expiring' })
  const exp = useExpiring()
  const [rule, setRule] = useExpiryRule()
  const actions = useActions()
  const toast = useToast()
  const openDialog = useOpenDialog()
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const { jobs, enqueue } = useBackups()
  const backupList = useBackupList()
  const backedUp = useMemo(() => new Map((backupList.data?.backups ?? []).map((b) => [b.slug, b])), [backupList.data])
  const backup = (files: ExpiringFile[]) => {
    const space = backupList.data ? backupList.data.limit - backupList.data.used : Infinity
    const need = files.reduce((n, f) => n + f.size, 0)
    if (need > space) toast('info', `Selected files need ${formatBytes(need)} but only ${formatBytes(Math.max(0, space))} of backup space is free — some will be refused.`)
    enqueue(files)
    toast('success', `Backing up ${files.length} file${files.length === 1 ? '' : 's'} — keep this tab open`)
  }

  const win: Win = params.within && params.within in WINDOWS ? (params.within as Win) : '14'
  const q = params.q ?? ''
  const set = (k: 'within' | 'q', v: string | null) => navigate({ search: (p) => ({ ...p, [k]: v || undefined }), replace: true })

  const rows = useMemo(() => {
    const inWindow = exp.files.filter((f) => f.daysLeft <= WINDOWS[win])
    return q ? searchItems(inWindow, q, (f) => f.name, (f) => f.folderPath) : inWindow
  }, [exp.files, win, q])

  const sel = rows.filter((r) => selected.has(r.id))
  const clear = () => setSelected(new Set())
  const toggle = (id: number) => setSelected((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n })
  const atRiskSize = rows.reduce((n, f) => n + f.size, 0)

  const card = (label: string, n: number, sub: string, w: Win, tone: string) => (
    <button onClick={() => set('within', w === '14' ? null : w)}
      className={`card p-4 text-left transition-colors ${win === w ? 'border-accent' : 'hover:border-faint/40'}`}>
      <div className="text-xs text-muted">{label}</div>
      <div className={`text-2xl font-semibold mt-1 tabular ${n ? tone : ''}`}>{exp.loading ? '…' : n}</div>
      <div className="text-xs text-faint mt-0.5">{sub}</div>
    </button>
  )

  return (
    <div className="max-w-6xl mx-auto p-4 sm:p-6 space-y-5">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Expiring soon</h1>
        <p className="text-sm text-muted max-w-3xl">
          Filester deletes files that go unused for a while. This page estimates when each file will hit that limit, so you can download or back up
          anything you want to keep before it's gone.
        </p>
      </div>

      <div className="card p-3 flex flex-wrap items-center gap-2 text-sm">
        <span className="text-muted mr-1">Count from:</span>
        {(Object.keys(RULES) as ExpiryRule[]).map((r) => (
          <button key={r} className={rule === r ? 'chip-active' : 'chip'} onClick={() => setRule(r)} title={RULES[r].detail}>{RULES[r].label}</button>
        ))}
        <span className="text-xs text-faint basis-full sm:basis-auto sm:ml-auto">Filester's FAQ and API docs disagree; the FAQ rule is stricter.</span>
      </div>

      {exp.activityError && (
        <p className="flex gap-2 text-sm bg-accent-soft text-accent-ink rounded-lg px-3 py-2">
          <AlertTriangle className="size-4 shrink-0 mt-0.5" />
          Couldn't load last-download dates from Filester ({exp.activityError.message}). Estimates below use upload dates, so files that were downloaded recently may look more at risk than they are.
        </p>
      )}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {card('Within 3 days', exp.counts.critical, 'deleted very soon', '3', 'text-danger')}
        {card('Within 7 days', exp.counts.critical + exp.counts.soon, 'needs attention', '7', 'text-accent-ink')}
        {card('Within 14 days', exp.counts.critical + exp.counts.soon + exp.counts.watch, 'keep an eye on', '14', '')}
        {card('All files', exp.files.length, 'sorted by time left', 'all', '')}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[220px]">
          <Search className="size-4 absolute left-3 top-1/2 -translate-y-1/2 text-faint" />
          <input className="input pl-9 pr-9" placeholder="Search these files…" value={q} onChange={(e) => set('q', e.target.value)} />
          {q && <button className="absolute right-2 top-1/2 -translate-y-1/2 btn-icon size-6" onClick={() => set('q', null)} aria-label="Clear"><X className="size-3.5" /></button>}
        </div>
        <select className="input w-auto" value={win} onChange={(e) => set('within', e.target.value === '14' ? null : e.target.value)}>
          <option value="3">Next 3 days</option>
          <option value="7">Next 7 days</option>
          <option value="14">Next 14 days</option>
          <option value="30">Next 30 days</option>
          <option value="all">All files</option>
        </select>
        <span className="text-xs text-faint">{rows.length} files · {formatBytes(atRiskSize)}</span>
      </div>

      {exp.loading ? <Skeleton rows={6} /> : rows.length === 0 ? (
        <div className="card p-10 text-center">
          <p className="font-medium">Nothing expiring in this window</p>
          <p className="text-sm text-muted mt-1">
            {win === 'all' ? 'No files yet.' : <>No files reach the limit in the next {WINDOWS[win]} days. <button className="text-accent-ink underline" onClick={() => set('within', '30')}>Look further ahead</button></>}
          </p>
        </div>
      ) : (
        <div className="card overflow-hidden">
          {selected.size > 0 && (
            <div className="flex flex-wrap items-center gap-2 px-3 py-2 bg-accent-soft border-b border-line text-sm">
              <button className="btn-icon" onClick={clear} aria-label="Clear selection"><X className="size-4" /></button>
              <span className="font-medium text-accent-ink mr-auto">{sel.length} selected · {formatBytes(sel.reduce((n, f) => n + f.size, 0))}</span>
              <button className="btn h-8" onClick={() => { backup(sel); clear() }}><DatabaseBackup className="size-4" /> Back up to R2</button>
              <button className="btn h-8" onClick={() => copyText(sel.map((f) => f.url).join('\n'), toast, 'Links')}><Copy className="size-4" /> Copy links</button>
              <button className="btn h-8" onClick={() => actions.moveFiles(sel, clear)}><FolderInput className="size-4" /> Move</button>
              <button className="btn h-8 text-danger" onClick={() => actions.deleteFiles(sel, clear)}><Trash2 className="size-4" /> Delete</button>
            </div>
          )}
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px]">
              <thead className="border-b border-line">
                <tr>
                  <th className="w-10 pl-4"><input type="checkbox" aria-label="Select all" checked={selected.size > 0 && sel.length === rows.length} onChange={() => setSelected(sel.length === rows.length ? new Set() : new Set(rows.map((r) => r.id)))} /></th>
                  <th className="th">File</th>
                  <th className="th text-right w-24">Size</th>
                  <th className="th w-32 hidden md:table-cell">Last download</th>
                  <th className="th w-32 hidden lg:table-cell">Last view</th>
                  <th className="th w-36">Deleted around</th>
                  <th className="w-12" />
                </tr>
              </thead>
              <tbody>
                {rows.map((f) => <Row key={f.id} f={f} q={q} selected={selected.has(f.id)} onToggle={() => toggle(f.id)}
                  job={jobs.get(f.slug)} stored={backedUp.get(f.slug)}
                  onInfo={() => openDialog((close) => <FileInfoDialog file={f} onClose={close} />)}
                  menu={[
                    { label: 'Details', icon: <Info className="size-4" />, onClick: () => openDialog((close) => <FileInfoDialog file={f} onClose={close} />) },
                    { label: 'Open on Filester', icon: <ExternalLink className="size-4" />, onClick: () => window.open(f.url, '_blank', 'noreferrer') },
                    { label: 'Copy link', icon: <Copy className="size-4" />, onClick: () => copyText(f.url, toast) },
                    { label: backedUp.has(f.slug) ? 'Back up again' : 'Back up to R2', icon: <DatabaseBackup className="size-4" />, onClick: () => backup([f]) },
                    'sep',
                    { label: 'Move to…', icon: <FolderInput className="size-4" />, onClick: () => actions.moveFiles([f]) },
                    { label: 'Delete', icon: <Trash2 className="size-4" />, danger: true, onClick: () => actions.deleteFiles([f]) },
                  ]} />)}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <p className="text-xs text-faint">
        Dates come from Filester's own records and are estimates — Filester doesn't publish exactly when its cleanup runs.
        Thresholds: red ≤ {LEVELS.critical} days, amber ≤ {LEVELS.soon} days, grey ≤ {LEVELS.watch} days.
      </p>
    </div>
  )
}

function BackupState({ job, stored }: { job?: BackupJob; stored?: BackupInfo }) {
  if (job && (job.status === 'queued' || job.status === 'running')) {
    const p = job.size ? Math.round((job.copied / job.size) * 100) : 0
    return <span className="inline-flex items-center gap-1 text-[11px] text-muted"><Loader2 className="size-3 animate-spin" />{job.status === 'queued' ? 'Queued' : `Backing up ${p}%`}</span>
  }
  if (job?.status === 'error') return <span className="text-[11px] text-danger" title={job.error}>Backup failed</span>
  if (stored) return <a href={backupDownloadUrl(stored.key)} className="inline-flex items-center gap-1 text-[11px] text-ok hover:underline" title="Download the R2 backup"><Check className="size-3" />Backed up<Download className="size-3" /></a>
  return null
}

function Row({ f, q, selected, onToggle, onInfo, menu, job, stored }: {
  f: ExpiringFile; q: string; selected: boolean; onToggle: () => void; onInfo: () => void; menu: Parameters<typeof Menu>[0]['items']
  job?: BackupJob; stored?: BackupInfo
}) {
  const a = f.activity
  return (
    <tr className={`border-b border-line last:border-0 ${selected ? 'bg-accent-soft/50' : 'hover:bg-raised'}`}>
      <td className="pl-4"><input type="checkbox" aria-label={`Select ${f.name}`} checked={selected} onChange={onToggle} /></td>
      <td className="td max-w-0 w-full">
        <button className="flex items-center gap-2.5 min-w-0 max-w-full text-left" onClick={onInfo}>
          <FileKindIcon kind={f.kind} />
          <span className="min-w-0">
            <span className="block truncate hover:underline" title={f.name}><Highlight text={f.name} query={q} /></span>
            <span className="block truncate text-xs text-faint">{f.folderPath || 'Top level'}</span>
          </span>
        </button>
      </td>
      <td className="td text-right text-muted tabular whitespace-nowrap">{formatBytes(f.size)}</td>
      <td className="td text-muted whitespace-nowrap hidden md:table-cell" title={a?.lastDownloaded}>{a ? formatRelative(a.lastDownloaded) : '—'}</td>
      <td className="td text-muted whitespace-nowrap hidden lg:table-cell" title={a?.lastViewed}>{a ? formatRelative(a.lastViewed) : '—'}</td>
      <td className="td whitespace-nowrap">
        <div className="flex flex-col items-start gap-0.5">
          <ExpiryBadge daysLeft={f.daysLeft} level={f.level} />
          <span className="text-[11px] text-faint">{formatDate(f.expiresAt)}</span>
          <BackupState job={job} stored={stored} />
        </div>
      </td>
      <td className="pr-2 text-right">
        {f.folder_id
          ? <span className="inline-flex"><Link to="/folders/$id" params={{ id: f.folder_id }} search={{ file: f.slug }} className="btn-icon" aria-label="Show in folder" title="Show in folder"><FolderIcon className="size-4" /></Link><Menu items={menu} /></span>
          : <Menu items={menu} />}
      </td>
    </tr>
  )
}
