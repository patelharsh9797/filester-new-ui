import { useState } from 'react'
import { AlertTriangle, Check, ChevronDown, ChevronUp, Loader2, X } from 'lucide-react'
import { useTasks, type Task } from '../state/tasks'

/** Progress cards for bulk operations, stacked with the backup and upload docks. */
export function TaskDock() {
  const { tasks, cancel, dismiss } = useTasks()
  if (!tasks.length) return null
  return <>{tasks.map((t) => <TaskCard key={t.id} t={t} onCancel={() => cancel(t.id)} onDismiss={() => dismiss(t.id)} />)}</>
}

function TaskCard({ t, onCancel, onDismiss }: { t: Task; onCancel: () => void; onDismiss: () => void }) {
  const [showErrors, setShowErrors] = useState(false)
  const pct = t.total ? Math.round((t.done / t.total) * 100) : 100
  const ok = t.done - t.failed
  const running = t.status === 'running'
  return (
    <div className="card shadow-2xl overflow-hidden" role="status" aria-live="polite">
      <div className="px-3 pt-2.5 pb-2">
        <div className="flex items-center gap-2">
          {running ? <Loader2 className="size-4 animate-spin text-accent" />
            : t.failed ? <AlertTriangle className="size-4 text-accent-ink" />
            : t.status === 'cancelled' ? <X className="size-4 text-muted" />
            : <Check className="size-4 text-ok" />}
          <span className="text-sm font-medium flex-1 truncate">
            {t.title}
            <span className="text-faint font-normal">
              {running ? ` · ${t.done} of ${t.total}` : t.status === 'cancelled' ? ` · cancelled after ${t.done} of ${t.total}` : ` · done`}
            </span>
          </span>
          {running
            ? <button className="text-xs text-danger hover:underline px-1" onClick={onCancel}>Cancel</button>
            : <button className="btn-icon size-7" onClick={onDismiss} aria-label="Dismiss"><X className="size-4" /></button>}
        </div>
        <div className="mt-2 h-2 rounded-full bg-raised overflow-hidden">
          <div className={`h-full transition-[width] ${t.failed ? 'bg-accent' : 'bg-ok'}`} style={{ width: `${pct}%` }} />
        </div>
        <div className="mt-1 flex flex-wrap gap-x-3 text-[11px] text-faint tabular">
          <span>{pct}%</span>
          <span className="text-ok">{ok} updated</span>
          {t.failed > 0 && (
            <button className="text-danger hover:underline inline-flex items-center gap-0.5" onClick={() => setShowErrors((s) => !s)}>
              {t.failed} failed {showErrors ? <ChevronUp className="size-3" /> : <ChevronDown className="size-3" />}
            </button>
          )}
          {running && t.current && <span className="truncate max-w-[200px]">Now: {t.current}</span>}
        </div>
      </div>
      {showErrors && t.errors.length > 0 && (
        <ul className="max-h-40 overflow-y-auto border-t border-line px-3 py-2 space-y-1 text-[11px] text-danger">
          {t.errors.map((e, i) => <li key={i} className="break-words">{e}</li>)}
        </ul>
      )}
    </div>
  )
}
