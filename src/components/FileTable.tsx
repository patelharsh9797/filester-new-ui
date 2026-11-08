import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from '@tanstack/react-router'
import { ArrowDown, ArrowUp, Copy, ExternalLink, FolderInput, Info, Pencil, Trash2, X } from 'lucide-react'
import type { FileRow } from '../lib/types'
import { formatBytes, formatDate } from '../lib/format'
import { FileKindIcon, FolderIcon } from './icons'
import { Highlight } from './Highlight'
import { Menu } from './Menu'
import { copyText, useActions } from '../state/actions'
import { useToast } from '../state/toast'
import { useOpenDialog } from '../state/dialogs'
import { FileInfoDialog } from './FileInfo'
import { ExpiryBadge } from './ExpiryBadge'
import { useExpiring } from '../lib/expiry'

export type FileSort = 'name' | 'size' | 'date' | 'downloads' | 'folder'
const PAGE = 100

export function FileTable({ files, showFolder = true, query = '', highlight, empty, defaultSort = 'date', sorted }: {
  files: FileRow[]
  showFolder?: boolean
  query?: string
  /** slug to scroll to and flash */
  highlight?: string | null
  empty?: React.ReactNode
  defaultSort?: FileSort
  /** If true, `files` is already ordered by relevance and the table starts unsorted. */
  sorted?: boolean
}) {
  const actions = useActions()
  const toast = useToast()
  const openDialog = useOpenDialog()
  const expiring = useExpiring()
  const atRisk = useMemo(() => new Map(expiring.files.filter((x) => x.level === 'critical' || x.level === 'soon').map((x) => [x.id, x])), [expiring.files])
  const [sort, setSort] = useState<{ key: FileSort; dir: 1 | -1 } | null>(sorted ? null : { key: defaultSort, dir: defaultSort === 'name' || defaultSort === 'folder' ? 1 : -1 })
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [limit, setLimit] = useState(PAGE)
  const lastClicked = useRef<number | null>(null)

  useEffect(() => { setLimit(PAGE) }, [files])
  useEffect(() => { if (sorted) setSort(null) }, [sorted, query])
  // Drop selections that no longer exist
  useEffect(() => {
    setSelected((s) => {
      if (!s.size) return s
      const ids = new Set(files.map((f) => f.id))
      const next = new Set([...s].filter((id) => ids.has(id)))
      return next.size === s.size ? s : next
    })
  }, [files])

  const rows = useMemo(() => {
    if (!sort) return files
    const k = sort.key
    const cmp = (a: FileRow, b: FileRow) =>
      k === 'name' ? a.name.localeCompare(b.name, undefined, { numeric: true })
        : k === 'folder' ? a.folderPath.localeCompare(b.folderPath, undefined, { numeric: true }) || a.name.localeCompare(b.name)
        : k === 'size' ? a.size - b.size
        : k === 'downloads' ? a.downloads - b.downloads
        : a.created_at.localeCompare(b.created_at) || a.id - b.id
    return [...files].sort((a, b) => cmp(a, b) * sort.dir)
  }, [files, sort])

  // Make sure a highlighted file is rendered, then scroll to it
  useEffect(() => {
    if (!highlight) return
    const idx = rows.findIndex((r) => r.slug === highlight)
    if (idx >= limit) setLimit(idx + PAGE)
    const t = setTimeout(() => document.getElementById(`file-${highlight}`)?.scrollIntoView({ block: 'center', behavior: 'smooth' }), 50)
    return () => clearTimeout(t)
  }, [highlight, rows, limit])

  const visible = rows.slice(0, limit)
  const selectedFiles = rows.filter((r) => selected.has(r.id))
  const allSelected = rows.length > 0 && selected.size === rows.length

  const toggle = (id: number, idx: number, shift: boolean) => {
    setSelected((s) => {
      const next = new Set(s)
      if (shift && lastClicked.current !== null) {
        const [a, b] = [Math.min(lastClicked.current, idx), Math.max(lastClicked.current, idx)]
        const on = !s.has(id)
        for (let i = a; i <= b; i++) {
          if (on) next.add(rows[i].id)
          else next.delete(rows[i].id)
        }
      } else if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
    lastClicked.current = idx
  }

  const header = (key: FileSort, label: string, className = '') => (
    <th className={`th ${className}`}>
      <button className="inline-flex items-center gap-1 hover:text-ink uppercase" onClick={() => setSort((s) => ({ key, dir: s?.key === key ? (-s.dir as 1 | -1) : key === 'name' || key === 'folder' ? 1 : -1 }))}>
        {label}{sort?.key === key && (sort.dir === 1 ? <ArrowUp className="size-3" /> : <ArrowDown className="size-3" />)}
      </button>
    </th>
  )

  const showInfo = (f: FileRow) => openDialog((close) => <FileInfoDialog file={f} onClose={close} />)
  const clear = () => setSelected(new Set())

  if (!files.length) return <div className="card p-10 text-center text-sm text-faint">{empty ?? 'No files'}</div>

  return (
    <div className="card overflow-hidden">
      {selected.size > 0 && (
        <div className="flex flex-wrap items-center gap-2 px-3 py-2 bg-accent-soft border-b border-line text-sm">
          <button className="btn-icon" onClick={clear} aria-label="Clear selection"><X className="size-4" /></button>
          <span className="font-medium text-accent-ink mr-auto">{selected.size} selected · {formatBytes(selectedFiles.reduce((n, f) => n + f.size, 0))}</span>
          <button className="btn h-8" onClick={() => copyText(selectedFiles.map((f) => f.url).join('\n'), toast, 'Links')}><Copy className="size-4" /> Copy links</button>
          <button className="btn h-8" onClick={() => actions.moveFiles(selectedFiles, clear)}><FolderInput className="size-4" /> Move</button>
          <button className="btn h-8 text-danger" onClick={() => actions.deleteFiles(selectedFiles, clear)}><Trash2 className="size-4" /> Delete</button>
        </div>
      )}
      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px]">
          <thead className="border-b border-line">
            <tr>
              <th className="w-10 pl-4"><input type="checkbox" aria-label="Select all" checked={allSelected} onChange={() => setSelected(allSelected ? new Set() : new Set(rows.map((r) => r.id)))} /></th>
              {header('name', 'Name')}
              {showFolder && header('folder', 'Folder', 'hidden md:table-cell')}
              {header('size', 'Size', 'text-right w-24')}
              {header('date', 'Uploaded', 'w-32 hidden sm:table-cell')}
              {header('downloads', 'DLs', 'text-right w-16 hidden lg:table-cell')}
              <th className="w-12" />
            </tr>
          </thead>
          <tbody>
            {visible.map((f, idx) => {
              const isSel = selected.has(f.id)
              return (
                <tr key={f.id} id={`file-${f.slug}`}
                  className={`group border-b border-line last:border-0 ${isSel ? 'bg-accent-soft/50' : 'hover:bg-raised'} ${highlight === f.slug ? 'outline-2 -outline-offset-2 outline-accent' : ''}`}>
                  <td className="pl-4"><input type="checkbox" aria-label={`Select ${f.name}`} checked={isSel} onChange={() => {}} onClick={(e) => toggle(f.id, idx, e.shiftKey)} /></td>
                  <td className="td max-w-0 w-full">
                    <button className="flex items-center gap-2.5 min-w-0 max-w-full text-left" onClick={() => showInfo(f)}>
                      <FileKindIcon kind={f.kind} />
                      <span className="truncate hover:underline" title={f.name}><Highlight text={f.name} query={query} /></span>
                      {atRisk.has(f.id) && <ExpiryBadge compact daysLeft={atRisk.get(f.id)!.daysLeft} level={atRisk.get(f.id)!.level} />}
                    </button>
                  </td>
                  {showFolder && (
                    <td className="td hidden md:table-cell max-w-[260px]">
                      {f.folder_id && f.folderPath
                        ? <Link to="/folders/$id" params={{ id: f.folder_id }} className="flex items-center gap-1.5 text-muted hover:text-ink min-w-0" title={f.folderPath}><FolderIcon className="size-4 shrink-0" /><span className="truncate"><Highlight text={f.folderPath} query={query} /></span></Link>
                        : <span className="text-faint">—</span>}
                    </td>
                  )}
                  <td className="td text-right text-muted tabular whitespace-nowrap">{formatBytes(f.size)}</td>
                  <td className="td text-muted whitespace-nowrap hidden sm:table-cell">{formatDate(f.created_at)}</td>
                  <td className="td text-right text-muted tabular hidden lg:table-cell">{f.downloads}</td>
                  <td className="pr-2 text-right">
                    <Menu items={[
                      { label: 'Details', icon: <Info className="size-4" />, onClick: () => showInfo(f) },
                      { label: 'Open on Filester', icon: <ExternalLink className="size-4" />, onClick: () => window.open(f.url, '_blank', 'noreferrer') },
                      { label: 'Copy link', icon: <Copy className="size-4" />, onClick: () => copyText(f.url, toast) },
                      'sep',
                      { label: 'Rename', icon: <Pencil className="size-4" />, onClick: () => actions.renameFile(f) },
                      { label: 'Move to…', icon: <FolderInput className="size-4" />, onClick: () => actions.moveFiles([f]) },
                      'sep',
                      { label: 'Delete', icon: <Trash2 className="size-4" />, danger: true, onClick: () => actions.deleteFiles([f]) },
                    ]} />
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      {rows.length > limit && (
        <div className="flex items-center justify-center gap-3 p-3 border-t border-line text-sm text-muted">
          Showing {limit.toLocaleString()} of {rows.length.toLocaleString()}
          <button className="btn h-8" onClick={() => setLimit((l) => l + PAGE * 2)}>Show more</button>
          <button className="btn-ghost h-8" onClick={() => setLimit(rows.length)}>Show all</button>
        </div>
      )}
    </div>
  )
}
