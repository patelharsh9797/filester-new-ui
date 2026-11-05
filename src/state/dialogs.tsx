import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { X } from 'lucide-react'

type Render = (close: () => void) => ReactNode
const Ctx = createContext<(render: Render) => void>(() => {})

export function DialogProvider({ children }: { children: ReactNode }) {
  const [stack, setStack] = useState<{ id: number; render: Render }[]>([])
  const seq = useRef(0)
  const open = useCallback((render: Render) => {
    const id = ++seq.current
    setStack((s) => [...s, { id, render }])
  }, [])
  const closeId = (id: number) => setStack((s) => s.filter((d) => d.id !== id))
  return (
    <Ctx.Provider value={open}>
      {children}
      {stack.map((d) => <div key={d.id}>{d.render(() => closeId(d.id))}</div>)}
    </Ctx.Provider>
  )
}

export const useOpenDialog = () => useContext(Ctx)

export function Modal({ title, onClose, children, footer, wide }: {
  title: ReactNode; onClose: () => void; children: ReactNode; footer?: ReactNode; wide?: boolean
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  return (
    <div className="fixed inset-0 z-50 flex items-start sm:items-center justify-center p-4 pt-[10vh] sm:pt-4 bg-black/40 backdrop-blur-[2px]" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div role="dialog" aria-modal className={`card shadow-2xl w-full ${wide ? 'max-w-xl' : 'max-w-md'} max-h-[80vh] flex flex-col`}>
        <div className="flex items-center justify-between px-5 pt-4 pb-2">
          <h2 className="text-base font-semibold">{title}</h2>
          <button className="btn-icon -mr-2" onClick={onClose} aria-label="Close"><X className="size-4" /></button>
        </div>
        <div className="px-5 pb-4 overflow-y-auto min-h-0">{children}</div>
        {footer && <div className="flex justify-end gap-2 px-5 py-3 border-t border-line">{footer}</div>}
      </div>
    </div>
  )
}

/** Promise-based helpers built on top of the dialog stack. */
export function useDialogs() {
  const open = useOpenDialog()

  const confirm = useCallback((o: { title: string; message: ReactNode; confirmLabel?: string; danger?: boolean }) =>
    new Promise<boolean>((resolve) => {
      open((close) => {
        const done = (v: boolean) => { resolve(v); close() }
        return (
          <Modal title={o.title} onClose={() => done(false)} footer={<>
            <button className="btn" onClick={() => done(false)}>Cancel</button>
            <button className={o.danger ? 'btn-danger' : 'btn-primary'} autoFocus onClick={() => done(true)}>{o.confirmLabel ?? 'Confirm'}</button>
          </>}>
            <div className="text-sm text-muted">{o.message}</div>
          </Modal>
        )
      })
    }), [open])

  const prompt = useCallback((o: { title: string; label: string; initial?: string; confirmLabel?: string; selectStem?: boolean }) =>
    new Promise<string | null>((resolve) => {
      open((close) => <PromptDialog {...o} onDone={(v) => { resolve(v); close() }} />)
    }), [open])

  return { confirm, prompt, open }
}

function PromptDialog({ title, label, initial = '', confirmLabel, selectStem, onDone }: {
  title: string; label: string; initial?: string; confirmLabel?: string; selectStem?: boolean; onDone: (v: string | null) => void
}) {
  const [value, setValue] = useState(initial)
  const ref = useRef<HTMLInputElement>(null)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.focus()
    const dot = initial.lastIndexOf('.')
    if (selectStem && dot > 0) el.setSelectionRange(0, dot)
    else el.select()
  }, [initial, selectStem])
  const submit = () => value.trim() && onDone(value.trim())
  return (
    <Modal title={title} onClose={() => onDone(null)} footer={<>
      <button className="btn" onClick={() => onDone(null)}>Cancel</button>
      <button className="btn-primary" disabled={!value.trim() || value.trim() === initial} onClick={submit}>{confirmLabel ?? 'Save'}</button>
    </>}>
      <label className="block text-sm text-muted mb-1.5">{label}</label>
      <input ref={ref} className="input" value={value} onChange={(e) => setValue(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && submit()} />
    </Modal>
  )
}
