import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { ArrowRight, FolderPlus, Search, Upload } from 'lucide-react'
import { useAccount, useLibrary } from '../lib/library'
import { formatBytes, formatRelative, KIND_LABELS } from '../lib/format'
import { useShell } from '../components/Layout'
import { useActions } from '../state/actions'
import { FileTable } from '../components/FileTable'
import { FileKindIcon, FolderIcon } from '../components/icons'
import type { FileKind } from '../lib/types'

export function OverviewPage() {
  const lib = useLibrary()
  const account = useAccount()
  const { openSearch, openUpload } = useShell()
  const actions = useActions()

  const recent = useMemo(() => [...lib.files].sort((a, b) => b.created_at.localeCompare(a.created_at) || b.id - a.id).slice(0, 8), [lib.files])
  const recentFolders = useMemo(() => [...lib.folders].sort((a, b) => b.lastActivity.localeCompare(a.lastActivity)).slice(0, 6), [lib.folders])
  const biggestFolders = useMemo(() => lib.roots.filter((f) => f.totalSize > 0).sort((a, b) => b.totalSize - a.totalSize).slice(0, 6), [lib.roots])
  const byKind = useMemo(() => {
    const m = new Map<FileKind, { n: number; size: number }>()
    for (const f of lib.files) { const e = m.get(f.kind) ?? { n: 0, size: 0 }; e.n++; e.size += f.size; m.set(f.kind, e) }
    return [...m.entries()].sort((a, b) => b[1].size - a[1].size)
  }, [lib.files])
  const totalSize = lib.files.reduce((n, f) => n + f.size, 0)
  const acct = account.data

  const stat = (label: string, value: React.ReactNode, sub?: React.ReactNode, to?: string) => {
    const body = (<><div className="text-xs text-muted">{label}</div><div className="text-2xl font-semibold mt-1 tabular">{value}</div>{sub && <div className="text-xs text-faint mt-0.5">{sub}</div>}</>)
    return to ? <Link to={to} className="card p-4 hover:border-faint/40 transition-colors">{body}</Link> : <div className="card p-4">{body}</div>
  }

  return (
    <div className="max-w-6xl mx-auto p-4 sm:p-6 space-y-6">
      <div className="flex flex-wrap items-end gap-3">
        <div className="mr-auto">
          <h1 className="text-2xl font-semibold tracking-tight">Overview</h1>
          <p className="text-sm text-muted">Everything in your Filester account at a glance.</p>
        </div>
        <button className="btn" onClick={() => openSearch('folders')}><Search className="size-4" /> Find a folder</button>
        <button className="btn" onClick={() => actions.newFolder(null)}><FolderPlus className="size-4" /> New folder</button>
        <button className="btn-primary" onClick={() => openUpload(null)}><Upload className="size-4" /> Upload</button>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {stat('Storage used', acct ? formatBytes(acct.storage_used) : '…', acct ? `of ${formatBytes(acct.storage_limit, 0)} · ${((acct.storage_used / acct.storage_limit) * 100).toFixed(1)}%` : undefined)}
        {stat('Folders', lib.foldersLoading ? '…' : lib.folders.length.toLocaleString(), `${lib.roots.length} top-level`, '/folders')}
        {stat('Files', lib.filesLoading ? '…' : lib.files.length.toLocaleString(), lib.filesLoading ? undefined : `${formatBytes(totalSize)} total`, '/files')}
        {stat('Unfiled files', lib.filesLoading ? '…' : lib.rootFiles.length.toLocaleString(), 'not in any folder', '/folders/root')}
      </div>

      <div className="grid lg:grid-cols-3 gap-6">
        <section className="lg:col-span-2 space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold">Recent uploads</h2>
            <Link to="/files" className="text-sm text-muted hover:text-ink inline-flex items-center gap-1">All files <ArrowRight className="size-3.5" /></Link>
          </div>
          {lib.filesLoading ? <Skeleton rows={5} /> : <FileTable files={recent} sorted empty="No files yet — drop some anywhere on this page to upload." />}
        </section>

        <section className="space-y-3">
          <h2 className="font-semibold">Recently active folders</h2>
          <div className="card divide-y divide-line">
            {lib.foldersLoading ? <div className="p-3"><Skeleton rows={4} /></div>
              : recentFolders.length === 0 ? <p className="p-4 text-sm text-faint">No folders yet.</p>
              : recentFolders.map((f) => (
                <Link key={f.id} to={`/folders/${f.id}`} className="flex items-center gap-3 px-3 py-2.5 hover:bg-raised">
                  <FolderIcon className="size-5 shrink-0" />
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm truncate">{f.name}</span>
                    <span className="block text-xs text-faint truncate">{f.path.length > 1 ? f.path.slice(0, -1).join(' / ') : 'Top level'}</span>
                  </span>
                  <span className="text-xs text-faint whitespace-nowrap">{formatRelative(f.lastActivity)}</span>
                </Link>
              ))}
          </div>

          {biggestFolders.length > 0 && (
            <>
              <h2 className="font-semibold pt-2">Largest folders</h2>
              <div className="card p-3 space-y-2.5">
                {biggestFolders.map((f) => (
                  <Link key={f.id} to={`/folders/${f.id}`} className="block group">
                    <div className="flex justify-between text-sm"><span className="truncate group-hover:underline">{f.name}</span><span className="text-faint tabular text-xs">{formatBytes(f.totalSize)}</span></div>
                    <div className="h-1.5 mt-1 rounded-full bg-raised overflow-hidden"><div className="h-full bg-folder" style={{ width: `${(f.totalSize / biggestFolders[0].totalSize) * 100}%` }} /></div>
                  </Link>
                ))}
              </div>
            </>
          )}

          {byKind.length > 0 && (
            <>
              <h2 className="font-semibold pt-2">By type</h2>
              <div className="card divide-y divide-line">
                {byKind.map(([kind, v]) => (
                  <Link key={kind} to={`/files?kind=${kind}`} className="flex items-center gap-2.5 px-3 py-2 text-sm hover:bg-raised">
                    <FileKindIcon kind={kind} /><span className="flex-1">{KIND_LABELS[kind]}</span>
                    <span className="text-xs text-faint tabular">{v.n} · {formatBytes(v.size)}</span>
                  </Link>
                ))}
              </div>
            </>
          )}
        </section>
      </div>
    </div>
  )
}

export function Skeleton({ rows = 3 }: { rows?: number }) {
  return <div className="space-y-2">{Array.from({ length: rows }, (_, i) => <div key={i} className="h-9 rounded-lg bg-raised animate-pulse" />)}</div>
}
