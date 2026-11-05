import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { CornerDownLeft, Search } from 'lucide-react'
import { useLibrary } from '../lib/library'
import { searchItems } from '../lib/search'
import { formatBytes } from '../lib/format'
import { FileKindIcon, FolderIcon } from './icons'
import { Highlight } from './Highlight'

type Scope = 'all' | 'folders' | 'files'
type Result =
  | { type: 'folder'; id: string; name: string; sub: string; meta: string }
  | { type: 'file'; id: number; slug: string; folder: string | null; name: string; sub: string; meta: string; kind: import('../lib/types').FileKind }

/** Ctrl/⌘+K command palette: one search over folders AND files. */
export function SearchPalette({ onClose, initialScope = 'all' }: { onClose: () => void; initialScope?: Scope }) {
  const lib = useLibrary()
  const navigate = useNavigate()
  const [q, setQ] = useState('')
  const [scope, setScope] = useState<Scope>(initialScope)
  const [active, setActive] = useState(0)
  const listRef = useRef<HTMLDivElement>(null)

  const { folders, files } = useMemo(() => {
    const fl = scope === 'files' ? [] : searchItems(lib.folders, q, (f) => f.name, (f) => f.pathText, scope === 'folders' ? 60 : 8)
    const fi = scope === 'folders' || !q.trim() ? [] : searchItems(lib.files, q, (f) => f.name, (f) => f.folderPath, scope === 'files' ? 60 : 12)
    return {
      folders: fl.map((f): Result => ({
        type: 'folder', id: f.id, name: f.name, sub: f.path.length > 1 ? f.path.slice(0, -1).join(' / ') : 'Top level',
        meta: `${f.totalFiles} files · ${formatBytes(f.totalSize)}`,
      })),
      files: fi.map((f): Result => ({
        type: 'file', id: f.id, slug: f.slug, folder: f.folder_id, name: f.name, sub: f.folderPath || 'Top level', meta: formatBytes(f.size), kind: f.kind,
      })),
    }
  }, [lib.folders, lib.files, q, scope])

  const results = [...folders, ...files]
  useEffect(() => setActive(0), [q, scope])
  useEffect(() => {
    listRef.current?.querySelector(`[data-idx="${active}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [active])

  const go = (r: Result | undefined) => {
    if (!r) return
    onClose()
    if (r.type === 'folder') navigate(`/folders/${r.id}`)
    else navigate(`/folders/${r.folder ?? 'root'}?file=${r.slug}`)
  }

  const seeAll = () => {
    onClose()
    navigate(scope === 'folders' ? `/folders?q=${encodeURIComponent(q)}` : `/files?q=${encodeURIComponent(q)}`)
  }

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(results.length - 1, a + 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(0, a - 1)) }
    else if (e.key === 'Enter') { e.preventDefault(); if (e.metaKey || e.ctrlKey) seeAll(); else go(results[active]) }
    else if (e.key === 'Tab') {
      e.preventDefault()
      const order: Scope[] = ['all', 'folders', 'files']
      setScope((s) => order[(order.indexOf(s) + (e.shiftKey ? 2 : 1)) % 3])
    } else if (e.key === 'Escape') onClose()
  }

  const section = (title: string, items: Result[], offset: number) => items.length > 0 && (
    <div className="py-1">
      <div className="px-4 pt-2 pb-1 text-[11px] font-semibold uppercase tracking-wider text-faint">{title}</div>
      {items.map((r, i) => {
        const idx = offset + i
        return (
          <button key={`${r.type}-${r.id}`} data-idx={idx} onMouseMove={() => setActive(idx)} onClick={() => go(r)}
            className={`w-full flex items-center gap-3 px-4 py-2 text-left ${active === idx ? 'bg-hover' : ''}`}>
            {r.type === 'folder' ? <FolderIcon className="size-5 shrink-0" /> : <FileKindIcon kind={r.kind} className="size-5" />}
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm"><Highlight text={r.name} query={q} /></span>
              <span className="block truncate text-xs text-faint">{r.sub}</span>
            </span>
            <span className="text-xs text-faint tabular whitespace-nowrap">{r.meta}</span>
            {active === idx && <CornerDownLeft className="size-3.5 text-faint" />}
          </button>
        )
      })}
    </div>
  )

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center p-4 pt-[12vh] bg-black/40 backdrop-blur-[2px]" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="card shadow-2xl w-full max-w-2xl overflow-hidden" role="dialog" aria-label="Search">
        <div className="flex items-center gap-3 px-4 border-b border-line">
          <Search className="size-5 text-faint shrink-0" />
          <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={onKey}
            placeholder={scope === 'folders' ? 'Search folders by name or path…' : scope === 'files' ? 'Search files…' : 'Search folders and files…'}
            className="flex-1 h-14 bg-transparent outline-none text-base placeholder:text-faint" />
          <kbd className="text-[11px] text-faint border border-line rounded px-1.5 py-0.5">Esc</kbd>
        </div>
        <div className="flex items-center gap-1.5 px-4 py-2 border-b border-line">
          {(['all', 'folders', 'files'] as Scope[]).map((s) => (
            <button key={s} className={scope === s ? 'chip-active' : 'chip'} onClick={() => setScope(s)}>
              {s === 'all' ? 'All' : s === 'folders' ? `Folders · ${lib.folders.length}` : `Files · ${lib.files.length}`}
            </button>
          ))}
          <span className="ml-auto text-[11px] text-faint hidden sm:block">Tab to switch · ↑↓ to move · Enter to open</span>
        </div>
        <div ref={listRef} className="max-h-[55vh] overflow-y-auto">
          {lib.loading && <p className="px-4 py-3 text-sm text-faint">Indexing your library{lib.progress ? ` (${lib.progress.loaded}/${lib.progress.total} files)` : ''}…</p>}
          {section(q ? 'Folders' : 'Folders', folders, 0)}
          {section('Files', files, folders.length)}
          {!lib.loading && q && results.length === 0 && <p className="px-4 py-8 text-center text-sm text-faint">Nothing matches “{q}”.</p>}
          {!q && scope !== 'folders' && <p className="px-4 py-3 text-xs text-faint">Type to search across {lib.folders.length} folders and {lib.files.length} files. Try part of a name, words in any order, or a parent folder name.</p>}
        </div>
        {q && results.length > 0 && scope !== 'all' && (
          <button onClick={seeAll} className="w-full px-4 py-2.5 text-sm text-left border-t border-line text-muted hover:bg-hover">
            See all {scope} matching “{q}” <span className="text-faint text-xs">(Ctrl+Enter)</span>
          </button>
        )}
      </div>
    </div>
  )
}
