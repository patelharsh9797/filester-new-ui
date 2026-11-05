import { useCallback } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import * as api from '../lib/api'
import type { FileRow, FolderNode } from '../lib/types'
import { useLibrary } from '../lib/library'
import { useDialogs } from './dialogs'
import { useToast } from './toast'
import { FolderPickerDialog } from '../components/FolderPicker'
import { FolderFormDialog, type FolderFormValues } from '../components/FolderForm'
import { formatBytes } from '../lib/format'

const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`

/** All mutating actions, wired to dialogs, toasts and cache invalidation. */
export function useActions() {
  const qc = useQueryClient()
  const toast = useToast()
  const { confirm, prompt, open } = useDialogs()
  const lib = useLibrary()
  const navigate = useNavigate()

  const refresh = useCallback(async () => {
    await Promise.all([
      qc.invalidateQueries({ queryKey: ['folders'] }),
      qc.invalidateQueries({ queryKey: ['files'] }),
      qc.invalidateQueries({ queryKey: ['account'] }),
      qc.invalidateQueries({ queryKey: ['folder-info'] }),
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

    async moveFolders(folders: FolderNode[]) {
      if (!folders.length) return
      const ids = folders.map((f) => f.id)
      const dest = await pickFolder(folders.length === 1 ? `Move “${folders[0].name}”` : `Move ${plural(folders.length, 'folder')}`, {
        exclude: subtree(ids), current: folders.length === 1 ? folders[0].parent : undefined,
      })
      if (dest === undefined) return
      try {
        const r = await api.moveFolders(ids, dest)
        const failed = r.data.results.filter((x) => !x.success)
        if (failed.length) toast('error', `${r.message}: ${failed.map((f) => f.error).join(', ')}`)
        else toast('success', `Moved ${plural(r.data.moved, 'folder')}`)
      } catch (e) {
        toast('error', (e as Error).message)
      }
      await refresh()
    },

    async deleteFolders(folders: FolderNode[], after?: () => void) {
      if (!folders.length) return
      const files = folders.reduce((n, f) => n + f.totalFiles, 0)
      const size = folders.reduce((n, f) => n + f.totalSize, 0)
      const sub = folders.reduce((n, f) => n + f.totalFolders, 0)
      const ok = await confirm({
        title: folders.length === 1 ? `Delete “${folders[0].name}”?` : `Delete ${plural(folders.length, 'folder')}?`,
        message: <>This permanently deletes {sub > 0 && <><b>{plural(sub, 'subfolder')}</b> and </>}<b>{plural(files, 'file')}</b> ({formatBytes(size)}) inside. This cannot be undone.</>,
        confirmLabel: 'Delete', danger: true,
      })
      if (!ok) return
      await run(() => api.deleteFolders(folders.map((f) => f.id)), `Deleted ${plural(folders.length, 'folder')}`)
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
      // API accepts max 200 per request
      await run(async () => {
        for (let i = 0; i < files.length; i += 200) await api.moveFiles(files.slice(i, i + 200).map((f) => f.slug), dest)
      }, `Moved ${plural(files.length, 'file')} to ${destName}`)
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
      await run(async () => {
        for (let i = 0; i < files.length; i += 100) await api.deleteFiles(files.slice(i, i + 100).map((f) => f.slug))
      }, `Deleted ${plural(files.length, 'file')}`)
      after?.()
    },

    openFolder(id: string | null) {
      navigate(id ? `/folders/${id}` : '/folders/root')
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
