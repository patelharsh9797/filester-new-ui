import { useMemo, useState } from 'react'
import { Link, useNavigate, useSearch } from '@tanstack/react-router'
import { Copy as CopyIcon, ExternalLink, Trash2, X } from 'lucide-react'
import { useQueryClient } from '@tanstack/react-query'
import { useDuplicates, type DuplicateGroup } from '../lib/duplicates'
import { useLibrary } from '../lib/library'
import { deleteFiles } from '../lib/api'
import { formatBytes, formatDate } from '../lib/format'
import { FileKindIcon, FolderIcon } from '../components/icons'
import { useDialogs } from '../state/dialogs'
import { useTasks } from '../state/tasks'
import { useToast } from '../state/toast'
import { copyText } from '../state/actions'
import { Skeleton } from './Overview'

type KeepRule = 'oldest' | 'newest' | 'downloads'
const KEEP_RULES: Record<KeepRule, string> = {
  oldest: 'Keep the oldest copy (its link may already be shared)',
  newest: 'Keep the newest copy',
  downloads: 'Keep the most-downloaded copy',
}

function pick(g: DuplicateGroup, rule: KeepRule) {
  if (rule === 'oldest') return g.copies[0].id
  if (rule === 'newest') return g.copies[g.copies.length - 1].id
  return [...g.copies].sort((a, b) => b.downloads - a.downloads || a.id - b.id)[0].id
}

export function DuplicatesPage() {
  const params = useSearch({ from: '/_app/duplicates' })
  const navigate = useNavigate({ from: '/duplicates' })
  const dup = useDuplicates()
  const lib = useLibrary()
  const qc = useQueryClient()
  const tasks = useTasks()
  const toast = useToast()
  const { confirm } = useDialogs()
  const [rule, setRule] = useState<KeepRule>('oldest')
  /** Per-group overrides of which copy to keep */
  const [keep, setKeep] = useState<Map<string, number>>(new Map())
  const [busy, setBusy] = useState(false)

  const folder = params.in ?? null
  const identicalOnly = params.match !== 'name'
  const groups = useMemo(() => dup.groups.filter((g) =>
    (!identicalOnly || g.identical) && (!folder || (g.folderId ?? 'root') === folder)), [dup.groups, identicalOnly, folder])

  const keepId = (g: DuplicateGroup) => keep.get(g.key) ?? pick(g, rule)
  const toDelete = groups.flatMap((g) => g.copies.filter((c) => c.id !== keepId(g)))
  const freed = toDelete.reduce((n, f) => n + f.size, 0)

  const run = async () => {
    const ok = await confirm({
      title: `Delete ${toDelete.length} extra ${toDelete.length === 1 ? 'copy' : 'copies'}?`,
      message: <>One copy of each file is kept ({groups.length} files). {formatBytes(freed)} will be permanently deleted from Filester. This cannot be undone.</>,
      confirmLabel: 'Delete copies', danger: true,
    })
    if (!ok) return
    setBusy(true)
    const task = tasks.start('Deleting duplicate copies', toDelete.length, 'deleted')
    let deleted = 0
    for (let i = 0; i < toDelete.length && !task.signal.aborted; i += 50) {
      const batch = toDelete.slice(i, i + 50)
      task.working(batch[0].name)
      try {
        await deleteFiles(batch.map((f) => f.slug))
        deleted += batch.length
        batch.forEach((f) => task.step(f.name))
      } catch (e) {
        batch.forEach((f) => task.step(f.name, (e as Error).message))
      }
    }
    task.finish()
    setBusy(false)
    setKeep(new Map())
    toast(deleted === toDelete.length ? 'success' : 'error', `Deleted ${deleted} of ${toDelete.length} copies`)
    await Promise.all([qc.invalidateQueries({ queryKey: ['files'] }), qc.invalidateQueries({ queryKey: ['folders'] }), qc.invalidateQueries({ queryKey: ['account'] })])
  }

  return (
    <div className="max-w-6xl mx-auto p-4 sm:p-6 space-y-5">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Duplicates</h1>
        <p className="text-sm text-muted max-w-3xl">Files with the same name in the same folder. Pick which copy to keep, then delete the rest in one go.</p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button className={identicalOnly ? 'chip-active' : 'chip'} onClick={() => navigate({ search: (p) => ({ ...p, match: undefined }), replace: true })}>Same name and size</button>
        <button className={!identicalOnly ? 'chip-active' : 'chip'} onClick={() => navigate({ search: (p) => ({ ...p, match: 'name' }), replace: true })}>Same name (any size)</button>
        {folder && (
          <span className="chip-active">
            <FolderIcon className="size-3" /> {folder === 'root' ? 'Top level' : lib.byId.get(folder)?.name ?? 'Folder'}
            <button onClick={() => navigate({ search: (p) => ({ ...p, in: undefined }), replace: true })} aria-label="Show all folders"><X className="size-3" /></button>
          </span>
        )}
        <select className="input h-8 w-auto text-xs ml-auto" value={rule} onChange={(e) => { setRule(e.target.value as KeepRule); setKeep(new Map()) }} aria-label="Which copy to keep">
          {(Object.keys(KEEP_RULES) as KeepRule[]).map((r) => <option key={r} value={r}>{KEEP_RULES[r]}</option>)}
        </select>
      </div>

      {dup.loading ? <Skeleton rows={6} /> : groups.length === 0 ? (
        <div className="card p-10 text-center">
          <p className="font-medium">No duplicates found</p>
          <p className="text-sm text-muted mt-1">{identicalOnly && dup.groups.length > 0 ? <>Some files share a name but differ in size. <button className="text-accent-ink underline" onClick={() => navigate({ search: (p) => ({ ...p, match: 'name' }), replace: true })}>Show them</button></> : 'Every file name is unique within its folder.'}</p>
        </div>
      ) : (
        <>
          <div className="card p-4 flex flex-wrap items-center gap-3">
            <div className="mr-auto text-sm">
              <b>{groups.length}</b> {groups.length === 1 ? 'file has' : 'files have'} extra copies · <b>{toDelete.length}</b> to delete · frees <b>{formatBytes(freed)}</b>
            </div>
            <button className="btn-danger" disabled={busy || !toDelete.length} onClick={run}><Trash2 className="size-4" /> Delete {toDelete.length} extra {toDelete.length === 1 ? 'copy' : 'copies'}</button>
          </div>

          <div className="space-y-3">
            {groups.map((g) => (
              <div key={g.key} className="card overflow-hidden">
                <div className="flex items-center gap-2.5 px-3 py-2 border-b border-line bg-raised/50">
                  <FileKindIcon kind={g.copies[0].kind} />
                  <span className="font-medium truncate" title={g.name}>{g.name}</span>
                  {!g.identical && <span className="text-[11px] rounded px-1.5 bg-accent-soft text-accent-ink whitespace-nowrap">different sizes</span>}
                  <Link to="/folders/$id" params={{ id: g.folderId ?? 'root' }} className="ml-auto flex items-center gap-1 text-xs text-muted hover:text-ink min-w-0">
                    <FolderIcon className="size-3.5 shrink-0" /><span className="truncate max-w-[260px]">{g.folderPath || 'Top level'}</span>
                  </Link>
                </div>
                <ul className="divide-y divide-line">
                  {g.copies.map((c, i) => {
                    const kept = keepId(g) === c.id
                    return (
                      <li key={c.id} className={`flex flex-wrap items-center gap-x-4 gap-y-1 px-3 py-2 text-sm ${kept ? '' : 'bg-danger-soft/40'}`}>
                        <label className="flex items-center gap-2 cursor-pointer w-36">
                          <input type="radio" name={g.key} checked={kept} onChange={() => setKeep((m) => new Map(m).set(g.key, c.id))} />
                          {kept ? <span className="text-ok font-medium">Keep</span> : <span className="text-danger">Delete</span>}
                        </label>
                        <span className="text-muted w-56 whitespace-nowrap">Copy {i + 1} · uploaded {formatDate(c.created_at)}</span>
                        <span className="text-muted tabular w-20">{formatBytes(c.size)}</span>
                        <span className="text-muted w-28">{c.downloads} downloads</span>
                        <span className="text-faint text-xs font-mono">{c.slug}</span>
                        <span className="ml-auto flex">
                          <button className="btn-icon" onClick={() => copyText(c.url, toast)} aria-label="Copy link" title="Copy link"><CopyIcon className="size-4" /></button>
                          <a className="btn-icon" href={c.url} target="_blank" rel="noreferrer" aria-label="Open on Filester" title="Open on Filester"><ExternalLink className="size-4" /></a>
                        </span>
                      </li>
                    )
                  })}
                </ul>
              </div>
            ))}
          </div>
          <p className="text-xs text-faint">Copies are listed oldest upload first.</p>
        </>
      )}
    </div>
  )
}
