import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Link } from '@tanstack/react-router'
import { ChevronLeft, ChevronRight, Copy, ExternalLink, FolderInput, LayoutGrid, List, Loader2, Pencil, Play, Trash2, X } from 'lucide-react'
import { getViewTicket, type ViewTicket } from '../lib/api'
import { formatBytes, formatDate } from '../lib/format'
import { copyText, useActions } from '../state/actions'
import { useToast } from '../state/toast'
import { FileKindIcon, FolderIcon } from './icons'
import type { FileRow } from '../lib/types'

// ---------------------------------------------------------------- list / grid preference

export type FileView = 'list' | 'grid'
const VIEW_KEY = 'fsnav.files-view'
const storedView = (): FileView | null => { try { const v = localStorage.getItem(VIEW_KEY); return v === 'grid' || v === 'list' ? v : null } catch { return null } }

/** List or grid: the URL wins (?view=grid), then the last choice in this browser. */
export function useFileView(urlValue: string | undefined, setUrl: (v: FileView) => void) {
  const view: FileView = urlValue === 'grid' || urlValue === 'list' ? urlValue : storedView() ?? 'list'
  const set = (v: FileView) => { try { localStorage.setItem(VIEW_KEY, v) } catch { /* per-visit only */ } setUrl(v) }
  return [view, set] as const
}

export function ViewToggle({ view, onChange }: { view: FileView; onChange: (v: FileView) => void }) {
  const b = (v: FileView, icon: React.ReactNode, label: string) => (
    <button className={`h-8 px-2.5 rounded-md text-sm inline-flex items-center gap-1.5 ${view === v ? 'bg-hover text-ink' : 'text-muted hover:text-ink'}`}
      onClick={() => onChange(v)} aria-pressed={view === v} aria-label={`${label} view`} title={`${label} view`}>
      {icon}<span className="hidden sm:inline">{label}</span>
    </button>
  )
  return (
    <div className="flex rounded-lg border border-line p-0.5 bg-panel shrink-0" role="group" aria-label="View">
      {b('list', <List className="size-4" />, 'List')}
      {b('grid', <LayoutGrid className="size-4" />, 'Grid')}
    </div>
  )
}

// ---------------------------------------------------------------- media helpers

const FILESTER = 'https://filester.me'
/** Absolute thumbnail URL (Filester returns /t/<uuid>; public, cached a day). */
export function thumbSrc(f: Pick<FileRow, 'thumbnail'>): string | null {
  const t = f.thumbnail
  if (!t) return null
  if (/^https?:\/\//.test(t)) return t
  return /^\/t\/[A-Za-z0-9-]+$/.test(t) ? FILESTER + t : null
}
const previewable = (f: FileRow) => f.kind === 'image' || f.kind === 'video' || f.kind === 'audio'

// One view link per file while it's valid: each request counts a view on Filester.
const tickets = new Map<string, Promise<ViewTicket>>()
function viewLink(slug: string) {
  const hit = tickets.get(slug)
  if (hit) return hit
  const p = getViewTicket(slug)
  tickets.set(slug, p)
  p.then((t) => setTimeout(() => tickets.delete(slug), Math.max(0, t.expiresAt - Date.now())), () => tickets.delete(slug))
  return p
}

// ---------------------------------------------------------------- grid

const PAGE = 120

export function Gallery({ files, empty, defaultSort = 'date', sorted }: {
  files: FileRow[]
  empty?: React.ReactNode
  defaultSort?: 'date' | 'name'
  /** Keep the given order (e.g. search relevance) */
  sorted?: boolean
}) {
  const actions = useActions()
  const toast = useToast()
  const rows = useMemo(() => sorted ? files : [...files].sort(defaultSort === 'name'
    ? (a, b) => a.name.localeCompare(b.name, undefined, { numeric: true })
    : (a, b) => b.created_at.localeCompare(a.created_at) || b.id - a.id), [files, sorted, defaultSort])
  const [limit, setLimit] = useState(PAGE)
  const [open, setOpen] = useState<number | null>(null)
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const sentinel = useRef<HTMLDivElement>(null)

  useEffect(() => { setLimit(PAGE) }, [files])
  useEffect(() => {
    const el = sentinel.current
    if (!el || limit >= rows.length) return
    const io = new IntersectionObserver((e) => { if (e[0].isIntersecting) setLimit((l) => l + PAGE) }, { rootMargin: '600px' })
    io.observe(el)
    return () => io.disconnect()
  }, [limit, rows.length])

  const selectedFiles = rows.filter((f) => selected.has(f.id))
  const clear = () => setSelected(new Set())
  const toggle = (id: number) => setSelected((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n })

  if (!rows.length) return <div className="card p-10 text-center text-sm text-faint">{empty ?? 'No files'}</div>

  return (
    <div className="space-y-3">
      {selected.size > 0 && (
        <div className="card flex flex-wrap items-center gap-2 px-3 py-2 bg-accent-soft text-sm sticky top-2 z-10">
          <button className="btn-icon" onClick={clear} aria-label="Clear selection"><X className="size-4" /></button>
          <span className="font-medium text-accent-ink mr-auto">{selected.size} selected · {formatBytes(selectedFiles.reduce((n, f) => n + f.size, 0))}</span>
          <button className="btn h-8" onClick={() => setSelected(new Set(rows.map((f) => f.id)))}>Select all {rows.length}</button>
          <button className="btn h-8" onClick={() => copyText(selectedFiles.map((f) => f.url).join('\n'), toast, 'Links')}><Copy className="size-4" /> Copy links</button>
          <button className="btn h-8" onClick={() => actions.renameFiles(selectedFiles, clear)}><Pencil className="size-4" /> Rename</button>
          <button className="btn h-8" onClick={() => actions.moveFiles(selectedFiles, clear)}><FolderInput className="size-4" /> Move</button>
          <button className="btn h-8 text-danger" onClick={() => actions.deleteFiles(selectedFiles, clear)}><Trash2 className="size-4" /> Delete</button>
        </div>
      )}
      <ul className="grid grid-cols-[repeat(auto-fill,minmax(132px,1fr))] sm:grid-cols-[repeat(auto-fill,minmax(160px,1fr))] gap-2 sm:gap-3" aria-label="Files">
        {rows.slice(0, limit).map((f, i) => (
          <Tile key={f.id} file={f} selected={selected.has(f.id)} selecting={selected.size > 0}
            onOpen={() => setOpen(i)} onToggle={() => toggle(f.id)} />
        ))}
      </ul>
      {limit < rows.length && <div ref={sentinel} className="h-10 grid place-items-center text-xs text-faint">Loading more… ({limit.toLocaleString()} of {rows.length.toLocaleString()})</div>}
      {open !== null && rows[open] && (
        <Lightbox files={rows} index={open} onIndex={(i) => { setOpen(i); if (i >= limit) setLimit(i + 1) }} onClose={() => setOpen(null)} />
      )}
    </div>
  )
}

function Tile({ file: f, selected, selecting, onOpen, onToggle }: { file: FileRow; selected: boolean; selecting: boolean; onOpen: () => void; onToggle: () => void }) {
  const src = thumbSrc(f)
  const [failed, setFailed] = useState(false)
  return (
    <li className={`group relative rounded-xl overflow-hidden border bg-raised ${selected ? 'border-accent ring-2 ring-accent' : 'border-line'}`}>
      <button className="block w-full text-left" onClick={selecting ? onToggle : onOpen} aria-label={`${selecting ? 'Select' : 'Open'} ${f.name}`}>
        <div className="aspect-square relative bg-raised">
          {src && !failed
            ? <img src={src} alt="" loading="lazy" decoding="async" referrerPolicy="no-referrer" className="absolute inset-0 size-full object-cover" onError={() => setFailed(true)} />
            : <div className="absolute inset-0 grid place-items-center"><FileKindIcon kind={f.kind} className="size-10 opacity-70" /></div>}
          {f.kind === 'video' && <span className="absolute inset-0 grid place-items-center pointer-events-none"><span className="size-10 rounded-full bg-black/55 grid place-items-center"><Play className="size-5 text-white fill-white translate-x-px" /></span></span>}
          {f.ext && <span className="absolute bottom-1.5 right-1.5 rounded bg-black/60 text-white text-[10px] font-medium uppercase px-1 py-px">{f.ext}</span>}
        </div>
        <div className="px-2 py-1.5 bg-panel">
          <div className="text-xs font-medium truncate" title={f.name}>{f.name}</div>
          <div className="text-[11px] text-faint tabular">{formatBytes(f.size)}</div>
        </div>
      </button>
      <label className={`absolute top-1.5 left-1.5 size-7 grid place-items-center rounded-md bg-black/45 cursor-pointer ${selected || selecting ? '' : 'opacity-0 group-hover:opacity-100 focus-within:opacity-100 [@media(hover:none)]:opacity-100'}`}>
        <input type="checkbox" className="size-4" checked={selected} onChange={onToggle} aria-label={`Select ${f.name}`} />
      </label>
    </li>
  )
}

// ---------------------------------------------------------------- lightbox

function Lightbox({ files, index, onIndex, onClose }: { files: FileRow[]; index: number; onIndex: (i: number) => void; onClose: () => void }) {
  const f = files[index]
  const toast = useToast()
  const prev = useCallback(() => index > 0 && onIndex(index - 1), [index, onIndex])
  const next = useCallback(() => index < files.length - 1 && onIndex(index + 1), [index, files.length, onIndex])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
      else if (e.key === 'ArrowLeft') prev()
      else if (e.key === 'ArrowRight') next()
      else if (e.key === 'Home') onIndex(0)
      else if (e.key === 'End') onIndex(files.length - 1)
    }
    window.addEventListener('keydown', onKey)
    const overflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { window.removeEventListener('keydown', onKey); document.body.style.overflow = overflow }
  }, [prev, next, onClose, onIndex, files.length])

  // Swipe left/right on touch screens.
  const touch = useRef<{ x: number; y: number } | null>(null)
  const onTouchStart = (e: React.TouchEvent) => { touch.current = { x: e.touches[0].clientX, y: e.touches[0].clientY } }
  const onTouchEnd = (e: React.TouchEvent) => {
    const t = touch.current; touch.current = null
    if (!t) return
    const dx = e.changedTouches[0].clientX - t.x, dy = e.changedTouches[0].clientY - t.y
    if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.5) { if (dx < 0) next(); else prev() }
  }

  // Portal to <body>: escapes the app layout's stacking contexts so nothing shows through.
  return createPortal(
    <div className="fixed inset-0 z-[100] bg-black text-white flex flex-col" role="dialog" aria-modal aria-label={`Preview: ${f.name}`}
      onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
      <div className="flex items-center gap-2 px-3 h-14 shrink-0">
        <FileKindIcon kind={f.kind} />
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium truncate" title={f.name}>{f.name}</div>
          <div className="text-[11px] text-white/60 tabular">{index + 1} / {files.length} · {formatBytes(f.size)} · {formatDate(f.created_at)}</div>
        </div>
        <button className="size-9 grid place-items-center rounded-lg hover:bg-white/10" onClick={() => copyText(f.url, toast)} aria-label="Copy link" title="Copy link"><Copy className="size-4" /></button>
        <a className="size-9 grid place-items-center rounded-lg hover:bg-white/10" href={f.url} target="_blank" rel="noreferrer" aria-label="Open on Filester" title="Open on Filester"><ExternalLink className="size-4" /></a>
        <Link to="/folders/$id" params={{ id: f.folder_id ?? 'root' }} search={{ file: f.slug }} onClick={onClose}
          className="size-9 grid place-items-center rounded-lg hover:bg-white/10" aria-label="Show in folder" title={f.folderPath || 'Unfiled files'}><FolderIcon className="size-4" /></Link>
        <button className="size-9 grid place-items-center rounded-lg hover:bg-white/10" onClick={onClose} aria-label="Close preview"><X className="size-5" /></button>
      </div>

      <div className="relative flex-1 min-h-0 grid place-items-center px-2 sm:px-16">
        <Media key={f.id} file={f} />
        {index > 0 && <button className="absolute left-1 sm:left-3 top-1/2 -translate-y-1/2 size-11 grid place-items-center rounded-full bg-white/10 hover:bg-white/20" onClick={prev} aria-label="Previous"><ChevronLeft className="size-6" /></button>}
        {index < files.length - 1 && <button className="absolute right-1 sm:right-3 top-1/2 -translate-y-1/2 size-11 grid place-items-center rounded-full bg-white/10 hover:bg-white/20" onClick={next} aria-label="Next"><ChevronRight className="size-6" /></button>}
      </div>

      <p className="text-center text-[11px] text-white/45 py-2 shrink-0">
        {f.folderPath ? <><FolderIcon className="size-3 inline -mt-0.5" /> {f.folderPath} · </> : null}
        Opening a preview counts as a view on Filester, not a download.
      </p>
    </div>,
    document.body,
  )
}

function Media({ file: f }: { file: FileRow }) {
  const thumb = thumbSrc(f)
  const [state, setState] = useState<{ url?: string; error?: string }>({})
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    if (!previewable(f)) return
    let cancelled = false
    // Wait a moment so flicking through files with the arrow keys doesn't count a view for each one.
    const t = setTimeout(() => {
      viewLink(f.slug).then((v) => { if (!cancelled) setState({ url: v.url }) }, (e: Error) => { if (!cancelled) setState({ error: e.message }) })
    }, 250)
    return () => { cancelled = true; clearTimeout(t) }
  }, [f])

  if (!previewable(f)) {
    return (
      <div className="text-center space-y-3">
        <FileKindIcon kind={f.kind} className="size-16 mx-auto opacity-80" />
        <p className="text-sm text-white/70">No preview for this type of file.</p>
        <a className="inline-flex items-center gap-1.5 text-sm underline" href={f.url} target="_blank" rel="noreferrer">Open on Filester <ExternalLink className="size-3.5" /></a>
      </div>
    )
  }
  if (state.error) {
    return (
      <div className="text-center space-y-3 max-w-sm">
        {thumb && <img src={thumb} alt="" className="mx-auto max-h-48 rounded-lg opacity-60" referrerPolicy="no-referrer" />}
        <p className="text-sm text-white/80">Couldn’t load the preview: {state.error}</p>
        <a className="inline-flex items-center gap-1.5 text-sm underline" href={f.url} target="_blank" rel="noreferrer">Open on Filester <ExternalLink className="size-3.5" /></a>
      </div>
    )
  }

  const box = 'max-w-full max-h-[calc(100dvh-7.5rem)] object-contain'
  return (
    <div className="relative grid place-items-center size-full">
      {/* Thumbnail first (instant), then the full file over it. */}
      {f.kind !== 'audio' && thumb && !loaded && <img src={thumb} alt="" className={`${box} blur-sm scale-[1.01] opacity-70 absolute`} referrerPolicy="no-referrer" />}
      {!loaded && <Loader2 className="size-8 animate-spin text-white/70 absolute" aria-label="Loading preview" />}
      {state.url && f.kind === 'image' && <img src={state.url} alt={f.name} className={`${box} ${loaded ? '' : 'opacity-0'}`} onLoad={() => setLoaded(true)} referrerPolicy="no-referrer" />}
      {state.url && f.kind === 'video' && (
        <video src={state.url} poster={thumb ?? undefined} controls autoPlay playsInline preload="metadata" className={`${box} bg-black rounded-lg`}
          onLoadedData={() => setLoaded(true)} onCanPlay={() => setLoaded(true)} />
      )}
      {state.url && f.kind === 'audio' && (
        <div className="w-full max-w-md space-y-4 text-center">
          <FileKindIcon kind="audio" className="size-16 mx-auto" />
          <audio src={state.url} controls autoPlay className="w-full" onCanPlay={() => setLoaded(true)} />
        </div>
      )}
    </div>
  )
}
