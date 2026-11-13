import { useMemo, useRef, useState } from 'react'
import { AlertTriangle, ArrowRight, Check, Minus } from 'lucide-react'
import { Modal } from '../state/dialogs'
import { useLibrary } from '../lib/library'
import { plural } from '../lib/format'
import { DEFAULT_RENAME, planRenames, type RenameOptions, type RenameRow } from '../lib/rename'
import type { FileRow } from '../lib/types'

const KEY = 'fsnav.rename-options.v1'
function loadOptions(): RenameOptions {
  try { return { ...DEFAULT_RENAME, ...(JSON.parse(localStorage.getItem(KEY) || '{}') as Partial<RenameOptions>) } } catch { return DEFAULT_RENAME }
}
function saveOptions(o: RenameOptions) { try { localStorage.setItem(KEY, JSON.stringify(o)) } catch { /* fine */ } }

const TOKENS: { token: string; help: string }[] = [
  { token: '{folder}', help: 'folder name' },
  { token: '{n}', help: 'number' },
  { token: '{name}', help: 'current name' },
  { token: '{date}', help: 'upload date' },
]
const PREVIEW_MAX = 300

/** Bulk rename dialog. Resolves with the rows to rename, or null when cancelled. */
export function BulkRenameDialog({ files, onDone }: { files: FileRow[]; onDone: (rows: RenameRow<FileRow>[] | null) => void }) {
  const lib = useLibrary()
  const [o, setO] = useState<RenameOptions>(loadOptions)
  const set = <K extends keyof RenameOptions>(k: K, v: RenameOptions[K]) => setO((p) => ({ ...p, [k]: v }))
  const patternRef = useRef<HTMLInputElement>(null)

  const selected = useMemo(() => new Set(files.map((f) => f.id)), [files])
  const multiFolder = useMemo(() => new Set(files.map((f) => f.folder_id ?? '')).size > 1, [files])
  const plan = useMemo(() => planRenames(files, o,
    (id) => (id ? lib.byId.get(id)?.name ?? 'Folder' : 'Unfiled'),
    (k) => (k ? lib.filesByFolder.get(k) ?? [] : lib.rootFiles).filter((f) => !selected.has(f.id)).map((f) => f.name),
  ), [files, o, lib.byId, lib.filesByFolder, lib.rootFiles, selected])

  const insert = (token: string) => {
    const el = patternRef.current
    const at = el?.selectionStart ?? o.pattern.length
    const end = el?.selectionEnd ?? at
    set('pattern', o.pattern.slice(0, at) + token + o.pattern.slice(end))
    requestAnimationFrame(() => { el?.focus(); el?.setSelectionRange(at + token.length, at + token.length) })
  }
  const submit = () => { if (!plan.blocked && plan.toRename.length) { saveOptions(o); onDone(plan.toRename) } }
  const tab = (m: RenameOptions['mode'], label: string) =>
    <button type="button" role="tab" aria-selected={o.mode === m} className={o.mode === m ? 'chip-active' : 'chip'} onClick={() => set('mode', m)}>{label}</button>

  return (
    <Modal title={`Rename ${plural(files.length, 'file')}`} wide onClose={() => onDone(null)} footer={<>
      <button className="btn" onClick={() => onDone(null)}>Cancel</button>
      <button className="btn-primary" disabled={plan.blocked || !plan.toRename.length} onClick={submit}>
        {plan.toRename.length ? `Rename ${plural(plan.toRename.length, 'file')}` : 'Nothing to rename'}
      </button>
    </>}>
      <form className="space-y-3 text-sm" onSubmit={(e) => { e.preventDefault(); submit() }}>
        <div className="flex gap-1.5" role="tablist" aria-label="Rename mode">{tab('pattern', 'Pattern')}{tab('replace', 'Find & replace')}</div>

        {o.mode === 'pattern' ? (
          <>
            <label className="block space-y-1">
              <span className="text-xs text-muted">New name (the extension is kept)</span>
              <input ref={patternRef} className="input font-mono" value={o.pattern} onChange={(e) => set('pattern', e.target.value)} autoFocus spellCheck={false} aria-label="Pattern" />
            </label>
            <div className="flex flex-wrap gap-1.5" aria-label="Insert">
              {TOKENS.map((t) => (
                <button type="button" key={t.token} className="chip font-mono" onClick={() => insert(t.token)} title={`Insert ${t.help}`}>
                  {t.token} <span className="font-sans text-faint">{t.help}</span>
                </button>
              ))}
            </div>
            <div className="flex flex-wrap items-end gap-3">
              <label className="space-y-1">
                <span className="block text-xs text-muted">Start at</span>
                <input type="number" min={0} className="input w-20" value={o.start} onChange={(e) => set('start', Math.max(0, Number(e.target.value) || 0))} aria-label="Start at" />
              </label>
              <label className="space-y-1">
                <span className="block text-xs text-muted">Digits</span>
                <select className="input w-auto" value={o.pad} onChange={(e) => set('pad', Number(e.target.value))} aria-label="Digits">
                  <option value={0}>Auto</option><option value={1}>1</option><option value={2}>2 (01)</option><option value={3}>3 (001)</option><option value={4}>4 (0001)</option>
                </select>
              </label>
              <label className="space-y-1">
                <span className="block text-xs text-muted">Number in order of</span>
                <select className="input w-auto" value={o.order} onChange={(e) => set('order', e.target.value as RenameOptions['order'])} aria-label="Order">
                  <option value="current">As listed</option><option value="name">Current name</option><option value="date">Upload date (oldest first)</option>
                </select>
              </label>
              {multiFolder && (
                <label className="flex items-center gap-2 h-10">
                  <input type="checkbox" checked={o.perFolder} onChange={(e) => set('perFolder', e.target.checked)} />
                  Number each folder separately
                </label>
              )}
            </div>
          </>
        ) : (
          <div className="grid sm:grid-cols-2 gap-3">
            <label className="space-y-1">
              <span className="block text-xs text-muted">Find</span>
              <input className="input font-mono" value={o.find} onChange={(e) => set('find', e.target.value)} autoFocus spellCheck={false} aria-label="Find" />
            </label>
            <label className="space-y-1">
              <span className="block text-xs text-muted">Replace with</span>
              <input className="input font-mono" value={o.replace} onChange={(e) => set('replace', e.target.value)} spellCheck={false} aria-label="Replace with" />
            </label>
            <label className="flex items-center gap-2 sm:col-span-2">
              <input type="checkbox" checked={o.matchCase} onChange={(e) => set('matchCase', e.target.checked)} /> Match case
              <span className="text-xs text-faint ml-auto">Changes the name only, never the extension.</span>
            </label>
          </div>
        )}
        <button type="submit" hidden />
      </form>

      <div className="mt-4 rounded-lg border border-line">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 border-b border-line text-xs" aria-live="polite">
          <span><b className="text-ink">{plan.counts.rename}</b> <span className="text-muted">to rename</span></span>
          {plan.counts.same > 0 && <span className="text-muted">{plan.counts.same} unchanged</span>}
          {plan.counts.clash > 0 && <span className="text-danger font-medium">{plural(plan.counts.clash, 'name clash', )}</span>}
          {plan.counts.invalid > 0 && <span className="text-danger font-medium">{plan.counts.invalid} invalid</span>}
        </div>
        {plan.blocked && (
          <p className="flex gap-2 px-3 py-2 text-xs bg-danger-soft text-danger border-b border-line">
            <AlertTriangle className="size-3.5 shrink-0 mt-px" />
            Some files would end up with the same name in one folder, or with an invalid name. Add {'{n}'} or change the pattern; nothing is renamed until every name is fine.
          </p>
        )}
        <ul className="max-h-64 overflow-y-auto divide-y divide-line text-xs" aria-label="Preview">
          {plan.rows.slice(0, PREVIEW_MAX).map((r) => (
            <li key={r.file.id} className={`grid grid-cols-[1fr_auto_1fr] items-center gap-2 px-3 py-1.5 ${r.status === 'clash' || r.status === 'invalid' ? 'bg-danger-soft/50' : ''}`} data-status={r.status}>
              <span className="truncate text-muted" title={r.file.name}>{r.file.name}</span>
              {r.status === 'same' ? <Minus className="size-3.5 text-faint" /> : <ArrowRight className="size-3.5 text-faint" />}
              <span className={`truncate flex items-center gap-1 ${r.status === 'rename' ? 'text-ink font-medium' : r.status === 'same' ? 'text-faint' : 'text-danger'}`} title={r.reason ?? r.to}>
                {r.status === 'rename' && <Check className="size-3 text-ok shrink-0" />}
                {(r.status === 'clash' || r.status === 'invalid') && <AlertTriangle className="size-3 shrink-0" />}
                <span className="truncate">{r.status === 'same' ? 'unchanged' : r.to}</span>
              </span>
            </li>
          ))}
          {plan.rows.length > PREVIEW_MAX && <li className="px-3 py-1.5 text-faint">…and {plan.rows.length - PREVIEW_MAX} more</li>}
        </ul>
      </div>
    </Modal>
  )
}
