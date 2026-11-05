import { createContext, useCallback, useContext, useState, type ReactNode } from 'react'
import { CircleAlert, CircleCheck, Info, X } from 'lucide-react'

type Kind = 'success' | 'error' | 'info'
interface Toast { id: number; kind: Kind; message: string }

const Ctx = createContext<(kind: Kind, message: string) => void>(() => {})
let seq = 0

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])
  const dismiss = (id: number) => setToasts((t) => t.filter((x) => x.id !== id))
  const push = useCallback((kind: Kind, message: string) => {
    const id = ++seq
    setToasts((t) => [...t.slice(-3), { id, kind, message }])
    setTimeout(() => dismiss(id), kind === 'error' ? 7000 : 3500)
  }, [])

  return (
    <Ctx.Provider value={push}>
      {children}
      <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-[100] flex flex-col gap-2 w-[min(420px,calc(100vw-32px))]" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className="card shadow-lg flex items-start gap-2.5 px-3.5 py-3 text-sm">
            {t.kind === 'success' && <CircleCheck className="size-4 mt-0.5 shrink-0 text-ok" />}
            {t.kind === 'error' && <CircleAlert className="size-4 mt-0.5 shrink-0 text-danger" />}
            {t.kind === 'info' && <Info className="size-4 mt-0.5 shrink-0 text-muted" />}
            <span className="flex-1 break-words">{t.message}</span>
            <button className="text-faint hover:text-ink" onClick={() => dismiss(t.id)} aria-label="Dismiss"><X className="size-4" /></button>
          </div>
        ))}
      </div>
    </Ctx.Provider>
  )
}

export const useToast = () => useContext(Ctx)
