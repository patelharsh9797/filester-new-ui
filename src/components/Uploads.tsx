import { useRef, useState } from 'react'
import { Check, ChevronDown, ChevronUp, Copy, FolderOpen, Upload, X } from 'lucide-react'
import { useUploads } from '../state/uploads'
import { useLibrary } from '../lib/library'
import { formatBytes, kindOf } from '../lib/format'
import { Modal } from '../state/dialogs'
import { copyText, useActions } from '../state/actions'
import { useToast } from '../state/toast'
import { FileKindIcon, FolderIcon } from './icons'

/** Floating panel listing upload progress. */
export function UploadDock() {
  const { items, cancel, clearFinished } = useUploads()
  const toast = useToast()
  const [collapsed, setCollapsed] = useState(false)
  if (!items.length) return null
  const active = items.filter((i) => i.status === 'uploading' || i.status === 'queued')
  const total = items.reduce((n, i) => n + i.file.size, 0)
  const loaded = items.reduce((n, i) => n + (i.status === 'done' ? i.file.size : i.loaded), 0)

  return (
    <div className="card shadow-2xl overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-2.5 border-b border-line">
        <Upload className="size-4 text-muted" />
        <span className="text-sm font-medium flex-1">
          {active.length ? `Uploading ${active.length} of ${items.length}` : `${items.filter((i) => i.status === 'done').length} uploaded`}
          <span className="text-faint font-normal"> · {formatBytes(loaded)} / {formatBytes(total)}</span>
        </span>
        <button className="btn-icon size-7" onClick={() => setCollapsed((c) => !c)} aria-label="Toggle">{collapsed ? <ChevronUp className="size-4" /> : <ChevronDown className="size-4" />}</button>
        {!active.length && <button className="btn-icon size-7" onClick={clearFinished} aria-label="Clear"><X className="size-4" /></button>}
      </div>
      {!collapsed && (
        <ul className="max-h-72 overflow-y-auto divide-y divide-line">
          {items.map((i) => {
            const pct = i.file.size ? Math.round((i.loaded / i.file.size) * 100) : 100
            const elapsed = i.startedAt ? (Date.now() - i.startedAt) / 1000 : 0
            const speed = elapsed > 1 ? i.loaded / elapsed : 0
            return (
              <li key={i.id} className="px-3 py-2">
                <div className="flex items-center gap-2 text-sm">
                  <FileKindIcon kind={kindOf(i.file.name, i.file.type)} />
                  <span className="truncate flex-1" title={i.file.name}>{i.file.name}</span>
                  {i.status === 'done' && i.url && <button className="btn-icon size-6" onClick={() => copyText(i.url!, toast)} aria-label="Copy link"><Copy className="size-3.5" /></button>}
                  {i.status === 'done' && <Check className="size-4 text-ok" />}
                  {(i.status === 'uploading' || i.status === 'queued') && <button className="btn-icon size-6" onClick={() => cancel(i.id)} aria-label="Cancel"><X className="size-3.5" /></button>}
                </div>
                {i.status === 'uploading' && (
                  <>
                    <div className="mt-1.5 h-1.5 rounded-full bg-raised overflow-hidden"><div className="h-full bg-accent transition-[width]" style={{ width: `${pct}%` }} /></div>
                    <div className="mt-1 text-[11px] text-faint tabular">{pct}% · {formatBytes(i.loaded)} of {formatBytes(i.file.size)}{speed ? ` · ${formatBytes(speed)}/s` : ''}</div>
                  </>
                )}
                {i.status === 'queued' && <div className="text-[11px] text-faint">Waiting…</div>}
                {i.status === 'error' && <div className="text-[11px] text-danger">{i.error}</div>}
                {i.status === 'cancelled' && <div className="text-[11px] text-faint">Cancelled</div>}
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

const MAX = 10 * 1024 ** 3

/** Pick files + destination folder, then queue them. */
export function UploadDialog({ folder: initialFolder, initialFiles = [], onClose }: { folder: string | null; initialFiles?: File[]; onClose: () => void }) {
  const lib = useLibrary()
  const { add } = useUploads()
  const { pickFolder } = useActions()
  const [folder, setFolder] = useState(initialFolder)
  const [files, setFiles] = useState<File[]>(initialFiles)
  const [drag, setDrag] = useState(false)
  const input = useRef<HTMLInputElement>(null)
  const tooBig = files.filter((f) => f.size > MAX)
  const ok = files.filter((f) => f.size <= MAX)

  const choose = async () => {
    const d = await pickFolder('Upload to…', { confirmLabel: 'Choose', current: undefined })
    if (d !== undefined) setFolder(d)
  }

  return (
    <Modal title="Upload files" wide onClose={onClose} footer={<>
      <button className="btn" onClick={onClose}>Cancel</button>
      <button className="btn-primary" disabled={!ok.length} onClick={() => { add(ok, folder); onClose() }}>
        <Upload className="size-4" /> Upload {ok.length || ''} {ok.length === 1 ? 'file' : 'files'}
      </button>
    </>}>
      <div className="flex items-center gap-2 mb-3 text-sm">
        <span className="text-muted">To</span>
        <button className="btn h-8 min-w-0" onClick={choose}>
          <FolderIcon className="size-4" /><span className="truncate max-w-[300px]">{folder ? lib.byId.get(folder)?.pathText ?? 'Folder' : 'Top level'}</span><FolderOpen className="size-3.5 text-faint" />
        </button>
      </div>
      <div onDragOver={(e) => { e.preventDefault(); setDrag(true) }} onDragLeave={() => setDrag(false)}
        onDrop={(e) => { e.preventDefault(); setDrag(false); setFiles((f) => [...f, ...Array.from(e.dataTransfer.files)]) }}
        onClick={() => input.current?.click()}
        className={`rounded-xl border-2 border-dashed p-8 text-center cursor-pointer transition-colors ${drag ? 'border-accent bg-accent-soft' : 'border-line hover:bg-raised'}`}>
        <Upload className="size-6 mx-auto text-faint mb-2" />
        <p className="text-sm">Drop files here or <span className="text-accent-ink font-medium">browse</span></p>
        <p className="text-xs text-faint mt-1">Up to 10 GB per file · large files are uploaded in resumable chunks</p>
        <input ref={input} type="file" multiple hidden onChange={(e) => { setFiles((f) => [...f, ...Array.from(e.target.files ?? [])]); e.target.value = '' }} />
      </div>
      {files.length > 0 && (
        <ul className="mt-3 max-h-48 overflow-y-auto divide-y divide-line text-sm">
          {files.map((f, i) => (
            <li key={i} className="flex items-center gap-2 py-1.5">
              <FileKindIcon kind={kindOf(f.name, f.type)} />
              <span className={`truncate flex-1 ${f.size > MAX ? 'text-danger line-through' : ''}`}>{f.name}</span>
              <span className="text-xs text-faint tabular">{formatBytes(f.size)}</span>
              <button className="btn-icon size-6" onClick={() => setFiles((l) => l.filter((_, j) => j !== i))} aria-label="Remove"><X className="size-3.5" /></button>
            </li>
          ))}
        </ul>
      )}
      {tooBig.length > 0 && <p className="text-xs text-danger mt-2">{tooBig.length} file(s) exceed the 10 GB limit and will be skipped.</p>}
    </Modal>
  )
}
