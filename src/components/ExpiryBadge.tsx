import { Clock } from 'lucide-react'
import type { RiskLevel } from '../lib/expiry'

const STYLE: Record<RiskLevel, string> = {
  critical: 'bg-danger-soft text-danger',
  soon: 'bg-accent-soft text-accent-ink',
  watch: 'bg-raised text-muted',
  ok: 'bg-ok-soft text-ok',
}

export function daysLeftText(daysLeft: number): string {
  if (daysLeft < 0) return 'Overdue'
  if (daysLeft < 1) return Math.max(1, Math.round(daysLeft * 24)) + 'h left'
  const d = Math.floor(daysLeft)
  return `${d} day${d === 1 ? '' : 's'} left`
}

export function ExpiryBadge({ daysLeft, level, compact }: { daysLeft: number; level: RiskLevel; compact?: boolean }) {
  return (
    <span className={`shrink-0 inline-flex items-center gap-1 rounded-full px-2 h-6 text-xs font-medium whitespace-nowrap tabular ${STYLE[level]}`}
      title={daysLeft < 0 ? 'Past the inactivity limit — may already be deleted' : `About ${Math.floor(Math.max(0, daysLeft))} days until Filester's inactivity limit`}>
      <Clock className="size-3" />{compact ? (daysLeft < 0 ? '!' : `${Math.max(0, Math.floor(daysLeft))}d`) : daysLeftText(daysLeft)}
    </span>
  )
}
