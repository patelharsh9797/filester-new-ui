import { useCallback } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import * as api from '../lib/api'
import type { FileRow, FolderNode } from '../lib/types'
import { useLibrary } from '../lib/library'
import { useDialogs } from './dialogs'
import { useToast } from './toast'
import { useTasks } from './tasks'
import { FolderPickerDialog } from '../components/FolderPicker'
import { FolderFormDialog, type FolderFormValues } from '../components/FolderForm'
import { formatBytes, plural, slugOf } from '../lib/format'


/** All mutating actions, wired to dialogs, toasts and cache invalidation. */
export function useActions() {
  const qc = useQueryClient()
  const toast = useToast()
  const tasks = useTasks()
  const { confirm, prompt, open } = useDialogs()
  const lib = useLibrary()
  const navigate = useNavigate()

  const refresh = useCallback(async () => {
    await Promise.all([
      qc.invalidateQueries({ queryKey: ['folders'] }),
      qc.invalidateQueries({ queryKey: ['files'] }),
      qc.invalidateQueries({ queryKey: ['account'] }),
      qc.invalidateQueries({ queryKey: ['folder-info'] }),
      qc.invalidateQueries({ queryKey: ['folder-flags'] }),
    ])
  }, [qc])

  const run = useCallback(async (fn: () => Promise<unknown>, ok: string) => {
    try {
      await fn()
      toast('success', ok)
    } catch (e) {
      toast('error', (e as Error).message)
    } finally {
      await refresh()
    }
  }, [toast, refresh])

  const pickFolder = useCallback((title: string, opts: { exclude?: Set<string>; current?: string | null; confirmLabel?: string } = {}) =>
    new Promise<string | null | undefined>((resolve) => {
      open((close) => <FolderPickerDialog title={title} {...opts} onDone={(v) => { resolve(v); close() }} />)
    }), [open])

  const folderForm = useCallback((mode: 'create' | 'edit', folder?: FolderNode, parentLabel?: string) =>
    new Promise<FolderFormValues | null>((resolve) => {
      open((close) => <FolderFormDialog mode={mode} folder={folder} parentLabel={parentLabel} onDone={(v) => { resolve(v); close() }} />)
    }), [open])

  /** Folder ids of `ids` and all of their descendants */
  const subtree = useCallback((ids: string[]) => {
    const out = new Set<string>()
    const walk = (id: string) => { if (out.has(id)) return; out.add(id); lib.byId.get(id)?.children.forEach(walk) }
    ids.forEach(walk)
    return out
  }, [lib.byId])

  /** Drop folders whose ancestor is also selected (they're deleted/moved along with it). */
  const topLevelOnly = useCallback((folders: FolderNode[]) => {
    const ids = new Set(folders.map((f) => f.id))
    return folders.filter((f) => !f.pathIds.slice(0, -1).some((a) => ids.has(a)))
  }, [])

  /**
   * Run a bulk operation in small batches, reporting every item to the progress
   * panel. `op` returns the ids that failed (with a reason); everything else in the
   * batch counts as done. Single items run without the panel.
   */
  const runBatched = useCallback(async <T,>(o: {
    title: string
    verb: string
    items: T[]
    batchSize: number
    id: (t: T) => string
    label: (t: T) => string
    op: (batch: T[]) => Promise<Map<string, string>>
    /** Called after each successful batch (e.g. to update lists right away) */
    onBatchDone?: (ok: T[]) => void
    success: (n: number) => string
  }) => {
    const task = o.items.length > 1 ? tasks.start(o.title, o.items.length, o.verb) : null
    let ok = 0
    const errors: string[] = []
    for (let i = 0; i < o.items.length; i += o.batchSize) {
      if (task?.signal.aborted) break
      const batch = o.items.slice(i, i + o.batchSize)
      task?.working(o.label(batch[0]) + (batch.length > 1 ? ` +${batch.length - 1}` : ''))
      let failed: Map<string, string>
      try {
        failed = await o.op(batch)
      } catch (e) {
        failed = new Map(batch.map((t) => [o.id(t), (e as Error).message]))
      }
      const good = batch.filter((t) => !failed.has(o.id(t)))
      ok += good.length
      for (const t of batch) {
        const err = failed.get(o.id(t))
        if (err) errors.push(`${o.label(t)}: ${err}`)
        task?.step(o.label(t), err)
      }
      if (good.length) o.onBatchDone?.(good)
    }
    task?.finish()
    if (task?.signal.aborted) toast('info', `Stopped — ${o.success(ok).toLowerCase()} before cancelling`)
    else if (errors.length) toast('error', `${o.success(ok)}, ${errors.length} failed${task ? ' — see the progress panel' : `: ${errors[0]}`}`)
    else toast('success', o.success(ok))
    await refresh()
    return ok
  }, [tasks, toast, refresh])

  /** Remove files from the cached list immediately, so rows disappear as batches finish. */
  const dropFromCache = useCallback((slugs: Set<string>) => {
    qc.setQueryData(['files'], (old: api.FileListing | undefined) => old && { ...old, files: old.files.filter((f) => !slugs.has(slugOf(f.url))) })
  }, [qc])

  return {
    refresh,
    pickFolder,

    async newFolder(parent: string | null) {
      const v = await folderForm('create', undefined, parent ? lib.byId.get(parent)?.pathText : 'Top level')
      if (!v) return
      await run(() => api.createFolder(v.name, parent, v.isPublic, v.password || undefined), `Created “${v.name}”`)
    },

    async editFolder(folder: FolderNode) {
      const v = await folderForm('edit', folder)
      if (!v) return
      await run(() => api.editFolder({ id: folder.id, ...v }), 'Folder updated')
    },

    /**
     * Turn "Hide related" on/off for many folders. Filester has no bulk endpoint,
     * so each folder is edited individually (web endpoint, no API-key cost).
     * Password-protected folders are skipped: Filester's edit would remove the
     * password unless it is re-entered.
     */
    async setHideRelated(folders: FolderNode[], on: boolean, after?: () => void) {
      if (!folders.length) return
      let flags: Map<string, api.FolderFlags>
      try {
        toast('info', `Checking settings of ${plural(folders.length, 'folder')}…`)
        flags = await qc.fetchQuery({ queryKey: ['folder-flags'], queryFn: api.getFolderFlags, staleTime: 0 })
      } catch (e) {
        toast('error', `Couldn't read folder settings: ${(e as Error).message}`)
        return
      }
      // Only touch folders whose settings Filester actually reported. Its file-manager data
      // can come back empty (e.g. when a folder's parent was deleted), and treating an
      // unknown folder as "no password" would wipe a real password.
      const unknown = folders.filter((f) => !flags.has(f.id))
      if (unknown.length === folders.length) {
        toast('error', "Filester didn't return these folders' settings, so nothing was changed. Try again later, or use Edit on each folder.")
        return
      }
      folders = folders.filter((f) => flags.has(f.id))
      const protectedFolders = folders.filter((f) => flags.get(f.id)?.hasPassword)
      const already = folders.filter((f) => !flags.get(f.id)?.hasPassword && flags.get(f.id)?.hideRelated === on)
      const todo = folders.filter((f) => !protectedFolders.includes(f) && !already.includes(f))
      const word = on ? 'Hide' : 'Show'
      const ok = await confirm({
        title: `${word} related files in ${plural(folders.length, 'folder')}?`,
        message: <div className="space-y-2">
          <p>{on ? 'File pages in these folders will no longer show the “More from this album” section.' : 'File pages in these folders will show the “More from this album” section again.'}</p>
          <ul className="list-disc pl-5 text-xs">
            <li><b>{todo.length}</b> will be updated</li>
            {already.length > 0 && <li>{already.length} already {on ? 'hide' : 'show'} related files (skipped)</li>}
            {protectedFolders.length > 0 && <li>{protectedFolders.length} password-protected (skipped — change these one by one in Edit, re-entering the password)</li>}
            {unknown.length > 0 && <li>{unknown.length} skipped because Filester didn't report their current settings</li>}
          </ul>
        </div>,
        confirmLabel: todo.length ? `${word} related in ${plural(todo.length, 'folder')}` : 'OK',
      })
      if (!ok || !todo.length) return
      // Progress is shown in the task dock; edits run 4 at a time.
      const task = tasks.start(`${on ? 'Hiding' : 'Showing'} related files`, todo.length)
      let updated = 0
      let failed = 0
      let next = 0
      const worker = async () => {
        while (next < todo.length && !task.signal.aborted) {
          const f = todo[next++]
          task.working(f.name)
          try {
            await api.editFolder({ id: f.id, name: f.name, isPublic: f.public, password: '', hideRelated: on })
            updated++
            task.step(f.name)
          } catch (e) {
            failed++
            task.step(f.name, (e as Error).message)
          }
        }
      }
      await Promise.all(Array.from({ length: Math.min(4, todo.length) }, worker))
      task.finish()
      if (task.signal.aborted) toast('info', `Stopped — ${plural(updated, 'folder')} updated before cancelling`)
      else if (failed) toast('error', `Updated ${updated}, ${failed} failed — see the progress panel for details`)
      else toast('success', `${on ? 'Hiding' : 'Showing'} related files in ${plural(updated, 'folder')}`)
      await qc.invalidateQueries({ queryKey: ['folder-flags'] })
      await qc.invalidateQueries({ queryKey: ['folder-info'] })
      after?.()
    },

    async moveFolders(folders: FolderNode[]) {
      if (!folders.length) return
      const top = topLevelOnly(folders)
      const ids = top.map((f) => f.id)
      const dest = await pickFolder(top.length === 1 ? `Move “${top[0].name}”` : `Move ${plural(top.length, 'folder')}`, {
        exclude: subtree(ids), current: top.length === 1 ? top[0].parent : undefined,
      })
      if (dest === undefined) return
      const destName = dest ? lib.byId.get(dest)?.name : 'top level'
      await runBatched({
        title: `Moving folders to ${destName}`, verb: 'moved', items: top, batchSize: 10, id: (f) => f.id, label: (f) => f.name,
        op: async (batch) => {
          const r = await api.moveFolders(batch.map((f) => f.id), dest)
          return new Map(r.data.results.filter((x) => !x.success).map((x) => [x.folder, x.error || 'failed']))
        },
        success: (n) => `Moved ${plural(n, 'folder')} to ${destName}`,
      })
    },

    async deleteFolders(folders: FolderNode[], after?: () => void) {
      if (!folders.length) return
      // Filester's folder delete removes the folder and the files directly in it, but
      // NOT its subfolders: they'd survive (with their files) and pop up at the top
      // level. So delete the whole tree explicitly, deepest folders first.
      const top = topLevelOnly(folders)
      const all = [...subtree(top.map((f) => f.id))].map((id) => lib.byId.get(id)!).filter(Boolean)
      all.sort((a, b) => b.depth - a.depth)
      const files = top.reduce((n, f) => n + f.totalFiles, 0)
      const size = top.reduce((n, f) => n + f.totalSize, 0)
      const sub = all.length - top.length
      const ok = await confirm({
        title: top.length === 1 ? `Delete “${top[0].name}”?` : `Delete ${plural(top.length, 'folder')}?`,
        message: <>This permanently deletes {sub > 0 && <><b>{plural(sub, 'subfolder')}</b> and </>}<b>{plural(files, 'file')}</b> ({formatBytes(size)}) inside. This cannot be undone.</>,
        confirmLabel: 'Delete', danger: true,
      })
      if (!ok) return
      // Folders can hold many files, so a few per request keeps each one quick.
      await runBatched({
        title: 'Deleting folders', verb: 'deleted', items: all, batchSize: 3, id: (f) => f.id, label: (f) => f.name,
        op: async (batch) => {
          const r = await api.deleteFolders(batch.map((f) => f.id))
          return new Map((r.results ?? []).filter((x) => !x.success).map((x) => [x.identifier, x.error || 'failed']))
        },
        success: (n) => `Deleted ${plural(n, 'folder')}`,
      })
      after?.()
    },

    async renameFile(file: FileRow) {
      const name = await prompt({ title: 'Rename file', label: 'File name', initial: file.name, selectStem: true, confirmLabel: 'Rename' })
      if (!name) return
      await run(() => api.renameFile(file.slug, name, file.folder_id), 'File renamed')
    },

    async moveFiles(files: FileRow[], after?: () => void) {
      if (!files.length) return
      const single = files.length === 1
      const dest = await pickFolder(single ? `Move “${files[0].name}”` : `Move ${plural(files.length, 'file')}`, {
        current: single ? files[0].folder_id : undefined,
      })
      if (dest === undefined) return
      const destName = dest ? lib.byId.get(dest)?.name : 'top level'
      await runBatched({
        title: `Moving files to ${destName}`, verb: 'moved', items: files, batchSize: 50, id: (f) => f.slug, label: (f) => f.name,
        op: async (batch) => {
          const r = await api.moveFiles(batch.map((f) => f.slug), dest)
          return new Map((r.data.results ?? []).filter((x) => !x.success).map((x) => [x.file, x.error || 'failed']))
        },
        success: (n) => `Moved ${plural(n, 'file')} to ${destName}`,
      })
      after?.()
    },

    async deleteFiles(files: FileRow[], after?: () => void) {
      if (!files.length) return
      const ok = await confirm({
        title: files.length === 1 ? `Delete “${files[0].name}”?` : `Delete ${plural(files.length, 'file')}?`,
        message: <>{formatBytes(files.reduce((n, f) => n + f.size, 0))} will be permanently deleted. This cannot be undone.</>,
        confirmLabel: 'Delete', danger: true,
      })
      if (!ok) return
      await runBatched({
        title: 'Deleting files', verb: 'deleted', items: files, batchSize: 20, id: (f) => f.slug, label: (f) => f.name,
        op: async (batch) => {
          const r = await api.deleteFiles(batch.map((f) => f.slug))
          return new Map((r.results ?? []).filter((x) => !x.success).map((x) => [x.file_id, x.error || 'failed']))
        },
        onBatchDone: (good) => dropFromCache(new Set(good.map((f) => f.slug))),
        success: (n) => `Deleted ${plural(n, 'file')}`,
      })
      after?.()
    },

    openFolder(id: string | null) {
      navigate({ to: '/folders/$id', params: { id: id ?? 'root' } })
    },
  }
}

export async function copyText(text: string, toast: (k: 'success' | 'error', m: string) => void, what = 'Link') {
  try {
    await navigator.clipboard.writeText(text)
    toast('success', `${what} copied`)
  } catch {
    toast('error', 'Clipboard unavailable')
  }
}
