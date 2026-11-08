import { useCallback, useMemo, useSyncExternalStore } from 'react'
import type { FileActivity } from './api'
import { useLibrary } from './library'
import type { FileRow } from './types'

/**
 * Filester deletes files that go unused. Its own pages disagree on the rule:
 *  - FAQ:      no downloads for 35 days
 *  - API docs: no views or downloads for 45 days
 * We default to the stricter FAQ rule so warnings come early.
 */
export type ExpiryRule = 'faq' | 'docs'
export const RULES: Record<ExpiryRule, { label: string; days: number; detail: string }> = {
  faq: { label: '35 days without downloads', days: 35, detail: 'Filester FAQ — stricter, the default' },
  docs: { label: '45 days without views or downloads', days: 45, detail: 'Filester API docs' },
}

export type RiskLevel = 'critical' | 'soon' | 'watch' | 'ok'
/** Days-left thresholds for each warning level. */
export const LEVELS = { critical: 3, soon: 7, watch: 14 } as const

export interface ExpiringFile extends FileRow {
  activity: FileActivity | null
  /** The activity date the rule counts from */
  lastActive: string
  expiresAt: string
  /** Fractional days until deletion (negative = overdue) */
  daysLeft: number
  level: RiskLevel
}

// ---- rule preference (per browser) -----------------------------------------
const KEY = 'filester-navigator.expiry-rule'
const listeners = new Set<() => void>()
function readRule(): ExpiryRule {
  try { return localStorage.getItem(KEY) === 'docs' ? 'docs' : 'faq' } catch { return 'faq' }
}
export function useExpiryRule() {
  const rule = useSyncExternalStore(
    (cb) => { listeners.add(cb); return () => listeners.delete(cb) },
    readRule,
    () => 'faq' as ExpiryRule,
  )
  const setRule = useCallback((r: ExpiryRule) => {
    try { localStorage.setItem(KEY, r) } catch { /* per-tab only */ }
    listeners.forEach((l) => l())
  }, [])
  return [rule, setRule] as const
}

// ---- computation ------------------------------------------------------------
const valid = (iso: string | undefined) => !!iso && !Number.isNaN(Date.parse(iso)) && Date.parse(iso) > Date.UTC(2000, 0, 1)
const latest = (...dates: (string | undefined)[]) =>
  dates.filter(valid).sort().at(-1) as string | undefined

export function levelFor(daysLeft: number): RiskLevel {
  if (daysLeft <= LEVELS.critical) return 'critical'
  if (daysLeft <= LEVELS.soon) return 'soon'
  if (daysLeft <= LEVELS.watch) return 'watch'
  return 'ok'
}

export function computeExpiry(file: FileRow, activity: FileActivity | null, rule: ExpiryRule, now = Date.now()): ExpiringFile {
  const counted = rule === 'faq'
    ? latest(activity?.lastDownloaded)
    : latest(activity?.lastDownloaded, activity?.lastViewed)
  const lastActive = counted ?? latest(activity?.uploadDate, file.created_at) ?? file.created_at
  const expires = Date.parse(lastActive) + RULES[rule].days * 86_400_000
  const daysLeft = (expires - now) / 86_400_000
  return { ...file, activity, lastActive, expiresAt: new Date(expires).toISOString(), daysLeft, level: levelFor(daysLeft) }
}

/** Every file with its deletion estimate, most at-risk first. */
export function useExpiring() {
  const lib = useLibrary()
  const [rule] = useExpiryRule()

  const files = useMemo(() => {
    const map = lib.activity
    return lib.files
      .map((f) => computeExpiry(f, map?.get(f.slug) ?? null, rule))
      .sort((a, b) => a.daysLeft - b.daysLeft)
  }, [lib.files, lib.activity, rule])

  const counts = useMemo(() => {
    const c = { critical: 0, soon: 0, watch: 0, ok: 0 }
    for (const f of files) c[f.level]++
    return c
  }, [files])

  return {
    files,
    counts,
    /** Files deleted within 7 days */
    urgent: counts.critical + counts.soon,
    rule,
    loading: lib.filesLoading,
    activityError: lib.activityError ? new Error(lib.activityError) : null,
    /** True when activity data is missing and we fell back to upload dates */
    estimated: !lib.activity,
  }
}
