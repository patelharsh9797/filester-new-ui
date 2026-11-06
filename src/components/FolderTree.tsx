import { useEffect, useState } from 'react'
import { Link, useParams } from '@tanstack/react-router'
import { ChevronRight } from 'lucide-react'
import { useLibrary } from '../lib/library'
import type { FolderNode } from '../lib/types'
import { FolderIcon } from './icons'

const KEY = 'filester-navigator.tree-open'
function loadOpen(): Set<string> {
  try { return new Set(JSON.parse(localStorage.getItem(KEY) || '[]')) } catch { return new Set() }
}

export function FolderTree({ onNavigate }: { onNavigate?: () => void }) {
  const lib = useLibrary()
  const { id: activeId } = useParams({ strict: false })
  const [open, setOpen] = useState<Set<string>>(loadOpen)

  // Auto-expand ancestors of the folder being viewed
  useEffect(() => {
    const node = activeId ? lib.byId.get(activeId) : undefined
    if (!node) return
    setOpen((o) => {
      const missing = node.pathIds.slice(0, -1).filter((id) => !o.has(id))
      return missing.length ? new Set([...o, ...missing]) : o
    })
  }, [activeId, lib.byId])

  useEffect(() => {
    try { localStorage.setItem(KEY, JSON.stringify([...open])) } catch { /* ignore */ }
  }, [open])

  const toggle = (id: string) => setOpen((o) => {
    const n = new Set(o)
    if (n.has(id)) n.delete(id)
    else n.add(id)
    return n
  })

  const render = (node: FolderNode, depth: number): React.ReactNode => {
    const isOpen = open.has(node.id)
    const hasKids = node.children.length > 0
    return (
      <li key={node.id}>
        <div className="flex items-center group" style={{ paddingLeft: depth * 12 }}>
          <button className={`size-5 grid place-items-center rounded text-faint hover:text-ink ${hasKids ? '' : 'invisible'}`} onClick={() => toggle(node.id)} aria-label={isOpen ? 'Collapse' : 'Expand'}>
            <ChevronRight className={`size-3.5 transition-transform ${isOpen ? 'rotate-90' : ''}`} />
          </button>
          <Link to="/folders/$id" params={{ id: node.id }} onClick={onNavigate}
            className="flex-1 min-w-0 flex items-center gap-1.5 rounded-md px-1.5 py-1 text-[13px]"
            activeOptions={{ includeSearch: false }}
            activeProps={{ className: 'bg-accent-soft text-accent-ink font-medium' }}
            inactiveProps={{ className: 'text-muted hover:bg-hover hover:text-ink' }}>
            <FolderIcon className="size-4 shrink-0" open={isOpen && hasKids} />
            <span className="truncate" title={node.pathText}>{node.name}</span>
            <span className="ml-auto pl-1 text-[11px] text-faint tabular opacity-0 group-hover:opacity-100">{node.totalFiles || ''}</span>
          </Link>
        </div>
        {isOpen && hasKids && <ul>{node.children.map((c) => render(lib.byId.get(c)!, depth + 1))}</ul>}
      </li>
    )
  }

  if (lib.foldersLoading) return <div className="px-3 space-y-1.5">{[70, 55, 80, 45].map((w) => <div key={w} className="h-5 rounded bg-raised animate-pulse" style={{ width: `${w}%` }} />)}</div>
  if (!lib.roots.length) return <p className="px-3 text-xs text-faint">No folders yet</p>
  return <ul className="px-1">{lib.roots.map((r) => render(r, 0))}</ul>
}
