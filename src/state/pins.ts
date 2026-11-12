// Pinned folders and saved searches. Kept in this browser only (per Filester
// account), so nothing extra is stored on the server; open tabs stay in sync.
import { useCallback, useSyncExternalStore } from 'react'
import { useSession } from './session'

export type SavedPage = '/files' | '/folders' | '/expiring'
export interface SavedSearch {
  id: string
  name: string
  page: SavedPage
  /** The page's URL search params (query text and filters) */
  search: Record<string, string>
  createdAt: string
}
export interface Pins {
  folders: string[]
  searches: SavedSearch[]
}

const EMPTY: Pins = { folders: [], searches: [] }
const keyFor = (user: string) => `fsnav.pins.v1:${user.toLowerCase()}`
const listeners = new Set<() => void>()
const cache = new Map<string, { raw: string | null; value: Pins }>()

function read(key: string): Pins {
  let raw: string | null = null
  try { raw = localStorage.getItem(key) } catch { /* storage blocked */ }
  const hit = cache.get(key)
  if (hit && hit.raw === raw) return hit.value
  let value = EMPTY
  try {
    const p = raw ? (JSON.parse(raw) as Partial<Pins>) : null
    if (p) value = {
      folders: Array.isArray(p.folders) ? p.folders.filter((x) => typeof x === 'string') : [],
      searches: Array.isArray(p.searches) ? p.searches.filter((s) => s && typeof s.name === 'string' && typeof s.page === 'string' && s.search && typeof s.search === 'object') : [],
    }
  } catch { /* corrupt: start over */ }
  cache.set(key, { raw, value })
  return value
}

function write(key: string, next: Pins) {
  try { localStorage.setItem(key, JSON.stringify(next)) } catch { /* storage full or blocked */ }
  cache.delete(key)
  listeners.forEach((l) => l())
}

if (typeof window !== 'undefined') {
  window.addEventListener('storage', (e) => { if (e.key?.startsWith('fsnav.pins.')) listeners.forEach((l) => l()) })
}

/** Drop empty values so saved URLs stay clean. */
export function cleanSearch(search: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(search)) if (typeof v === 'string' && v.trim()) out[k] = v
  return out
}

/** A readable default name for a search, e.g. “kyoto · Images”. */
export function describeSearch(search: Record<string, string>): string {
  const parts = [search.q && `“${search.q}”`, ...Object.entries(search).filter(([k]) => k !== 'q').map(([, v]) => v)].filter(Boolean)
  return parts.join(' · ').slice(0, 60) || 'Saved search'
}

export function usePins() {
  const session = useSession()
  const key = keyFor(session?.username ?? 'anonymous')
  const pins = useSyncExternalStore(
    (cb) => { listeners.add(cb); return () => listeners.delete(cb) },
    () => read(key),
    () => EMPTY,
  )

  const update = useCallback((fn: (p: Pins) => Pins) => write(key, fn(read(key))), [key])

  return {
    ...pins,
    isPinned: (id: string) => pins.folders.includes(id),
    togglePin: (id: string) => update((p) => ({ ...p, folders: p.folders.includes(id) ? p.folders.filter((x) => x !== id) : [...p.folders, id] })),
    unpin: (id: string) => update((p) => ({ ...p, folders: p.folders.filter((x) => x !== id) })),
    movePin: (id: string, by: -1 | 1) => update((p) => {
      const i = p.folders.indexOf(id), j = i + by
      if (i < 0 || j < 0 || j >= p.folders.length) return p
      const f = [...p.folders];
      [f[i], f[j]] = [f[j], f[i]]
      return { ...p, folders: f }
    }),
    findSearch: (page: SavedPage, search: Record<string, string>) =>
      pins.searches.find((s) => s.page === page && JSON.stringify(sorted(s.search)) === JSON.stringify(sorted(search))),
    saveSearch: (name: string, page: SavedPage, search: Record<string, string>) => update((p) => ({
      ...p,
      searches: [...p.searches, { id: Math.random().toString(36).slice(2, 10), name: name.trim().slice(0, 60), page, search, createdAt: new Date().toISOString() }],
    })),
    renameSearch: (id: string, name: string) => update((p) => ({ ...p, searches: p.searches.map((s) => (s.id === id ? { ...s, name: name.trim().slice(0, 60) } : s)) })),
    removeSearch: (id: string) => update((p) => ({ ...p, searches: p.searches.filter((s) => s.id !== id) })),
  }
}

const sorted = (o: Record<string, string>) => Object.fromEntries(Object.entries(o).sort(([a], [b]) => a.localeCompare(b)))
