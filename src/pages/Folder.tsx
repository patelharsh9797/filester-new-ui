import { useMemo, useState } from 'react'
import { Link, useNavigate, useParams, useSearch } from '@tanstack/react-router'
import { ChevronRight, Copy, ExternalLink, FolderInput, FolderPlus, Globe, Home, Lock, Pencil, Search, Trash2, Upload, X } from 'lucide-react'
import { useLibrary } from '../lib/library'
import { searchItems } from '../lib/search'
import { folderUrl, formatBytes, formatDate } from '../lib/format'
import type { FileRow, FolderNode } from '../lib/types'
import { FileTable } from '../components/FileTable'
import { FolderIcon } from '../components/icons'
import { Highlight } from '../components/Highlight'
import { Menu } from '../components/Menu'
import { useShell } from '../components/Layout'
import { copyText, useActions } from '../state/actions'
import { useToast } from '../state/toast'
import { Skeleton } from './Overview'

export function FolderPage() {
  const { id } = useParams({ from: '/_app/folders/$id' })
  const search = useSearch({ from: '/_app/folders/$id' })
  const lib = useLibrary()
  const actions = useActions()
  const toast = useToast()
  const navigate = useNavigate({ from: '/folders/$id' })
  const { openUpload } = useShell()
  const [subQ, setSubQ] = useState('')
  const fileQ = search.fq ?? ''
  const deep = search.deep === '1'
  const highlight = search.file ?? null

  const isRoot = id === 'root'
  const folder = isRoot ? undefined : lib.byId.get(id)

  const subfolders = useMemo(() => {
    const list = isRoot ? lib.roots : (folder?.children.map((c) => lib.byId.get(c)!) ?? [])
    return subQ ? searchItems(list, subQ, (f) => f.name) : list
  }, [isRoot, lib.roots, lib.byId, folder, subQ])

  const files = useMemo(() => {
    let list: FileRow[]
    if (isRoot) list = deep ? lib.files : lib.rootFiles
    else if (!folder) list = []
    else if (!deep) list = lib.filesByFolder.get(folder.id) ?? []
    else {
      list = []
      const walk = (n: FolderNode) => { list.push(...(lib.filesByFolder.get(n.id) ?? [])); n.children.forEach((c) => walk(lib.byId.get(c)!)) }
      walk(folder)
    }
    return fileQ ? searchItems(list, fileQ, (f) => f.name, (f) => f.folderPath) : list
  }, [isRoot, folder, deep, fileQ, lib])

  const setParam = (k: 'fq' | 'deep', v: string | null) =>
    navigate({ search: (prev) => ({ ...prev, [k]: v || undefined, file: undefined }), replace: true })

  if (lib.foldersLoading) return <div className="max-w-6xl mx-auto p-6"><Skeleton rows={6} /></div>
  if (!isRoot && !folder) {
    return (
      <div className="max-w-6xl mx-auto p-6">
        <div className="card p-10 text-center">
          <p className="font-medium">Folder not found</p>
          <p className="text-sm text-muted mt-1">It may have been deleted or moved. <Link to="/folders" className="text-accent-ink underline">Browse all folders</Link></p>
        </div>
      </div>
    )
  }

  const crumbs = folder ? folder.pathIds.map((pid) => lib.byId.get(pid)!) : []

  return (
    <div className="max-w-6xl mx-auto p-4 sm:p-6 space-y-5">
      <nav className="flex items-center flex-wrap gap-1 text-sm text-muted" aria-label="Breadcrumb">
        <Link to="/folders" className="inline-flex items-center gap-1 hover:text-ink"><Home className="size-3.5" /> Folders</Link>
        {isRoot && <><ChevronRight className="size-3.5 text-faint" /><span className="text-ink">Top level</span></>}
        {crumbs.map((c, i) => (
          <span key={c.id} className="inline-flex items-center gap-1 min-w-0">
            <ChevronRight className="size-3.5 text-faint shrink-0" />
            {i === crumbs.length - 1 ? <span className="text-ink truncate max-w-[240px]">{c.name}</span>
              : <Link to="/folders/$id" params={{ id: c.id }} className="hover:text-ink truncate max-w-[180px]">{c.name}</Link>}
          </span>
        ))}
      </nav>

      <div className="flex flex-wrap items-start gap-3">
        <FolderIcon className="size-10 shrink-0" open />
        <div className="mr-auto min-w-0">
          <h1 className="text-2xl font-semibold tracking-tight break-words">{folder ? folder.name : 'Top level'}</h1>
          <p className="text-sm text-muted flex flex-wrap items-center gap-x-3 gap-y-1 mt-0.5">
            {folder && (folder.public ? <span className="inline-flex items-center gap-1"><Globe className="size-3.5" /> Public</span> : <span className="inline-flex items-center gap-1"><Lock className="size-3.5" /> Private</span>)}
            {folder ? <>
              <span>{folder.file_count} {folder.file_count === 1 ? 'file' : 'files'} here · {folder.totalFiles} total</span>
              <span>{folder.children.length} {folder.children.length === 1 ? 'subfolder' : 'subfolders'}{folder.totalFolders > folder.children.length ? ` (${folder.totalFolders} nested)` : ''}</span>
              <span>{formatBytes(folder.totalSize)}</span>
              <span>Created {formatDate(folder.created_at)}</span>
            </> : <span>{lib.rootFiles.length} unfiled files · {lib.roots.length} top-level folders</span>}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button className="btn" onClick={() => actions.newFolder(folder?.id ?? null)}><FolderPlus className="size-4" /> <span className="hidden sm:inline">New subfolder</span></button>
          <button className="btn-primary" onClick={() => openUpload(folder?.id ?? null)}><Upload className="size-4" /> Upload here</button>
          {folder && (
            <Menu label="Folder actions" items={[
              { label: 'Copy share link', icon: <Copy className="size-4" />, onClick: () => copyText(folderUrl(folder.id), toast), hidden: !folder.public },
              { label: 'Open on Filester', icon: <ExternalLink className="size-4" />, onClick: () => window.open(folderUrl(folder.id), '_blank', 'noreferrer') },
              'sep',
              { label: 'Edit…', icon: <Pencil className="size-4" />, onClick: () => actions.editFolder(folder) },
              { label: 'Move to…', icon: <FolderInput className="size-4" />, onClick: () => actions.moveFolders([folder]) },
              'sep',
              { label: 'Delete folder', icon: <Trash2 className="size-4" />, danger: true, onClick: () => actions.deleteFolders([folder], () => folder.parent ? navigate({ to: '/folders/$id', params: { id: folder.parent } }) : navigate({ to: '/folders' })) },
            ]} />
          )}
        </div>
      </div>

      {(subfolders.length > 0 || subQ) && (
        <section className="space-y-2.5">
          <div className="flex items-center gap-3">
            <h2 className="font-semibold">{isRoot ? 'Top-level folders' : 'Subfolders'} <span className="text-faint font-normal text-sm">{isRoot ? lib.roots.length : folder!.children.length}</span></h2>
            {((isRoot ? lib.roots.length : folder!.children.length) > 6) && (
              <div className="relative ml-auto w-56">
                <Search className="size-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-faint" />
                <input className="input h-8 pl-8 text-xs" placeholder="Filter subfolders…" value={subQ} onChange={(e) => setSubQ(e.target.value)} />
              </div>
            )}
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-2.5">
            {subfolders.map((f) => (
              <div key={f.id} className="card flex items-center gap-1 pr-1 hover:border-faint/40 transition-colors">
                <Link to="/folders/$id" params={{ id: f.id }} className="flex-1 min-w-0 flex items-center gap-3 p-3">
                  <FolderIcon className="size-8 shrink-0" />
                  <span className="min-w-0">
                    <span className="block text-sm font-medium truncate" title={f.name}><Highlight text={f.name} query={subQ} /></span>
                    <span className="block text-xs text-faint truncate">{f.totalFiles} files{f.children.length ? ` · ${f.children.length} folders` : ''} · {formatBytes(f.totalSize)}</span>
                  </span>
                  {!f.public && <Lock className="size-3 text-faint shrink-0" />}
                </Link>
                <Menu items={[
                  { label: 'Edit…', icon: <Pencil className="size-4" />, onClick: () => actions.editFolder(f) },
                  { label: 'Move to…', icon: <FolderInput className="size-4" />, onClick: () => actions.moveFolders([f]) },
                  { label: 'Delete', icon: <Trash2 className="size-4" />, danger: true, onClick: () => actions.deleteFolders([f]) },
                ]} />
              </div>
            ))}
            {subfolders.length === 0 && <p className="text-sm text-faint">No subfolders match “{subQ}”.</p>}
          </div>
        </section>
      )}

      <section className="space-y-2.5">
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="font-semibold">{isRoot ? (deep ? 'All files' : 'Unfiled files') : 'Files'} <span className="text-faint font-normal text-sm">{files.length}</span></h2>
          <label className="flex items-center gap-1.5 text-sm text-muted cursor-pointer">
            <input type="checkbox" checked={deep} onChange={(e) => setParam('deep', e.target.checked ? '1' : null)} />
            Include subfolders
          </label>
          <div className="relative ml-auto w-full sm:w-64">
            <Search className="size-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-faint" />
            <input className="input h-8 pl-8 pr-8 text-xs" placeholder={deep ? 'Search files in this tree…' : 'Search files in this folder…'} value={fileQ} onChange={(e) => setParam('fq', e.target.value)} />
            {fileQ && <button className="absolute right-1.5 top-1/2 -translate-y-1/2 btn-icon size-6" onClick={() => setParam('fq', null)} aria-label="Clear"><X className="size-3" /></button>}
          </div>
        </div>
        {lib.filesLoading ? <Skeleton rows={5} /> : (
          <FileTable files={files} showFolder={deep} query={fileQ} highlight={highlight} sorted={!!fileQ} defaultSort="name"
            empty={fileQ ? `No files match “${fileQ}”.` : <>This folder has no files. <button className="text-accent-ink underline" onClick={() => openUpload(folder?.id ?? null)}>Upload some</button> or drop them anywhere on the page.</>} />
        )}
      </section>
    </div>
  )
}
