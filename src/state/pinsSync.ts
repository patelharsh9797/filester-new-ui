// Opt-in sync of pinned folders and saved searches across devices.
// The newest copy wins: this browser pulls on load and when you come back to the
// tab, and pushes a moment after each change. Turning sync on merges both copies.
import { useEffect, useRef } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useSession } from './session'
import { mergePins, onLocalPinsChange, pinsKeyFor, readPins, replacePins, setPinsLocal, type Pins } from './pins'

export interface PrefsState { enabled: boolean; prefs: (Pins & { updatedAt: number; syncId: string }) | null }

// Which synced copy this browser has already merged into (per account).
const joinedKey = (key: string) => `${key}:synced-with`
const joinedId = (key: string) => { try { return localStorage.getItem(joinedKey(key)) } catch { return null } }
const setJoined = (key: string, id: string | null) => { try { if (id) localStorage.setItem(joinedKey(key), id); else localStorage.removeItem(joinedKey(key)) } catch { /* fine */ } }

async function call<T>(method: 'GET' | 'PUT' | 'DELETE', body?: unknown): Promise<T> {
  const r = await fetch('/api/prefs', {
    method, credentials: 'same-origin', keepalive: method === 'PUT',
    headers: body ? { 'content-type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  })
  const d = (await r.json().catch(() => ({}))) as T & { success?: boolean; message?: string }
  if (!r.ok || d.success === false) throw new Error(d.message || `Sync failed (${r.status})`)
  return d
}
const getPrefs = () => call<PrefsState>('GET')
const pushPrefs = (p: Pins, syncId?: string) => call<{ updatedAt: number; syncId: string }>('PUT', { folders: p.folders, searches: p.searches, updatedAt: p.updatedAt, syncId })

export function usePrefsQuery() {
  return useQuery({ queryKey: ['prefs'], queryFn: getPrefs, staleTime: 15_000, refetchOnWindowFocus: true, retry: 1 })
}

/** Mounted once in the app shell. */
export function usePinsSync() {
  const session = useSession()
  const key = pinsKeyFor(session?.username ?? 'anonymous')
  const qc = useQueryClient()
  const q = usePrefsQuery()
  const enabled = !!q.data?.enabled
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Pull: the first time this browser sees a synced copy, merge its own pins in (so nothing
  // is lost); after that, the newest copy wins.
  useEffect(() => {
    const remote = q.data?.prefs
    if (!q.data?.enabled || !remote) return
    const local = readPins(key)
    const save = (p: Pins) => pushPrefs(p, remote.syncId)
      .then((r) => qc.setQueryData<PrefsState>(['prefs'], { enabled: true, prefs: { ...p, updatedAt: p.updatedAt ?? 0, syncId: r.syncId } }))
      .catch(() => {})
    if (joinedId(key) !== remote.syncId) {
      setJoined(key, remote.syncId)
      const merged = mergePins(remote, local)
      if (merged.folders.length === remote.folders.length && merged.searches.length === remote.searches.length) replacePins(key, remote)
      else { setPinsLocal(key, merged); save(readPins(key)) }
    } else if (remote.updatedAt > (local.updatedAt ?? 0)) replacePins(key, remote)
    else if ((local.updatedAt ?? 0) > remote.updatedAt) save(local)
  }, [q.data, key, qc])

  // Push: shortly after each change made here.
  useEffect(() => {
    if (!enabled) return
    const off = onLocalPinsChange((k) => {
      if (k !== key) return
      if (timer.current) clearTimeout(timer.current)
      timer.current = setTimeout(() => {
        const local = readPins(key)
        const syncId = qc.getQueryData<PrefsState>(['prefs'])?.prefs?.syncId
        pushPrefs(local, syncId)
          .then((r) => qc.setQueryData<PrefsState>(['prefs'], { enabled: true, prefs: { ...local, updatedAt: local.updatedAt ?? 0, syncId: r.syncId } }))
          .catch(() => qc.invalidateQueries({ queryKey: ['prefs'] }))
      }, 800)
    })
    return () => { off(); if (timer.current) clearTimeout(timer.current) }
  }, [enabled, key, qc])
}

/** Turn sync on (merging this browser's pins with any synced copy) or off. */
export function usePrefsSyncToggle() {
  const session = useSession()
  const key = pinsKeyFor(session?.username ?? 'anonymous')
  const qc = useQueryClient()
  return {
    async enable() {
      const current = await getPrefs()
      const merged = mergePins(current.prefs ?? { folders: [], searches: [] }, readPins(key))
      setPinsLocal(key, merged)
      const local = readPins(key)
      const r = await pushPrefs(local, current.prefs?.syncId)
      setJoined(key, r.syncId)
      qc.setQueryData<PrefsState>(['prefs'], { enabled: true, prefs: { ...local, updatedAt: local.updatedAt ?? 0, syncId: r.syncId } })
    },
    async disable() {
      await call('DELETE')
      setJoined(key, null)
      qc.setQueryData<PrefsState>(['prefs'], { enabled: false, prefs: null })
    },
  }
}
