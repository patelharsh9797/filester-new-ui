import { useState } from 'react'
import { Loader2, RefreshCcw } from 'lucide-react'
import { usePrefsQuery, usePrefsSyncToggle } from '../state/pinsSync'
import { usePins } from '../state/pins'
import { useToast } from '../state/toast'
import { formatRelative, plural } from '../lib/format'

/** Settings: sync pinned folders and saved searches across devices (opt-in). */
export function SyncSettings() {
  const q = usePrefsQuery()
  const toggle = usePrefsSyncToggle()
  const pins = usePins()
  const toast = useToast()
  const [busy, setBusy] = useState(false)
  const on = !!q.data?.enabled

  const flip = async () => {
    setBusy(true)
    try {
      if (on) { await toggle.disable(); toast('success', 'Sync turned off. This browser keeps its own copy.') }
      else { await toggle.enable(); toast('success', 'Sync is on. Sign in on your other devices to see the same sidebar.') }
    } catch (e) {
      toast('error', (e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="card p-4 space-y-3" aria-labelledby="sync-h">
      <div className="flex items-start gap-3">
        <div className="flex-1 min-w-0">
          <h2 id="sync-h" className="font-semibold flex items-center gap-1.5"><RefreshCcw className="size-4" /> Sync across devices</h2>
          <p className="text-xs text-muted mt-0.5">
            Keep {plural(pins.folders.length, 'pinned folder')} and {plural(pins.searches.length, 'saved search', )} the same on your phone and computer.
            {on ? ' Changes show up on your other devices within a few seconds of opening the app there.' : ' Off: each browser keeps its own.'}
          </p>
        </div>
        <button role="switch" aria-checked={on} aria-label="Sync pinned folders and saved searches" disabled={busy || q.isLoading} onClick={flip}
          className={`relative h-6 w-11 shrink-0 rounded-full transition-colors disabled:opacity-60 ${on ? 'bg-accent' : 'bg-line'}`}>
          <span className={`absolute top-0.5 size-5 rounded-full bg-white shadow transition-all ${on ? 'left-[22px]' : 'left-0.5'}`} />
          {busy && <Loader2 className="size-3 animate-spin absolute inset-0 m-auto text-ink" />}
        </button>
      </div>
      <p className="text-xs text-faint">
        {on && q.data?.prefs?.updatedAt ? `Last change synced ${formatRelative(new Date(q.data.prefs.updatedAt).toISOString())}. ` : ''}
        When on, a copy is stored on this site’s server, encrypted so it only opens for your account. Turning it off deletes that copy.
      </p>
    </section>
  )
}
