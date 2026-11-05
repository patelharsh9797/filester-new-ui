import { useMemo, useState } from 'react'
import { ChevronRight, Home, Search } from 'lucide-react'
import { Modal } from '../state/dialogs'
import { useLibrary } from '../lib/library'
import { searchItems } from '../lib/search'
import type { FolderNode } from '../lib/types'
import { FolderIcon } from './icons'
import { Highlight } from './Highlight'

/**
 * Searchable folder chooser. Resolves with a folder id, `null` for the top
 * level, or `undefined` when cancelled.
 */
export function FolderPickerDialog({ title, confirmLabel = 'Move here', exclude, current, onDone }: {
  title: string
  confirmLabel?: string
  /** Folder ids that may not be chosen (e.g. a folder being moved and its subtree) */
  exclude?: Set<string>
  current?: string | null
  onDone: (v: string | null | undefined) => void
}) {
  const lib = useLibrary()
  const [q, setQ] = useState('')
  const [selected, setSelected] = useState<string | null | undefined>(undefined)

  const list = useMemo(() => {
    const avail = lib.folders.filter((f) => !exclude?.has(f.id))
    return q.trim() ? searchItems(avail, q, (f) => f.name, (f) => f.pathText, 200) : avail
  }, [lib.folders, exclude, q])

  const row = (f: FolderNode) => {
    const active = selected === f.id
    const isCurrent = current === f.id
    return (
      <button key={f.id} onClick={() => setSelected(f.id)} onDoubleClick={() => !isCurrent && onDone(f.id)}
        className={`w-full flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm ${active ? 'bg-accent-soft text-accent-ink' : 'hover:bg-hover'}`}
        style={{ paddingLeft: q ? 8 : 8 + f.depth * 16 }}>
        <FolderIcon className="size-4 shrink-0" />
        <span className="min-w-0 flex-1">
          <span className="block truncate"><Highlight text={f.name} query={q} />{isCurrent && <span className="ml-1.5 text-xs text-faint">(current)</span>}</span>
          {q && f.path.length > 1 && <span className="block truncate text-xs text-faint">{f.path.slice(0, -1).join(' / ')}</span>}
        </span>
      </button>
    )
  }

  return (
    <Modal title={title} wide onClose={() => onDone(undefined)} footer={<>
      <span className="mr-auto text-xs text-faint self-center truncate">
        {selected === undefined ? 'Pick a destination' : selected === null ? 'Top level' : lib.byId.get(selected)?.pathText}
      </span>
      <button className="btn" onClick={() => onDone(undefined)}>Cancel</button>
      <button className="btn-primary" disabled={selected === undefined || selected === current} onClick={() => onDone(selected)}>{confirmLabel}</button>
    </>}>
      <div className="relative mb-2">
        <Search className="size-4 absolute left-3 top-1/2 -translate-y-1/2 text-faint" />
        <input autoFocus className="input pl-9" placeholder="Search folders…" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      <div className="h-[340px] overflow-y-auto -mx-1 px-1">
        {!q && (
          <button onClick={() => setSelected(null)} onDoubleClick={() => current !== null && onDone(null)}
            className={`w-full flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm ${selected === null ? 'bg-accent-soft text-accent-ink' : 'hover:bg-hover'}`}>
            <Home className="size-4 text-muted" /> Top level {current === null && <span className="text-xs text-faint">(current)</span>}
            <ChevronRight className="size-3.5 ml-auto text-faint" />
          </button>
        )}
        {lib.foldersLoading ? <p className="text-sm text-faint p-2">Loading folders…</p>
          : list.length === 0 ? <p className="text-sm text-faint p-2">No folders match “{q}”.</p>
          : list.map(row)}
      </div>
    </Modal>
  )
}
