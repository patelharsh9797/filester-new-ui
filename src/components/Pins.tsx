import { Link, useNavigate, useSearch } from '@tanstack/react-router'
import { Bookmark, BookmarkCheck, ChevronDown, ChevronUp, Files, FolderTree, Hourglass, Pencil, Pin, X } from 'lucide-react'
import { cleanSearch, usePins, type SavedPage, type SavedSearch } from '../state/pins'
import { useDialogs } from '../state/dialogs'
import { useToast } from '../state/toast'
import { useLibrary } from '../lib/library'
import { KIND_LABELS } from '../lib/format'
import { FolderIcon } from './icons'
import type { FileKind } from '../lib/types'

const PAGE_ICON: Record<SavedPage, React.ReactNode> = {
  '/files': <Files className="size-3.5 shrink-0" />,
  '/folders': <FolderTree className="size-3.5 shrink-0" />,
  '/expiring': <Hourglass className="size-3.5 shrink-0" />,
}
const PAGE_NAME: Record<SavedPage, string> = { '/files': 'Files', '/folders': 'Folders', '/expiring': 'Expiring' }
// View-only params that don't make a search worth saving on their own.
const VIEW_ONLY = new Set(['sort', 'dir', 'view'])

/** “Save search” on a list page; turns into “Saved” (click to remove) once saved. */
export function SaveSearchButton({ page }: { page: SavedPage }) {
  const raw = useSearch({ strict: false }) as Record<string, unknown>
  const search = cleanSearch(raw)
  const pins = usePins()
  const lib = useLibrary()
  const { prompt } = useDialogs()
  const toast = useToast()
  if (!Object.keys(search).some((k) => !VIEW_ONLY.has(k))) return null
  const existing = pins.findSearch(page, search)

  if (existing) {
    return (
      <button className="btn h-9 text-accent-ink" onClick={() => { pins.removeSearch(existing.id); toast('info', `Removed “${existing.name}” from saved searches`) }}
        title="Saved in the sidebar — click to remove" aria-label={`Saved as ${existing.name}. Remove`}>
        <BookmarkCheck className="size-4" /> Saved
      </button>
    )
  }

  const suggest = () => {
    const parts: string[] = []
    if (search.q) parts.push(`“${search.q}”`)
    if (search.kind) parts.push(KIND_LABELS[search.kind as FileKind] ?? search.kind)
    if (search.in) parts.push(search.in === 'root' ? 'Unfiled' : `in ${lib.byId.get(search.in)?.name ?? 'folder'}`)
    for (const [k, v] of Object.entries(search)) if (!['q', 'kind', 'in', ...VIEW_ONLY].includes(k)) parts.push(v)
    return (parts.join(' · ') || PAGE_NAME[page]).slice(0, 60)
  }

  const save = async () => {
    const name = await prompt({ title: 'Save search', label: `Name (shown in the sidebar; opens ${PAGE_NAME[page]} with these filters)`, initial: suggest(), confirmLabel: 'Save' })
    if (!name?.trim()) return
    pins.saveSearch(name, page, search)
    toast('success', `Saved “${name.trim()}” to the sidebar`)
  }
  return <button className="btn h-9" onClick={save}><Bookmark className="size-4" /> Save search</button>
}

/** Sidebar: pinned folders, then saved searches. Renders nothing when both are empty. */
export function SidebarPins({ onNavigate }: { onNavigate?: () => void }) {
  const pins = usePins()
  const lib = useLibrary()
  const navigate = useNavigate()
  const { prompt } = useDialogs()
  if (!pins.folders.length && !pins.searches.length) return null

  const rowCls = 'group flex items-center gap-1.5 rounded-md pl-2 pr-1 h-7 text-[13px] min-w-0'
  const active = { className: 'bg-accent-soft text-accent-ink font-medium' }
  const inactive = { className: 'text-muted hover:bg-hover hover:text-ink' }
  const iconBtn = 'size-5 grid place-items-center rounded text-faint hover:text-ink hover:bg-raised disabled:opacity-30 shrink-0 [li:not(:hover):not(:focus-within)_&]:opacity-0'

  const open = (s: SavedSearch) => { navigate({ to: s.page, search: s.search as never }); onNavigate?.() }
  const rename = async (s: SavedSearch) => {
    const name = await prompt({ title: 'Rename saved search', label: 'Name', initial: s.name, confirmLabel: 'Rename' })
    if (name?.trim()) pins.renameSearch(s.id, name)
  }

  return (
    <div className="px-2 space-y-3" data-testid="sidebar-pins">
      {pins.folders.length > 0 && (
        <section aria-label="Pinned folders">
          <h3 className="px-2 mb-1 text-[11px] font-semibold uppercase tracking-wider text-faint flex items-center gap-1"><Pin className="size-3" /> Pinned</h3>
          <ul>
            {pins.folders.map((id, i) => {
              const f = lib.byId.get(id)
              if (!f) {
                // Folder deleted (or not loaded yet): offer to clean up once the list has loaded.
                return lib.foldersLoading ? null : (
                  <li key={id} className={`${rowCls} text-faint`}>
                    <FolderIcon className="size-4 shrink-0 opacity-40" /><span className="truncate flex-1 line-through">Deleted folder</span>
                    <button className="size-5 grid place-items-center rounded hover:text-ink" onClick={() => pins.unpin(id)} aria-label="Remove deleted folder from pinned"><X className="size-3.5" /></button>
                  </li>
                )
              }
              return (
                <li key={id} className="group flex items-center rounded-md hover:bg-hover focus-within:bg-hover">
                  <Link to="/folders/$id" params={{ id }} onClick={onNavigate} className={`${rowCls} flex-1`} activeOptions={{ includeSearch: false }} activeProps={active} inactiveProps={{ className: 'text-muted hover:text-ink' }} title={f.pathText}>
                    <FolderIcon className="size-4 shrink-0" />
                    <span className="truncate flex-1">{f.name}</span>
                    <span className="text-[11px] text-faint tabular group-hover:hidden group-focus-within:hidden">{lib.filesLoading ? '' : f.totalFiles}</span>
                  </Link>
                  <span className="hidden group-hover:flex group-focus-within:flex items-center pr-1">
                    <button className={iconBtn} onClick={() => pins.movePin(id, -1)} disabled={i === 0} aria-label={`Move ${f.name} up`}><ChevronUp className="size-3.5" /></button>
                    <button className={iconBtn} onClick={() => pins.movePin(id, 1)} disabled={i === pins.folders.length - 1} aria-label={`Move ${f.name} down`}><ChevronDown className="size-3.5" /></button>
                    <button className={iconBtn} onClick={() => pins.unpin(id)} aria-label={`Unpin ${f.name}`}><X className="size-3.5" /></button>
                  </span>
                </li>
              )
            })}
          </ul>
        </section>
      )}
      {pins.searches.length > 0 && (
        <section aria-label="Saved searches">
          <h3 className="px-2 mb-1 text-[11px] font-semibold uppercase tracking-wider text-faint flex items-center gap-1"><Bookmark className="size-3" /> Saved searches</h3>
          <ul>
            {pins.searches.map((s) => (
              <li key={s.id} className={`${rowCls} ${inactive.className}`} title={`${PAGE_NAME[s.page]} · ${s.name}`}>
                {PAGE_ICON[s.page]}
                <button className="truncate flex-1 text-left h-full" onClick={() => open(s)}>{s.name}</button>
                <button className={iconBtn} onClick={() => rename(s)} aria-label={`Rename ${s.name}`}><Pencil className="size-3" /></button>
                <button className={iconBtn} onClick={() => pins.removeSearch(s.id)} aria-label={`Remove ${s.name}`}><X className="size-3.5" /></button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}
