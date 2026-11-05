import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { MoreHorizontal } from 'lucide-react'

export interface MenuItem {
  label: string
  icon?: ReactNode
  onClick: () => void
  danger?: boolean
  hidden?: boolean
}

/** Kebab menu rendered in a portal so it never gets clipped by scroll containers. */
export function Menu({ items, label = 'Actions', trigger }: { items: (MenuItem | 'sep')[]; label?: string; trigger?: ReactNode }) {
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState({ top: 0, left: 0 })
  const btn = useRef<HTMLButtonElement>(null)
  const menu = useRef<HTMLDivElement>(null)

  useLayoutEffect(() => {
    if (!open || !btn.current || !menu.current) return
    const r = btn.current.getBoundingClientRect()
    const m = menu.current.getBoundingClientRect()
    const top = r.bottom + 4 + m.height > window.innerHeight ? Math.max(8, r.top - m.height - 4) : r.bottom + 4
    const left = Math.max(8, Math.min(window.innerWidth - m.width - 8, r.right - m.width))
    setPos({ top, left })
  }, [open])

  useEffect(() => {
    if (!open) return
    const close = (e: Event) => {
      if (e instanceof KeyboardEvent && e.key !== 'Escape') return
      if (e.target instanceof Node && (menu.current?.contains(e.target) || btn.current?.contains(e.target))) return
      setOpen(false)
    }
    const closeAlways = () => setOpen(false)
    window.addEventListener('mousedown', close)
    window.addEventListener('keydown', close)
    window.addEventListener('scroll', closeAlways, true)
    window.addEventListener('resize', closeAlways)
    return () => {
      window.removeEventListener('mousedown', close)
      window.removeEventListener('keydown', close)
      window.removeEventListener('scroll', closeAlways, true)
      window.removeEventListener('resize', closeAlways)
    }
  }, [open])

  const visible = items.filter((i) => i === 'sep' || !i.hidden)

  return (
    <>
      <button ref={btn} className={trigger ? 'btn' : 'btn-icon'} aria-label={label} aria-haspopup="menu" aria-expanded={open}
        onClick={(e) => { e.stopPropagation(); setOpen((o) => !o) }}>
        {trigger ?? <MoreHorizontal className="size-4" />}
      </button>
      {open && createPortal(
        <div ref={menu} role="menu" className="card fixed z-[60] min-w-44 py-1 shadow-xl" style={pos} onClick={(e) => e.stopPropagation()}>
          {visible.map((it, i) => it === 'sep'
            ? <div key={i} className="my-1 border-t border-line" />
            : (
              <button key={i} role="menuitem" onClick={() => { setOpen(false); it.onClick() }}
                className={`w-full flex items-center gap-2.5 px-3 py-1.5 text-sm text-left hover:bg-hover ${it.danger ? 'text-danger' : ''}`}>
                <span className="size-4 grid place-items-center text-current opacity-80">{it.icon}</span>{it.label}
              </button>
            ))}
        </div>,
        document.body,
      )}
    </>
  )
}
