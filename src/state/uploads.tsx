import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { uploadFile, type UploadHandle } from '../lib/upload'

export interface UploadItem {
  id: number
  file: File
  folder: string | null
  loaded: number
  status: 'queued' | 'uploading' | 'done' | 'error' | 'cancelled'
  error?: string
  url?: string
  startedAt?: number
}

interface Ctx {
  items: UploadItem[]
  add: (files: File[], folder: string | null) => void
  cancel: (id: number) => void
  clearFinished: () => void
}

const UploadCtx = createContext<Ctx | null>(null)
const CONCURRENT = 2
let seq = 0

export function UploadProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient()
  const [items, setItems] = useState<UploadItem[]>([])
  const handles = useRef(new Map<number, UploadHandle>())
  const started = useRef(new Set<number>())

  const patch = (id: number, p: Partial<UploadItem>) => setItems((list) => list.map((i) => (i.id === id ? { ...i, ...p } : i)))

  const add = useCallback((files: File[], folder: string | null) => {
    setItems((list) => [...list, ...files.map((file) => ({ id: ++seq, file, folder, loaded: 0, status: 'queued' as const }))])
  }, [])

  const cancel = useCallback((id: number) => {
    handles.current.get(id)?.abort()
    patch(id, { status: 'cancelled' })
  }, [])

  const clearFinished = useCallback(() => setItems((l) => l.filter((i) => i.status === 'queued' || i.status === 'uploading')), [])

  // Scheduler: start queued items while fewer than CONCURRENT are running.
  useEffect(() => {
    const running = items.filter((i) => i.status === 'uploading').length
    const next = items.filter((i) => i.status === 'queued').slice(0, Math.max(0, CONCURRENT - running))
    for (const item of next) {
      if (started.current.has(item.id)) continue
      started.current.add(item.id)
      patch(item.id, { status: 'uploading', startedAt: Date.now() })
      const h = uploadFile(item.file, item.folder, (loaded) => patch(item.id, { loaded }))
      handles.current.set(item.id, h)
      h.promise.then(
        (r) => {
          patch(item.id, { status: 'done', loaded: item.file.size, url: r.url })
          qc.invalidateQueries({ queryKey: ['files'] })
          qc.invalidateQueries({ queryKey: ['folders'] })
          qc.invalidateQueries({ queryKey: ['account'] })
          qc.invalidateQueries({ queryKey: ['activity'] })
        },
        (e: Error) => setItems((list) => list.map((i) => (i.id === item.id && i.status !== 'cancelled' ? { ...i, status: 'error', error: e.message } : i))),
      ).finally(() => handles.current.delete(item.id))
    }
  }, [items, qc])

  // Warn before closing the tab mid-upload.
  useEffect(() => {
    const busy = items.some((i) => i.status === 'uploading' || i.status === 'queued')
    if (!busy) return
    const h = (e: BeforeUnloadEvent) => e.preventDefault()
    window.addEventListener('beforeunload', h)
    return () => window.removeEventListener('beforeunload', h)
  }, [items])

  return <UploadCtx.Provider value={{ items, add, cancel, clearFinished }}>{children}</UploadCtx.Provider>
}

export function useUploads() {
  const c = useContext(UploadCtx)
  if (!c) throw new Error('useUploads outside UploadProvider')
  return c
}
