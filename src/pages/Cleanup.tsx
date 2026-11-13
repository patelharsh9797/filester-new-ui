import { useMemo, useState } from 'react'
import { Link } from '@tanstack/react-router'
import { ArrowRight, Copy as CopyIcon, Eye, EyeOff, FolderX, Sparkles, Trash2, X } from 'lucide-react'
import { useLibrary } from '../lib/library'
import { useDuplicates } from '../lib/duplicates'
import { findEmptyFolders } from '../lib/cleanup'
import { formatBytes, formatDate, plural } from '../lib/format'
import { useActions } from '../state/actions'
import { useSession } from '../state/session'
import { FolderIcon } from '../components/icons'

type Show = 'all' | 'emptied' | 'never'

/** Folders the user chose to keep (placeholders etc.), per account in this browser. */
function useKept() {
  const session = useSession()
  const key = `fsnav.cleanup-keep.v1:${(session?.username ?? '').toLowerCase()}`
  const [kept, setKept] = useState<Set<string>>(() => {
    try { return new Set(JSON.parse(localStorage.getItem(key) || '[]') as string[]) } catch { return new Set() }
  })
  const save = (next: Set<string>) => { setKept(next); try { localStorage.setItem(key, JSON.stringify([...next])) } catch { /* per-visit only */ } }
  return {
    kept,
    keep: (ids: string[]) => save(new Set([...kept, ...ids])),
    unkeep: (ids: string[]) => { const n = new Set(kept); ids.forEach((i) => n.delete(i)); save(n) },
  }
}

export function CleanupPage() {
  const lib = useLibrary()
  const dup = useDuplicates()
  const actions = useActions()
  const { kept, keep, unkeep } = useKept()
  const [show, setShow] = useState<Show>('all')
  const [showKept, setShowKept] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())

  const empty = useMemo(() => (lib.filesLoading ? [] : findEmptyFolders(lib)), [lib])
  const active = empty.filter((e) => !kept.has(e.folder.id))
  const keptList = empty.filter((e) => kept.has(e.folder.id))
  const emptied = active.filter((e) => e.deleted > 0)
  const list = (showKept ? keptList : active)
    .filter((e) => show === 'all' || (show === 'emptied' ? e.deleted > 0 : e.deleted === 0))
    .sort((a, b) => a.folder.pathText.localeCompare(b.folder.pathText, undefined, { numeric: true }))
  const sel = list.filter((e) => selected.has(e.folder.id))
  const clear = () => setSelected(new Set())
  const toggle = (id: string) => setSelected((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n })
  const allSel = list.length > 0 && sel.length === list.length
  const dupBytes = dup.groups.reduce((n, g) => n + g.extraBytes, 0)
  const withSubs = active.reduce((n, e) => n + 1 + e.subfolders, 0)

  const chip = (v: Show, label: string, n: number) => (
    <button className={show === v ? 'chip-active' : 'chip'} onClick={() => { setShow(v); clear() }}>{label} <span className="opacity-60">{n}</span></button>
  )

  return (
    <div className="max-w-6xl mx-auto p-4 sm:p-6 space-y-5">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Cleanup</h1>
        <p className="text-sm text-muted max-w-3xl">Folders with nothing left in them, and extra copies of files. Nothing is deleted until you confirm.</p>
      </div>

      <div className="grid sm:grid-cols-3 gap-3">
        <div className="card p-4">
          <div className="text-xs text-muted">Empty folders</div>
          <div className="text-2xl font-semibold mt-1 tabular">{lib.filesLoading ? '…' : active.length}</div>
          <div className="text-xs text-faint mt-0.5">{lib.filesLoading ? 'Checking…' : `${plural(withSubs, 'folder')} including empty subfolders`}</div>
        </div>
        <div className="card p-4">
          <div className="text-xs text-muted">Emptied by deletions</div>
          <div className="text-2xl font-semibold mt-1 tabular">{lib.filesLoading ? '…' : emptied.length}</div>
          <div className="text-xs text-faint mt-0.5">Had files that were deleted, most likely by Filester’s inactivity cleanup</div>
        </div>
        <Link to="/duplicates" className="card p-4 hover:border-faint/40 transition-colors">
          <div className="text-xs text-muted flex items-center gap-1"><CopyIcon className="size-3.5" /> Duplicate copies</div>
          <div className="text-2xl font-semibold mt-1 tabular">{dup.loading ? '…' : dup.extraCopies}</div>
          <div className="text-xs text-faint mt-0.5 flex items-center gap-1">{dup.extraCopies ? <>Frees {formatBytes(dupBytes)} · Review <ArrowRight className="size-3" /></> : 'None found'}</div>
        </Link>
      </div>

      <section className="space-y-3" aria-label="Empty folders">
        <div className="flex flex-wrap items-center gap-1.5">
          {chip('all', 'All', (showKept ? keptList : active).length)}
          {chip('emptied', 'Emptied by deletions', (showKept ? keptList : active).filter((e) => e.deleted > 0).length)}
          {chip('never', 'Never had files', (showKept ? keptList : active).filter((e) => e.deleted === 0).length)}
          {(keptList.length > 0 || showKept) && (
            <button className="ml-auto text-xs text-muted hover:text-ink underline" onClick={() => { setShowKept((v) => !v); clear() }}>
              {showKept ? 'Back to empty folders' : `Show ${plural(keptList.length, 'kept folder')}`}
            </button>
          )}
        </div>

        {lib.filesLoading ? <div className="card h-40 animate-pulse" /> : list.length === 0 ? (
          <div className="card p-10 text-center">
            <Sparkles className="size-6 mx-auto text-accent-ink mb-2" />
            <p className="font-medium">{showKept ? 'No kept folders' : 'All tidy'}</p>
            <p className="text-sm text-muted mt-1">{showKept ? 'Folders you keep are hidden from this list.' : 'Every folder has at least one file somewhere inside it.'}</p>
          </div>
        ) : (
          <div className="card overflow-hidden">
            {sel.length > 0 && (
              <div className="flex flex-wrap items-center gap-2 px-3 py-2 bg-accent-soft border-b border-line text-sm">
                <button className="btn-icon" onClick={clear} aria-label="Clear selection"><X className="size-4" /></button>
                <span className="font-medium text-accent-ink mr-auto">{plural(sel.length, 'folder')} selected</span>
                {showKept
                  ? <button className="btn h-8" onClick={() => { unkeep(sel.map((e) => e.folder.id)); clear() }}><Eye className="size-4" /> Don’t keep</button>
                  : <button className="btn h-8" onClick={() => { keep(sel.map((e) => e.folder.id)); clear() }} title="Hide from this list; nothing changes on Filester"><EyeOff className="size-4" /> Keep</button>}
                <button className="btn h-8 text-danger" onClick={() => actions.deleteFolders(sel.map((e) => e.folder), clear)}><Trash2 className="size-4" /> Delete</button>
              </div>
            )}
            <ul className="divide-y divide-line">
              <li className="flex items-center gap-3 px-4 py-2 text-xs text-muted">
                <input type="checkbox" aria-label="Select all" checked={allSel} onChange={() => setSelected(allSel ? new Set() : new Set(list.map((e) => e.folder.id)))} />
                <span>Folder</span>
              </li>
              {list.map((e) => (
                <li key={e.folder.id} className={`flex items-center gap-3 px-4 py-2.5 text-sm ${selected.has(e.folder.id) ? 'bg-accent-soft/50' : 'hover:bg-raised'}`}>
                  <input type="checkbox" aria-label={`Select ${e.folder.pathText}`} checked={selected.has(e.folder.id)} onChange={() => toggle(e.folder.id)} />
                  <FolderIcon className="size-5 shrink-0" />
                  <div className="min-w-0 flex-1">
                    <Link to="/folders/$id" params={{ id: e.folder.id }} className="block truncate font-medium hover:underline" title={e.folder.pathText}>{e.folder.pathText}</Link>
                    <div className="text-xs text-faint">
                      {e.deleted > 0
                        ? <span className="text-accent-ink">{plural(e.deleted, 'file')} deleted here</span>
                        : 'Never had files'}
                      {e.subfolders > 0 && <> · {plural(e.subfolders, 'empty subfolder')}</>}
                      <span className="hidden sm:inline"> · created {formatDate(e.folder.created_at)}</span>
                    </div>
                  </div>
                  {showKept
                    ? <button className="btn h-8 hidden sm:inline-flex" onClick={() => unkeep([e.folder.id])}>Don’t keep</button>
                    : <button className="btn-ghost h-8 hidden sm:inline-flex" onClick={() => keep([e.folder.id])} title="Hide from this list; nothing changes on Filester">Keep</button>}
                </li>
              ))}
            </ul>
          </div>
        )}
        <p className="text-xs text-faint flex gap-1.5"><FolderX className="size-3.5 shrink-0 mt-px" />
          Deleting a folder here also deletes its empty subfolders (Filester would otherwise leave them behind as hidden orphans). “Keep” only hides a folder from this list.</p>
      </section>
    </div>
  )
}
