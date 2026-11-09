import { useEffect, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { CheckCircle2, DatabaseBackup, ExternalLink, Eye, EyeOff, Loader2, ShieldCheck, Trash2, Unplug } from 'lucide-react'
import { connectBucket, disconnectBucket, saveBackupSettings } from '../lib/backup'
import { formatDate } from '../lib/format'
import { useBackupConfig } from '../state/backups'
import { Modal, useDialogs } from '../state/dialogs'
import { useToast } from '../state/toast'

const DASH = 'https://dash.cloudflare.com/?to=/:account'

/** Accepts a bare account id or the S3 endpoint URL (https://<id>.r2.cloudflarestorage.com). */
function accountIdFrom(v: string) {
  const m = /([0-9a-f]{32})\.r2\.cloudflarestorage\.com/i.exec(v)
  return (m ? m[1] : v).trim().toLowerCase()
}

/** Connect / manage the user's own R2 bucket for backups. */
export function BackupSetup({ compact }: { compact?: boolean }) {
  const cfg = useBackupConfig()
  if (cfg.isPending) return <div className="card p-4 text-sm text-faint"><Loader2 className="inline size-4 animate-spin mr-2" />Checking backup settings…</div>
  if (cfg.error) return <div className="card p-4 text-sm text-danger">Couldn’t load backup settings: {(cfg.error as Error).message}</div>
  return cfg.data?.connected && cfg.data.config ? <Connected /> : <ConnectForm compact={compact} />
}

function ConnectForm({ compact }: { compact?: boolean }) {
  const qc = useQueryClient()
  const toast = useToast()
  const [accountId, setAccountId] = useState('')
  const [bucket, setBucket] = useState('')
  const [accessKeyId, setAccessKeyId] = useState('')
  const [secretAccessKey, setSecret] = useState('')
  const [showSecret, setShowSecret] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      await connectBucket({ accountId: accountIdFrom(accountId), bucket: bucket.trim().toLowerCase(), accessKeyId: accessKeyId.trim(), secretAccessKey: secretAccessKey.trim() })
      setSecret('')
      toast('success', 'Bucket connected — backups are on')
      await qc.invalidateQueries({ queryKey: ['backup-config'] })
      qc.invalidateQueries({ queryKey: ['backups'] })
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const step = (n: number, body: React.ReactNode) => (
    <li className="flex gap-3">
      <span className="size-6 shrink-0 rounded-full bg-raised grid place-items-center text-xs font-semibold">{n}</span>
      <div className="text-sm text-muted pt-0.5 min-w-0">{body}</div>
    </li>
  )

  return (
    <div className="card p-4 sm:p-5 space-y-4">
      <div className="flex items-start gap-3">
        <DatabaseBackup className="size-5 text-accent-ink shrink-0 mt-0.5" />
        <div>
          <h2 className="font-semibold">Turn on backups with your own R2 bucket</h2>
          <p className="text-sm text-muted">Backups are off by default. Connect a Cloudflare R2 bucket you own and copies of your Filester files go there — your storage, your control. R2 includes 10 GB free.</p>
        </div>
      </div>

      {!compact && (
        <ol className="space-y-3">
          {step(1, <>In Cloudflare, <a className="text-accent-ink underline inline-flex items-center gap-0.5" href={`${DASH}/r2/new`} target="_blank" rel="noreferrer">create an R2 bucket <ExternalLink className="size-3" /></a> (for example <code>filester-backups</code>).</>)}
          {step(2, <>Go to <a className="text-accent-ink underline inline-flex items-center gap-0.5" href={`${DASH}/r2/api-tokens`} target="_blank" rel="noreferrer">R2 → Manage API tokens <ExternalLink className="size-3" /></a> and create a token with permission <b className="text-ink">Object Read &amp; Write</b>, limited to <b className="text-ink">only that bucket</b>.</>)}
          {step(3, <>Copy the <b className="text-ink">Access Key ID</b>, <b className="text-ink">Secret Access Key</b> (shown once) and your <b className="text-ink">Account ID</b> (or the S3 endpoint URL — either works) into the form below.</>)}
        </ol>
      )}

      <form className="grid sm:grid-cols-2 gap-3" onSubmit={submit} autoComplete="off">
        <label className="space-y-1">
          <span className="text-xs text-muted">Account ID or S3 endpoint</span>
          <input className="input font-mono text-xs" value={accountId} onChange={(e) => setAccountId(e.target.value)} placeholder="32-character id" required spellCheck={false} />
        </label>
        <label className="space-y-1">
          <span className="text-xs text-muted">Bucket name</span>
          <input className="input font-mono text-xs" value={bucket} onChange={(e) => setBucket(e.target.value)} placeholder="filester-backups" required spellCheck={false} />
        </label>
        <label className="space-y-1">
          <span className="text-xs text-muted">Access Key ID</span>
          <input className="input font-mono text-xs" value={accessKeyId} onChange={(e) => setAccessKeyId(e.target.value)} required spellCheck={false} />
        </label>
        <label className="space-y-1">
          <span className="text-xs text-muted">Secret Access Key</span>
          <div className="relative">
            <input className="input font-mono text-xs pr-10" type={showSecret ? 'text' : 'password'} value={secretAccessKey} onChange={(e) => setSecret(e.target.value)} required spellCheck={false} autoComplete="new-password" />
            <button type="button" className="absolute right-1 top-1/2 -translate-y-1/2 btn-icon" onClick={() => setShowSecret((v) => !v)} aria-label={showSecret ? 'Hide secret' : 'Show secret'}>
              {showSecret ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
            </button>
          </div>
        </label>
        {error && <p className="sm:col-span-2 text-sm text-danger">{error}</p>}
        <div className="sm:col-span-2 flex flex-wrap items-center gap-3">
          <button className="btn-primary" disabled={busy}>{busy ? <Loader2 className="size-4 animate-spin" /> : <CheckCircle2 className="size-4" />}Test &amp; connect</button>
          <span className="text-xs text-faint">We write, read and delete a small test file to make sure the token works.</span>
        </div>
      </form>

      <p className="flex gap-2 text-xs text-faint border-t border-line pt-3">
        <ShieldCheck className="size-4 shrink-0" />
        <span>Your keys are encrypted and never shown again or sent back to your browser. Backups only ever go to this bucket. The person running this app could technically decrypt stored keys, so use a token limited to this one bucket — then a leaked key can’t touch anything else in your Cloudflare account. You can disconnect at any time.</span>
      </p>
    </div>
  )
}

function Connected() {
  const cfg = useBackupConfig().data!.config!
  const qc = useQueryClient()
  const toast = useToast()
  const { open, confirm } = useDialogs()
  const [retention, setRetention] = useState(String(cfg.retentionDays))
  const [limit, setLimit] = useState(String(cfg.limitGb))
  const [saving, setSaving] = useState(false)
  useEffect(() => { setRetention(String(cfg.retentionDays)); setLimit(String(cfg.limitGb)) }, [cfg.retentionDays, cfg.limitGb])
  const dirty = retention !== String(cfg.retentionDays) || limit !== String(cfg.limitGb)

  const save = async () => {
    setSaving(true)
    try {
      await saveBackupSettings({ retentionDays: Number(retention), limitGb: Number(limit) })
      toast('success', 'Backup settings saved')
      await qc.invalidateQueries({ queryKey: ['backup-config'] })
      qc.invalidateQueries({ queryKey: ['backups'] })
    } catch (e) {
      toast('error', (e as Error).message)
    } finally {
      setSaving(false)
    }
  }

  const disconnect = () => new Promise<void>((resolve) => {
    open((close) => <DisconnectDialog bucket={cfg.bucket} onDone={async (choice) => {
      close()
      if (choice) {
        if (choice === 'delete' && !(await confirm({ title: 'Delete all backups?', message: `Every backup this app made in “${cfg.bucket}” will be permanently deleted.`, confirmLabel: 'Delete and disconnect', danger: true }))) return resolve()
        try {
          const r = await disconnectBucket(choice === 'delete')
          toast('success', choice === 'delete' ? `Disconnected and deleted ${r.deleted} backups` : 'Disconnected — your keys were removed')
          qc.removeQueries({ queryKey: ['backups'] })
          await qc.invalidateQueries({ queryKey: ['backup-config'] })
        } catch (e) {
          toast('error', (e as Error).message)
        }
      }
      resolve()
    }} />)
  })

  return (
    <div className="card p-4 sm:p-5 space-y-4">
      <div className="flex items-start gap-3">
        <CheckCircle2 className="size-5 text-ok shrink-0 mt-0.5" />
        <div className="flex-1 min-w-0">
          <h2 className="font-semibold">Backups are on</h2>
          <p className="text-sm text-muted">Saving to your R2 bucket <b className="text-ink">{cfg.bucket}</b> · key {cfg.accessKeyHint} · connected {formatDate(cfg.connectedAt)}</p>
        </div>
        <button className="btn h-8 text-danger" onClick={disconnect}><Unplug className="size-4" /> Disconnect</button>
      </div>
      <div className="grid sm:grid-cols-2 gap-3">
        <label className="space-y-1">
          <span className="text-xs text-muted">Delete backups after (days)</span>
          <input className="input" type="number" min={1} max={365} value={retention} onChange={(e) => setRetention(e.target.value)} />
        </label>
        <label className="space-y-1">
          <span className="text-xs text-muted">Stop new backups above (GB)</span>
          <input className="input" type="number" min={0.1} step={0.1} value={limit} onChange={(e) => setLimit(e.target.value)} />
        </label>
      </div>
      <div className="flex items-center gap-3">
        <button className="btn-primary" disabled={!dirty || saving} onClick={save}>{saving && <Loader2 className="size-4 animate-spin" />}Save</button>
        <span className="text-xs text-faint">R2’s free tier covers 10 GB; above that Cloudflare bills about $0.015 per GB-month.</span>
      </div>
    </div>
  )
}

function DisconnectDialog({ bucket, onDone }: { bucket: string; onDone: (choice: 'keep' | 'delete' | null) => void }) {
  const option = (choice: 'keep' | 'delete', icon: React.ReactNode, title: string, detail: React.ReactNode, danger?: boolean) => (
    <button onClick={() => onDone(choice)}
      className={`w-full flex items-start gap-3 rounded-lg border px-3 py-2.5 text-left transition-colors ${danger ? 'border-danger/40 hover:bg-danger-soft' : 'border-line hover:bg-hover'}`}>
      <span className={`mt-0.5 shrink-0 ${danger ? 'text-danger' : 'text-muted'}`}>{icon}</span>
      <span className="min-w-0">
        <span className={`block text-sm font-medium ${danger ? 'text-danger' : ''}`}>{title}</span>
        <span className="block text-xs text-muted">{detail}</span>
      </span>
    </button>
  )
  return (
    <Modal title="Disconnect your bucket?" onClose={() => onDone(null)} footer={<button className="btn" onClick={() => onDone(null)}>Cancel</button>}>
      <p className="text-sm text-muted mb-3">Your stored keys are deleted and backups turn off for your account.</p>
      <div className="space-y-2">
        {option('keep', <Unplug className="size-4" />, 'Disconnect, keep backups', <>Files already in <b className="text-ink">{bucket}</b> stay there — manage them in the Cloudflare dashboard.</>)}
        {option('delete', <Trash2 className="size-4" />, 'Delete backups & disconnect', <>Permanently deletes every backup this app made in <b>{bucket}</b>, then disconnects.</>, true)}
      </div>
    </Modal>
  )
}

