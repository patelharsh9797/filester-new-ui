import { useEffect, useState } from 'react'
import { Gauge } from 'lucide-react'
import type { DailyUsage } from '../lib/backup'
import { formatBytes } from '../lib/format'

/** Always one decimal (formatBytes drops it above 10), so used + left visibly add up. */
const fmt = (n: number) => {
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = n > 0 ? Math.min(units.length - 1, Math.floor(Math.log(n) / Math.log(1024))) : 0
  return i === 0 ? `${n} B` : `${(n / 1024 ** i).toFixed(1).replace(/\.0$/, '')} ${units[i]}`
}

function countdown(to: string) {
  const mins = Math.max(0, Math.round((Date.parse(to) - Date.now()) / 60_000))
  return mins >= 60 ? `${Math.floor(mins / 60)}h ${mins % 60}m` : `${mins}m`
}

/** Today's fair-use backup allowance: used / left / when it resets (in the viewer's local time). */
export function DailyUsageMeter({ usage }: { usage: DailyUsage }) {
  // Re-render every minute so the countdown stays current.
  const [, tick] = useState(0)
  useEffect(() => { const id = setInterval(() => tick((n) => n + 1), 60_000); return () => clearInterval(id) }, [])

  if (usage.cap === null) {
    return <p className="flex items-center gap-2 text-xs text-faint"><Gauge className="size-4" />No daily backup limit on this app. {formatBytes(usage.used)} copied today.</p>
  }
  const pct = Math.min(100, (usage.used / usage.cap) * 100)
  const left = usage.remaining ?? 0
  const resetLocal = new Date(usage.resetsAt).toLocaleString(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit' })
  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 text-sm">
        <span className="flex items-center gap-1.5 text-muted"><Gauge className="size-4" />Today’s backup allowance</span>
        <span className="tabular"><b>{fmt(usage.used)}</b> <span className="text-muted">of {fmt(usage.cap)} used</span></span>
      </div>
      <div className="h-2 rounded-full bg-raised overflow-hidden" role="progressbar" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100} aria-label="Daily backup allowance used">
        <div className={`h-full ${pct >= 100 ? 'bg-danger' : pct > 80 ? 'bg-accent' : 'bg-ok'}`} style={{ width: `${Math.max(pct, usage.used ? 1 : 0)}%` }} />
      </div>
      <p className="text-xs text-faint tabular" title="Counts data actually copied through this app today. Failed or cancelled backups only count what went through.">
        <span className={left <= 0 ? 'text-danger font-medium' : 'text-ink'}>{left <= 0 ? 'Nothing left today' : `${fmt(left)} left`}</span>
        {' · '}resets in {countdown(usage.resetsAt)} ({resetLocal})
      </p>
    </div>
  )
}
