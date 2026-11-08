import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { listBackups, runBackup } from '../lib/backup'
import type { FileRow } from '../lib/types'
import { useToast } from './toast'

export interface BackupJob {
  slug: string
  name: string
  size: number
  folder: string
  copied: number
  status: 'queued' | 'running' | 'done' | 'error' | 'cancelled'
  error?: string
}

interface Ctx {
  jobs: Map<string, BackupJob>
  enqueue: (files: BackupSource[]) => void
  cancel: (slug: string) => void
  clearFinished: () => void
}

export type BackupSource = Pick<FileRow, 'slug' | 'name' | 'size' | 'folderPath'>

const BackupCtx = createContext<Ctx | null>(null)
const CONCURRENT = 2

export function useBackupList() {
  return useQuery({ queryKey: ['backups'], queryFn: listBackups, staleTime: 60_000 })
}

export function BackupProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient()
  const toast = useToast()
  const [jobs, setJobs] = useState<Map<string, BackupJob>>(new Map())
  const controllers = useRef(new Map<string, AbortController>())
  const started = useRef(new Set<string>())

  const patch = useCallback((slug: string, p: Partial<BackupJob>) => setJobs((m) => {
    const j = m.get(slug)
    if (!j) return m
    const n = new Map(m)
    n.set(slug, { ...j, ...p })
    return n
  }), [])

  const enqueue = useCallback((files: BackupSource[]) => setJobs((m) => {
    const n = new Map(m)
    for (const f of files) {
      const cur = n.get(f.slug)
      if (cur && (cur.status === 'queued' || cur.status === 'running')) continue
      started.current.delete(f.slug)
      n.set(f.slug, { slug: f.slug, name: f.name, size: f.size, folder: f.folderPath, copied: 0, status: 'queued' })
    }
    return n
  }), [])

  const cancel = useCallback((slug: string) => {
    controllers.current.get(slug)?.abort()
    patch(slug, { status: 'cancelled' })
  }, [patch])

  const clearFinished = useCallback(() => setJobs((m) => new Map([...m].filter(([, j]) => j.status === 'queued' || j.status === 'running'))), [])

  useEffect(() => {
    const all = [...jobs.values()]
    const running = all.filter((j) => j.status === 'running').length
    for (const job of all.filter((j) => j.status === 'queued').slice(0, Math.max(0, CONCURRENT - running))) {
      if (started.current.has(job.slug)) continue
      started.current.add(job.slug)
      const ctl = new AbortController()
      controllers.current.set(job.slug, ctl)
      patch(job.slug, { status: 'running' })
      runBackup({ slug: job.slug, folder: job.folder }, (copied) => patch(job.slug, { copied }), ctl.signal)
        .then(() => {
          patch(job.slug, { status: 'done', copied: job.size })
          qc.invalidateQueries({ queryKey: ['backups'] })
        })
        .catch((e: Error) => {
          if (ctl.signal.aborted) return
          patch(job.slug, { status: 'error', error: e.message })
          if ((e as { code?: string }).code === 'LIMIT') toast('error', e.message)
        })
        .finally(() => controllers.current.delete(job.slug))
    }
  }, [jobs, patch, qc, toast])

  // Warn before closing the tab while backups are copying.
  const busy = [...jobs.values()].some((j) => j.status === 'running' || j.status === 'queued')
  useEffect(() => {
    if (!busy) return
    const h = (e: BeforeUnloadEvent) => e.preventDefault()
    window.addEventListener('beforeunload', h)
    return () => window.removeEventListener('beforeunload', h)
  }, [busy])

  return <BackupCtx.Provider value={{ jobs, enqueue, cancel, clearFinished }}>{children}</BackupCtx.Provider>
}

export function useBackups() {
  const c = useContext(BackupCtx)
  if (!c) throw new Error('useBackups outside BackupProvider')
  return c
}
