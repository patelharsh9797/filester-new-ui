import { useMemo } from 'react'
import { useUrlText } from '../lib/useUrlText'
import { SaveSearchButton } from '../components/Pins'
import { useNavigate, useSearch } from '@tanstack/react-router'
import { Search, X } from 'lucide-react'
import { useLibrary } from '../lib/library'
import { searchItems } from '../lib/search'
import { formatBytes, KIND_LABELS } from '../lib/format'
import type { FileKind } from '../lib/types'
import { FileTable } from '../components/FileTable'
import { FileKindIcon, FolderIcon } from '../components/icons'
import { useActions } from '../state/actions'
import { Skeleton } from './Overview'

const SIZES = {
  any: { label: 'Any size', test: () => true },
  small: { label: '< 10 MB', test: (n: number) => n < 10 * 1024 ** 2 },
  medium: { label: '10 MB – 1 GB', test: (n: number) => n >= 10 * 1024 ** 2 && n < 1024 ** 3 },
  large: { label: '> 1 GB', test: (n: number) => n >= 1024 ** 3 },
} as const
const AGES = {
  any: { label: 'Any time', days: 0 },
  '7': { label: 'Last 7 days', days: 7 },
  '30': { label: 'Last 30 days', days: 30 },
  '90': { label: 'Last 90 days', days: 90 },
} as const

export function FilesPage() {
  const lib = useLibrary()
  const actions = useActions()
  const params = useSearch({ from: '/_app/files' })
  const navigate = useNavigate({ from: '/files' })
  const q = params.q ?? ''
  const kind = (params.kind as FileKind | undefined) ?? null
  const size: keyof typeof SIZES = params.size && params.size in SIZES ? (params.size as keyof typeof SIZES) : 'any'
  const age: keyof typeof AGES = params.age && params.age in AGES ? (params.age as keyof typeof AGES) : 'any'
  const where = params.in ?? null // folder id, 'root', or null

  const set = (k: 'q' | 'kind' | 'size' | 'age' | 'in', v: string | null) =>
    navigate({ search: (prev) => ({ ...prev, [k]: v || undefined }), replace: true })
  const [qText, setQText, setQNow, flushQ] = useUrlText(q, (v) => set('q', v))

  const scopeIds = useMemo(() => {
    if (!where || where === 'root') return null
    const ids = new Set<string>()
    const walk = (id: string) => { ids.add(id); lib.byId.get(id)?.children.forEach(walk) }
    walk(where)
    return ids
  }, [where, lib.byId])

  const kindCounts = useMemo(() => {
    const m = new Map<FileKind, number>()
    for (const f of lib.files) m.set(f.kind, (m.get(f.kind) ?? 0) + 1)
    return [...m.entries()].sort((a, b) => b[1] - a[1])
  }, [lib.files])

  const files = useMemo(() => {
    const cutoff = AGES[age].days ? new Date(Date.now() - AGES[age].days * 86400_000).toISOString() : ''
    const filtered = lib.files.filter((f) =>
      (!kind || f.kind === kind)
      && SIZES[size].test(f.size)
      && (!cutoff || f.created_at >= cutoff)
      && (where === 'root' ? !f.folderPath : !scopeIds || (f.folder_id !== null && scopeIds.has(f.folder_id))))
    return q ? searchItems(filtered, q, (f) => f.name, (f) => f.folderPath) : filtered
  }, [lib.files, q, kind, size, age, where, scopeIds])

  const pickScope = async () => {
    const d = await actions.pickFolder('Only show files in…', { confirmLabel: 'Filter' })
    if (d !== undefined) set('in', d ?? 'root')
  }

  const anyFilter = q || kind || size !== 'any' || age !== 'any' || where

  return (
    <div className="max-w-6xl mx-auto p-4 sm:p-6 space-y-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Files</h1>
        <p className="text-sm text-muted">
          {lib.filesLoading ? `Loading${lib.progress ? ` ${lib.progress.loaded} of ${lib.progress.total}` : ''}…` : `${lib.files.length.toLocaleString()} files · ${formatBytes(lib.files.reduce((n, f) => n + f.size, 0))}`}
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[220px]">
          <Search className="size-4 absolute left-3 top-1/2 -translate-y-1/2 text-faint" />
          <input autoFocus className="input pl-9 pr-9" placeholder="Search file names or folder paths…" value={qText} onBlur={flushQ} onChange={(e) => setQText(e.target.value)} />
          {qText && <button className="absolute right-2 top-1/2 -translate-y-1/2 btn-icon size-6" onClick={() => setQNow('')} aria-label="Clear"><X className="size-3.5" /></button>}
        </div>
        <button className="btn min-w-0" onClick={pickScope}>
          <FolderIcon className="size-4" />
          <span className="truncate max-w-[200px]">{where === 'root' ? 'Unfiled only' : where ? lib.byId.get(where)?.name ?? 'Folder' : 'All folders'}</span>
        </button>
        {where && <button className="btn-icon" onClick={() => set('in', null)} aria-label="Clear folder filter"><X className="size-4" /></button>}
        <select className="input w-auto" value={size} onChange={(e) => set('size', e.target.value === 'any' ? null : e.target.value)}>
          {Object.entries(SIZES).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
        </select>
        <select className="input w-auto" value={age} onChange={(e) => set('age', e.target.value === 'any' ? null : e.target.value)}>
          {Object.entries(AGES).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
        </select>
        <SaveSearchButton page="/files" />
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        <button className={!kind ? 'chip-active' : 'chip'} onClick={() => set('kind', null)}>All types</button>
        {kindCounts.map(([k, n]) => (
          <button key={k} className={kind === k ? 'chip-active' : 'chip'} onClick={() => set('kind', kind === k ? null : k)}>
            <FileKindIcon kind={k} className="size-3.5" /> {KIND_LABELS[k]} <span className="opacity-60">{n}</span>
          </button>
        ))}
        {anyFilter && (
          <>
            <span className="ml-auto text-xs text-faint">{files.length.toLocaleString()} match</span>
            <button className="text-xs text-muted hover:text-ink underline" onClick={() => navigate({ search: {}, replace: true })}>Reset</button>
          </>
        )}
      </div>

      {lib.filesLoading ? <Skeleton rows={10} /> : (
        <FileTable files={files} query={q} sorted={!!q}
          empty={lib.files.length ? 'No files match these filters.' : 'No files yet — drop some anywhere to upload.'} />
      )}
    </div>
  )
}
