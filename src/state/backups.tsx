import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { discardPending, getBackupConfig, listBackups, runBackup, type MultipartState } from '../lib/backup'
import type { FileRow } from '../lib/types'
import { useToast } from './toast'

export type BackupStatus = 'queued' | 'running' | 'done' | 'error' | 'cancelled' | 'interrupted'

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
  /** Progress of a multipart copy, kept so the backup can resume after an interruption */
  multipart?: MultipartState | null
}

export type BackupSource = Pick<FileRow, 'slug' | 'name' | 'size' | 'folderPath'> & { type?: string }

export interface BackupStats {
  total: number
  queued: number
  running: number
  done: number
  failed: number
  cancelled: number
  interrupted: number
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
  /** Continue interrupted backups from their last finished part */
  resumeInterrupted: () => void
  /** Drop interrupted backups and free their space in R2 */
  discardInterrupted: () => Promise<void>
  clearFinished: () => void
}

const BackupCtx = createContext<Ctx | null>(null)
/** Files copied at the same time (each copies 2 parts in parallel). */
const CONCURRENT = 3
const STORE = 'fsnav.backup-queue.v1'
let seq = 0

/** Whether this user has connected their own R2 bucket (backups are off until they do). */
export function useBackupConfig() {
  return useQuery({ queryKey: ['backup-config'], queryFn: getBackupConfig, staleTime: 5 * 60_000 })
}

export function useBackupList() {
  const cfg = useBackupConfig()
  return useQuery({ queryKey: ['backups'], queryFn: listBackups, staleTime: 60_000, enabled: !!cfg.data?.connected })
}

/** Restore the queue saved before the tab was closed, killed or reloaded. */
function loadQueue(): Map<string, BackupJob> {
  try {
    const raw = localStorage.getItem(STORE)
    if (!raw) return new Map()
    const list = JSON.parse(raw) as BackupJob[]
    const m = new Map<string, BackupJob>()
    for (const j of list) {
      seq = Math.max(seq, j.seq)
      // Anything that was in flight when the page went away is now interrupted.
      const status: BackupStatus = j.status === 'running' || j.status === 'queued' ? 'interrupted' : j.status
      m.set(j.slug, { ...j, status, startedAt: undefined })
    }
    return m
  } catch {
    return new Map()
  }
}

function saveQueue(jobs: Map<string, BackupJob>) {
  try {
    // Keep only what still matters after a reload.
    const keep = [...jobs.values()].filter((j) => j.status !== 'done' && j.status !== 'cancelled')
    if (keep.length) localStorage.setItem(STORE, JSON.stringify(keep))
    else localStorage.removeItem(STORE)
  } catch { /* storage full or unavailable: the in-memory queue still works */ }
}

export function BackupProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient()
  const toast = useToast()
  const [jobs, setJobs] = useState<Map<string, BackupJob>>(loadQueue)
  const controllers = useRef(new Map<string, AbortController>())
  const started = useRef(new Set<string>())

  useEffect(() => saveQueue(jobs), [jobs])

  // Tell the user once if a previous session left backups unfinished.
  const announced = useRef(false)
  useEffect(() => {
    if (announced.current) return
    announced.current = true
    const n = [...jobs.values()].filter((j) => j.status === 'interrupted').length
    if (n) toast('info', `${n} backup${n === 1 ? ' was' : 's were'} interrupted — resume or discard ${n === 1 ? 'it' : 'them'} in the backup panel`)
  }, [jobs, toast])

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
      // A fresh request restarts from scratch (the server releases any old unfinished parts).
      n.set(f.slug, { slug: f.slug, name: f.name, size: f.size, type: f.type ?? '', folder: f.folderPath, copied: 0, status: 'queued', seq: ++seq, multipart: null })
    }
    return n
  }), [])

  const cancel = useCallback((slug: string) => {
    const ctl = controllers.current.get(slug)
    if (ctl) ctl.abort()
    else {
      // Not running in this tab (queued or interrupted): release its parts directly.
      const j = jobs.get(slug)
      if (j?.multipart) discardPending([j.multipart.key]).catch(() => {})
    }
    patch(slug, { status: 'cancelled', finishedAt: Date.now(), multipart: null })
  }, [patch, jobs])

  const cancelAll = useCallback(() => {
    controllers.current.forEach((c) => c.abort())
    setJobs((m) => new Map([...m].map(([k, j]) => [k, j.status === 'queued' || j.status === 'running' ? { ...j, status: 'cancelled' as const, finishedAt: Date.now() } : j])))
  }, [])

  const requeue = (statuses: BackupStatus[]) => setJobs((m) => new Map([...m].map(([k, j]) => {
    if (!statuses.includes(j.status)) return [k, j]
    started.current.delete(k)
    // Keep j.multipart: the copy continues from the last finished part.
    return [k, { ...j, status: 'queued' as const, error: undefined, startedAt: undefined, finishedAt: undefined, seq: ++seq }]
  })))

  const retryFailed = useCallback(() => requeue(['error', 'cancelled', 'interrupted']), [])
  const resumeInterrupted = useCallback(() => requeue(['interrupted']), [])

  const discardInterrupted = useCallback(async () => {
    const list = [...jobs.values()].filter((j) => j.status === 'interrupted' || j.status === 'error')
    const keys = list.map((j) => j.multipart?.key).filter((k): k is string => !!k)
    if (keys.length) await discardPending(keys).catch(() => {})
    setJobs((m) => new Map([...m].filter(([, j]) => j.status !== 'interrupted' && j.status !== 'error')))
    qc.invalidateQueries({ queryKey: ['backups'] })
  }, [jobs, qc])

  const clearFinished = useCallback(() => setJobs((m) => new Map([...m].filter(([, j]) => j.status === 'queued' || j.status === 'running' || j.status === 'interrupted'))), [])

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
      const attempt = (resume: MultipartState | null | undefined): Promise<unknown> =>
        runBackup({ slug: job.slug, type: job.type }, (copied) => patch(job.slug, { copied }), ctl.signal, {
          resume,
          onState: (s) => patch(job.slug, { multipart: s ? { ...s, done: [...s.done] } : null }),
        }).catch((e: Error & { code?: string }) => {
          // The unfinished upload was cleaned up meanwhile: start this file again from scratch.
          if (e.code === 'GONE' && resume) return attempt(null)
          throw e
        })
      attempt(job.multipart)
        .then(() => {
          patch(job.slug, { status: 'done', copied: job.size, finishedAt: Date.now(), multipart: null })
          qc.invalidateQueries({ queryKey: ['backups'] })
          qc.invalidateQueries({ queryKey: ['backup-config'] }) // daily usage
        })
        .catch((e: Error & { code?: string }) => {
          if (ctl.signal.aborted) return
          patch(job.slug, { status: 'error', error: e.message, finishedAt: Date.now() })
          qc.invalidateQueries({ queryKey: ['backup-config'] })
          if (e.code === 'LIMIT' || e.code === 'CAP') toast('error', e.message)
        })
        .finally(() => controllers.current.delete(job.slug))
    }
  }, [jobs, patch, qc, toast])

  const active = [...jobs.values()].some((j) => j.status === 'running' || j.status === 'queued')

  // Keep the screen awake while copying so the phone doesn't sleep and pause the tab.
  useEffect(() => {
    if (!active || !('wakeLock' in navigator)) return
    let lock: WakeLockSentinel | null = null
    let cancelled = false
    const acquire = () => navigator.wakeLock.request('screen').then((l) => { if (cancelled) l.release(); else lock = l }).catch(() => {})
    acquire()
    // The lock is dropped when the tab is hidden; take it again when we come back.
    const onVisible = () => { if (document.visibilityState === 'visible') acquire() }
    document.addEventListener('visibilitychange', onVisible)
    return () => { cancelled = true; document.removeEventListener('visibilitychange', onVisible); lock?.release().catch(() => {}) }
  }, [active])

  // When a batch finishes, refresh the file list so last-download dates update.
  // Filester updates its download stats in delayed batches (a few minutes), so check
  // again later too. Each check is one export request, which doesn't use the API key.
  const wasActive = useRef(false)
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
      interrupted: count('interrupted'), bytesTotal, bytesDone, speed, eta: speed > 0 ? remaining / speed : null, active,
    }
  }, [jobs, bytesDone, speed, active])

  // Warn before closing the tab while backups are copying.
  useEffect(() => {
    if (!active) return
    const h = (e: BeforeUnloadEvent) => e.preventDefault()
    window.addEventListener('beforeunload', h)
    return () => window.removeEventListener('beforeunload', h)
  }, [active])

  return (
    <BackupCtx.Provider value={{ jobs, stats, enqueue, cancel, cancelAll, retryFailed, resumeInterrupted, discardInterrupted, clearFinished }}>
      {children}
    </BackupCtx.Provider>
  )
}

export function useBackups() {
  const c = useContext(BackupCtx)
  if (!c) throw new Error('useBackups outside BackupProvider')
  return c
}
