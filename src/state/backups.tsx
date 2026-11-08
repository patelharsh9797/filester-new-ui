import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { listBackups, runBackup } from '../lib/backup'
import type { FileRow } from '../lib/types'
import { useToast } from './toast'

export type BackupStatus = 'queued' | 'running' | 'done' | 'error' | 'cancelled'

export interface BackupJob {
  slug: string
  name: string
  size: number
  type: string
  folder: string
  copied: number
  status: BackupStatus
  error?: string
  /** Order in which it was queued (stable sort) */
  seq: number
  startedAt?: number
  finishedAt?: number
}

export type BackupSource = Pick<FileRow, 'slug' | 'name' | 'size' | 'folderPath'> & { type?: string }

export interface BackupStats {
  total: number
  queued: number
  running: number
  done: number
  failed: number
  cancelled: number
  bytesTotal: number
  bytesDone: number
  /** Bytes per second over the last few seconds */
  speed: number
  /** Seconds remaining at the current speed, or null */
  eta: number | null
  active: boolean
}

interface Ctx {
  jobs: Map<string, BackupJob>
  stats: BackupStats
  enqueue: (files: BackupSource[]) => void
  cancel: (slug: string) => void
  cancelAll: () => void
  retryFailed: () => void
  clearFinished: () => void
}

const BackupCtx = createContext<Ctx | null>(null)
/** Files copied at the same time (each copies 2 parts in parallel). */
const CONCURRENT = 3
let seq = 0

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
      n.set(f.slug, { slug: f.slug, name: f.name, size: f.size, type: f.type ?? '', folder: f.folderPath, copied: 0, status: 'queued', seq: ++seq })
    }
    return n
  }), [])

  const cancel = useCallback((slug: string) => {
    controllers.current.get(slug)?.abort()
    patch(slug, { status: 'cancelled', finishedAt: Date.now() })
  }, [patch])

  const cancelAll = useCallback(() => {
    controllers.current.forEach((c) => c.abort())
    setJobs((m) => new Map([...m].map(([k, j]) => [k, j.status === 'queued' || j.status === 'running' ? { ...j, status: 'cancelled' as const, finishedAt: Date.now() } : j])))
  }, [])

  const retryFailed = useCallback(() => setJobs((m) => new Map([...m].map(([k, j]) => {
    if (j.status !== 'error' && j.status !== 'cancelled') return [k, j]
    started.current.delete(k)
    return [k, { ...j, status: 'queued' as const, copied: 0, error: undefined, startedAt: undefined, finishedAt: undefined, seq: ++seq }]
  }))), [])

  const clearFinished = useCallback(() => setJobs((m) => new Map([...m].filter(([, j]) => j.status === 'queued' || j.status === 'running'))), [])

  // Scheduler: keep CONCURRENT copies running, oldest queued first.
  useEffect(() => {
    const all = [...jobs.values()]
    const running = all.filter((j) => j.status === 'running').length
    const next = all.filter((j) => j.status === 'queued').sort((a, b) => a.seq - b.seq).slice(0, Math.max(0, CONCURRENT - running))
    for (const job of next) {
      if (started.current.has(job.slug)) continue
      started.current.add(job.slug)
      const ctl = new AbortController()
      controllers.current.set(job.slug, ctl)
      patch(job.slug, { status: 'running', startedAt: Date.now() })
      runBackup({ slug: job.slug, folder: job.folder, type: job.type }, (copied) => patch(job.slug, { copied }), ctl.signal)
        .then((b) => {
          patch(job.slug, { status: 'done', copied: b.size, size: b.size, finishedAt: Date.now() })
          qc.invalidateQueries({ queryKey: ['backups'] })
        })
        .catch((e: Error) => {
          if (ctl.signal.aborted) return
          patch(job.slug, { status: 'error', error: e.message, finishedAt: Date.now() })
          if ((e as { code?: string }).code === 'LIMIT') toast('error', e.message)
        })
        .finally(() => controllers.current.delete(job.slug))
    }
  }, [jobs, patch, qc, toast])

  // When a batch finishes, refresh the file list so last-download dates update.
  const wasActive = useRef(false)
  const active = [...jobs.values()].some((j) => j.status === 'running' || j.status === 'queued')
  // Filester updates its download stats in delayed batches (a few minutes), so check
  // again later too. Each check is one export request, which doesn't use the API key.
  useEffect(() => {
    if (wasActive.current && !active) {
      qc.invalidateQueries({ queryKey: ['files'] })
      qc.invalidateQueries({ queryKey: ['backups'] })
      const timers = [3, 8].map((min) => setTimeout(() => qc.invalidateQueries({ queryKey: ['files'] }), min * 60_000))
      wasActive.current = active
      return () => timers.forEach(clearTimeout)
    }
    wasActive.current = active
  }, [active, qc])

  // Throughput: sample bytes copied once a second, average over ~5 s.
  const [speed, setSpeed] = useState(0)
  const samples = useRef<{ t: number; b: number }[]>([])
  const bytesDone = useMemo(() => [...jobs.values()].reduce((n, j) => n + (j.status === 'done' ? j.size : j.status === 'running' ? j.copied : 0), 0), [jobs])
  const bytesRef = useRef(0)
  bytesRef.current = bytesDone
  useEffect(() => {
    if (!active) { samples.current = []; setSpeed(0); return }
    const id = setInterval(() => {
      const now = Date.now()
      samples.current = [...samples.current.filter((s) => now - s.t < 6000), { t: now, b: bytesRef.current }]
      const first = samples.current[0]
      const last = samples.current[samples.current.length - 1]
      setSpeed(last.t > first.t ? Math.max(0, (last.b - first.b) / ((last.t - first.t) / 1000)) : 0)
    }, 1000)
    return () => clearInterval(id)
  }, [active])

  const stats = useMemo<BackupStats>(() => {
    const all = [...jobs.values()]
    const count = (s: BackupStatus) => all.filter((j) => j.status === s).length
    const counted = all.filter((j) => j.status !== 'cancelled')
    const bytesTotal = counted.reduce((n, j) => n + j.size, 0)
    const remaining = all.filter((j) => j.status === 'queued' || j.status === 'running').reduce((n, j) => n + (j.size - j.copied), 0)
    return {
      total: counted.length, queued: count('queued'), running: count('running'), done: count('done'), failed: count('error'), cancelled: count('cancelled'),
      bytesTotal, bytesDone, speed, eta: speed > 0 ? remaining / speed : null, active,
    }
  }, [jobs, bytesDone, speed, active])

  // Warn before closing the tab while backups are copying.
  useEffect(() => {
    if (!active) return
    const h = (e: BeforeUnloadEvent) => e.preventDefault()
    window.addEventListener('beforeunload', h)
    return () => window.removeEventListener('beforeunload', h)
  }, [active])

  return <BackupCtx.Provider value={{ jobs, stats, enqueue, cancel, cancelAll, retryFailed, clearFinished }}>{children}</BackupCtx.Provider>
}

export function useBackups() {
  const c = useContext(BackupCtx)
  if (!c) throw new Error('useBackups outside BackupProvider')
  return c
}
