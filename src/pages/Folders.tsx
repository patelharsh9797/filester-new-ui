import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useSearch } from '@tanstack/react-router'
import { ArrowDown, ArrowUp, ChevronRight, Copy, ExternalLink, EyeOff, FolderInput, FolderPlus, Globe, KeyRound, List, ListTree, Lock, Pencil, Search, Trash2, X } from 'lucide-react'
import { useLibrary } from '../lib/library'
import { useQuery } from '@tanstack/react-query'
import { getFolderFlags } from '../lib/api'
import { normalize, score } from '../lib/search'
import { folderUrl, formatBytes, formatDate, formatRelative } from '../lib/format'
import type { FolderNode } from '../lib/types'
import { FolderIcon } from '../components/icons'
import { Highlight } from '../components/Highlight'
import { Menu } from '../components/Menu'
import { copyText, useActions } from '../state/actions'
import { useToast } from '../state/toast'
import { Skeleton } from './Overview'

type SortKey = 'relevance' | 'path' | 'name' | 'files' | 'size' | 'created' | 'activity'
type Vis = 'all' | 'public' | 'private'
type Show = 'all' | 'top' | 'empty' | 'nonempty'

export function FoldersPage() {
  const lib = useLibrary()
  const actions = useActions()
  const toast = useToast()
  const params = useSearch({ from: '/_app/folders/' })
  const navigate = useNavigate({ from: '/folders/' })
  const q = params.q ?? ''
  const vis = (params.vis as Vis) || 'all'
  const show = (params.show as Show) || 'all'
  const view = params.view === 'tree' ? 'tree' : 'list'
  const hr = params.hr === 'on' || params.hr === 'off' ? params.hr : null
  const sortParam = (params.sort as SortKey | undefined) ?? null
  const dir = params.dir === 'asc' ? 1 : params.dir === 'desc' ? -1 : null
  const sort: SortKey = sortParam ?? (q ? 'relevance' : 'path')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const inputRef = useRef<HTMLInputElement>(null)
  const flagsQ = useQuery({ queryKey: ['folder-flags'], queryFn: getFolderFlags, staleTime: 5 * 60_000 })
  const flags = flagsQ.data

  type Key = 'q' | 'vis' | 'show' | 'view' | 'sort' | 'dir' | 'hr'
  const set = (k: Key, v: string | null) => navigate({
    search: (prev) => ({ ...prev, [k]: v || undefined, ...(k === 'q' ? { sort: undefined, dir: undefined } : {}) }),
    replace: true,
  })
  const clearAll = () => navigate({ search: {}, replace: true })

  // Focus search with "f"
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement
      if (e.key === 'f' && !e.metaKey && !e.ctrlKey && t.tagName !== 'INPUT' && t.tagName !== 'TEXTAREA') { e.preventDefault(); inputRef.current?.focus() }
    }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [])

  const { matches, scores } = useMemo(() => {
    const nq = normalize(q)
    const scores = new Map<string, number>()
    const matches = lib.folders.filter((f) => {
      if (vis === 'public' && !f.public) return false
      if (vis === 'private' && f.public) return false
      if (show === 'top' && f.parent) return false
      if (show === 'empty' && (f.totalFiles > 0 || f.children.length > 0)) return false
      if (show === 'nonempty' && f.totalFiles === 0) return false
      if (hr && flags && (flags.get(f.id)?.hideRelated ?? false) !== (hr === 'on')) return false
      if (!nq) return true
      const s = score(nq, f.name, f.pathText)
      if (s > 0) scores.set(f.id, s)
      return s > 0
    })
    return { matches, scores }
  }, [lib.folders, q, vis, show, hr, flags])

  const sorted = useMemo(() => {
    const d = dir ?? (sort === 'name' || sort === 'path' ? 1 : -1)
    const cmp: Record<SortKey, (a: FolderNode, b: FolderNode) => number> = {
      relevance: (a, b) => (scores.get(a.id)! - scores.get(b.id)!),
      path: (a, b) => a.pathText.localeCompare(b.pathText, undefined, { numeric: true }),
      name: (a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }),
      files: (a, b) => a.totalFiles - b.totalFiles,
      size: (a, b) => a.totalSize - b.totalSize,
      created: (a, b) => a.created_at.localeCompare(b.created_at),
      activity: (a, b) => a.lastActivity.localeCompare(b.lastActivity),
    }
    return [...matches].sort((a, b) => cmp[sort](a, b) * d || a.pathText.localeCompare(b.pathText))
  }, [matches, sort, dir, scores])

  const selectedFolders = sorted.filter((f) => selected.has(f.id))
  const clear = () => setSelected(new Set())
  const toggle = (id: string) => setSelected((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n })

  const header = (key: SortKey, label: string, className = '') => (
    <th className={`th ${className}`}>
      <button className="inline-flex items-center gap-1 hover:text-ink uppercase" onClick={() => {
        const defDir = key === 'name' || key === 'path' ? 1 : -1
        const nextDir = sort === key ? -(dir ?? defDir) : defDir
        navigate({ search: (prev) => ({ ...prev, sort: key, dir: nextDir === 1 ? 'asc' : 'desc' }), replace: true })
      }}>
        {label}{sort === key && ((dir ?? (key === 'name' || key === 'path' ? 1 : -1)) === 1 ? <ArrowUp className="size-3" /> : <ArrowDown className="size-3" />)}
      </button>
    </th>
  )

  const menuFor = (f: FolderNode) => [
    { label: 'New subfolder', icon: <FolderPlus className="size-4" />, onClick: () => actions.newFolder(f.id) },
    { label: 'Copy share link', icon: <Copy className="size-4" />, onClick: () => copyText(folderUrl(f.id), toast), hidden: !f.public },
    { label: 'Open on Filester', icon: <ExternalLink className="size-4" />, onClick: () => window.open(folderUrl(f.id), '_blank', 'noreferrer') },
    'sep' as const,
    { label: 'Edit…', icon: <Pencil className="size-4" />, onClick: () => actions.editFolder(f) },
    { label: 'Move to…', icon: <FolderInput className="size-4" />, onClick: () => actions.moveFolders([f]) },
    'sep' as const,
    { label: 'Delete', icon: <Trash2 className="size-4" />, danger: true, onClick: () => actions.deleteFolders([f]) },
  ]

  const chip = (k: Key, v: string, label: React.ReactNode, cur: string) => (
    <button className={cur === v ? 'chip-active' : 'chip'} onClick={() => set(k, v === 'all' ? null : v)}>{label}</button>
  )

  return (
    <div className="max-w-6xl mx-auto p-4 sm:p-6 space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="mr-auto">
          <h1 className="text-2xl font-semibold tracking-tight">Folders</h1>
          <p className="text-sm text-muted">{lib.folders.length} folders · search by name or any part of the path.</p>
        </div>
        <button className="btn-primary" onClick={() => actions.newFolder(null)}><FolderPlus className="size-4" /> New folder</button>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[220px]">
          <Search className="size-4 absolute left-3 top-1/2 -translate-y-1/2 text-faint" />
          <input ref={inputRef} className="input pl-9 pr-16" placeholder="Search folders…  e.g. “sci fi” or “movies classics”" value={q} onChange={(e) => set('q', e.target.value)} />
          {q ? <button className="absolute right-2 top-1/2 -translate-y-1/2 btn-icon size-6" onClick={() => set('q', null)} aria-label="Clear"><X className="size-3.5" /></button>
            : <kbd className="absolute right-3 top-1/2 -translate-y-1/2 text-[11px] text-faint border border-line rounded px-1.5">F</kbd>}
        </div>
        <div className="flex rounded-lg border border-line p-0.5 bg-panel">
          <button className={`h-8 px-2.5 rounded-md text-sm inline-flex items-center gap-1.5 ${view === 'list' ? 'bg-hover text-ink' : 'text-muted'}`} onClick={() => set('view', null)}><List className="size-4" /> List</button>
          <button className={`h-8 px-2.5 rounded-md text-sm inline-flex items-center gap-1.5 ${view === 'tree' ? 'bg-hover text-ink' : 'text-muted'}`} onClick={() => set('view', 'tree')}><ListTree className="size-4" /> Tree</button>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        {chip('vis', 'all', 'Any visibility', vis)}
        {chip('vis', 'public', <><Globe className="size-3" /> Public</>, vis)}
        {chip('vis', 'private', <><Lock className="size-3" /> Private</>, vis)}
        <span className="w-px h-5 bg-line mx-1" />
        {chip('show', 'all', 'All levels', show)}
        {chip('show', 'top', 'Top-level only', show)}
        {chip('show', 'nonempty', 'Has files', show)}
        {chip('show', 'empty', 'Empty', show)}
        <span className="w-px h-5 bg-line mx-1" />
        {chip('hr', 'all', 'Related: any', hr ?? 'all')}
        {chip('hr', 'on', <><EyeOff className="size-3" /> Hides related</>, hr ?? 'all')}
        {chip('hr', 'off', 'Shows related', hr ?? 'all')}
        <span className="ml-auto text-xs text-faint">{lib.foldersLoading ? '' : `${matches.length} of ${lib.folders.length}`}</span>
      </div>

      {lib.foldersLoading ? <Skeleton rows={8} />
        : view === 'tree' ? <TreeView matches={matches} query={q} menuFor={menuFor} />
        : sorted.length === 0 ? (
          <div className="card p-10 text-center text-sm text-faint">
            {lib.folders.length === 0 ? 'No folders yet.' : <>No folders match{q && <> “{q}”</>}. <button className="text-accent-ink underline" onClick={clearAll}>Clear filters</button></>}
          </div>
        ) : (
          <div className="card overflow-hidden">
            {selected.size > 0 && (
              <div className="flex flex-wrap items-center gap-2 px-3 py-2 bg-accent-soft border-b border-line text-sm">
                <button className="btn-icon" onClick={clear} aria-label="Clear selection"><X className="size-4" /></button>
                <span className="font-medium text-accent-ink mr-auto">{selected.size} selected</span>
                <Menu label="Hide related" trigger={<><EyeOff className="size-4" /> Hide related</>} items={[
                  { label: 'Hide related files', icon: <EyeOff className="size-4" />, onClick: () => actions.setHideRelated(selectedFolders, true, clear) },
                  { label: 'Show related files', icon: <Globe className="size-4" />, onClick: () => actions.setHideRelated(selectedFolders, false, clear) },
                ]} />
                <button className="btn h-8" onClick={() => actions.moveFolders(selectedFolders).then(clear)}><FolderInput className="size-4" /> Move</button>
                <button className="btn h-8 text-danger" onClick={() => actions.deleteFolders(selectedFolders, clear)}><Trash2 className="size-4" /> Delete</button>
              </div>
            )}
            <div className="overflow-x-auto">
              <table className="w-full min-w-[680px]">
                <thead className="border-b border-line">
                  <tr>
                    <th className="w-10 pl-4"><input type="checkbox" aria-label="Select all" checked={selected.size === sorted.length} onChange={() => setSelected(selected.size === sorted.length ? new Set() : new Set(sorted.map((f) => f.id)))} /></th>
                    {header(q ? 'relevance' : 'path', q ? 'Best match' : 'Folder')}
                    {header('files', 'Files', 'text-right w-20')}
                    {header('size', 'Size', 'text-right w-24')}
                    <th className="th w-28 hidden sm:table-cell">Access</th>
                    {header('activity', 'Activity', 'w-28 hidden md:table-cell')}
                    {header('created', 'Created', 'w-28 hidden lg:table-cell')}
                    <th className="w-12" />
                  </tr>
                </thead>
                <tbody>
                  {sorted.map((f) => (
                    <tr key={f.id} className={`border-b border-line last:border-0 ${selected.has(f.id) ? 'bg-accent-soft/50' : 'hover:bg-raised'}`}>
                      <td className="pl-4"><input type="checkbox" aria-label={`Select ${f.name}`} checked={selected.has(f.id)} onChange={() => toggle(f.id)} /></td>
                      <td className="td max-w-0 w-full">
                        <Link to="/folders/$id" params={{ id: f.id }} className="flex items-center gap-2.5 min-w-0 group">
                          <FolderIcon className="size-5 shrink-0" />
                          <span className="min-w-0">
                            <span className="block truncate font-medium group-hover:underline"><Highlight text={f.name} query={q} /></span>
                            {f.path.length > 1 && (
                              <span className="flex items-center gap-0.5 text-xs text-faint truncate">
                                {f.path.slice(0, -1).map((p, i) => <span key={i} className="inline-flex items-center gap-0.5 min-w-0">{i > 0 && <ChevronRight className="size-3 shrink-0" />}<span className="truncate"><Highlight text={p} query={q} /></span></span>)}
                              </span>
                            )}
                          </span>
                          {f.children.length > 0 && <span className="ml-1 shrink-0 text-[11px] text-faint border border-line rounded px-1">{f.children.length} sub</span>}
                        </Link>
                      </td>
                      <td className="td text-right tabular text-muted" title={`${f.directFiles} directly inside${f.deletedFiles ? ` · Filester also counts ${f.deletedFiles} deleted` : ''}`}>{f.totalFiles}</td>
                      <td className="td text-right tabular text-muted whitespace-nowrap">{lib.filesLoading ? '…' : formatBytes(f.totalSize)}</td>
                      <td className="td hidden sm:table-cell">
                        <span className="inline-flex items-center gap-1.5 text-xs text-muted">
                          {f.public ? <><Globe className="size-3" />Public</> : <><Lock className="size-3" />Private</>}
                          {flags?.get(f.id)?.hasPassword && <span title="Password-protected"><KeyRound className="size-3 text-accent-ink" /></span>}
                          {flags?.get(f.id)?.hideRelated && <span title="Hides related files"><EyeOff className="size-3" /></span>}
                        </span>
                      </td>
                      <td className="td text-muted whitespace-nowrap hidden md:table-cell">{formatRelative(f.lastActivity)}</td>
                      <td className="td text-muted whitespace-nowrap hidden lg:table-cell">{formatDate(f.created_at)}</td>
                      <td className="pr-2 text-right"><Menu items={menuFor(f)} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
    </div>
  )
}

/** Tree view. With a query, shows matches plus their ancestors (dimmed) fully expanded. */
function TreeView({ matches, query, menuFor }: { matches: FolderNode[]; query: string; menuFor: (f: FolderNode) => Parameters<typeof Menu>[0]['items'] }) {
  const lib = useLibrary()
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const { visible, matched } = useMemo(() => {
    const matched = new Set(matches.map((m) => m.id))
    const visible = new Set<string>()
    for (const m of matches) m.pathIds.forEach((id) => visible.add(id))
    return { visible, matched }
  }, [matches])

  const roots = lib.roots.filter((r) => visible.has(r.id))
  const render = (f: FolderNode, depth: number): React.ReactNode => {
    const kids = f.children.filter((c) => visible.has(c))
    const isCollapsed = collapsed.has(f.id)
    const dim = !matched.has(f.id)
    return (
      <div key={f.id}>
        <div className="flex items-center gap-1 pr-2 border-b border-line hover:bg-raised" style={{ paddingLeft: 8 + depth * 22 }}>
          <button className={`size-6 grid place-items-center text-faint hover:text-ink ${kids.length ? '' : 'invisible'}`}
            onClick={() => setCollapsed((s) => { const n = new Set(s); if (n.has(f.id)) n.delete(f.id); else n.add(f.id); return n })}>
            <ChevronRight className={`size-4 transition-transform ${isCollapsed ? '' : 'rotate-90'}`} />
          </button>
          <Link to="/folders/$id" params={{ id: f.id }} className={`flex-1 min-w-0 flex items-center gap-2 py-2 text-sm ${dim ? 'opacity-50' : ''}`}>
            <FolderIcon className="size-4 shrink-0" open={!isCollapsed && kids.length > 0} />
            <span className="truncate hover:underline"><Highlight text={f.name} query={query} /></span>
            {!f.public && <Lock className="size-3 text-faint shrink-0" />}
          </Link>
          <span className="text-xs text-faint tabular w-16 text-right">{f.totalFiles} files</span>
          <span className="text-xs text-faint tabular w-20 text-right hidden sm:block">{formatBytes(f.totalSize)}</span>
          <Menu items={menuFor(f)} />
        </div>
        {!isCollapsed && kids.map((c) => render(lib.byId.get(c)!, depth + 1))}
      </div>
    )
  }
  if (!roots.length) return <div className="card p-10 text-center text-sm text-faint">No folders match.</div>
  return (
    <div className="card overflow-hidden">
      <div className="flex justify-end gap-3 px-3 py-1.5 border-b border-line text-xs">
        <button className="text-muted hover:text-ink" onClick={() => setCollapsed(new Set())}>Expand all</button>
        <button className="text-muted hover:text-ink" onClick={() => setCollapsed(new Set(lib.folders.filter((f) => f.children.length).map((f) => f.id)))}>Collapse all</button>
      </div>
      {roots.map((r) => render(r, 0))}
    </div>
  )
}
