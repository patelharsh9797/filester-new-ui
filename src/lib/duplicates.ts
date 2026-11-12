import { useMemo } from 'react'
import { useLibrary } from './library'
import type { FileRow } from './types'

export interface DuplicateGroup {
  key: string
  name: string
  folderId: string | null
  folderPath: string
  /** Copies ordered oldest upload first (Filester file ids only ever increase) */
  copies: FileRow[]
  /** All copies have the same size — almost certainly the same file */
  identical: boolean
  /** Bytes that deleting all but one copy would free */
  extraBytes: number
}

/** Files with the same name (case-insensitive) in the same folder. */
export function findDuplicates(files: FileRow[]): DuplicateGroup[] {
  const map = new Map<string, FileRow[]>()
  for (const f of files) {
    const key = `${f.folder_id ?? 'root'}\u0000${f.name.toLowerCase()}`
    const list = map.get(key)
    if (list) list.push(f)
    else map.set(key, [f])
  }
  const out: DuplicateGroup[] = []
  for (const [key, list] of map) {
    if (list.length < 2) continue
    const copies = [...list].sort((a, b) => a.id - b.id)
    const largest = Math.max(...copies.map((c) => c.size))
    out.push({
      key,
      name: copies[0].name,
      folderId: copies[0].folder_id,
      folderPath: copies[0].folderPath,
      copies,
      identical: copies.every((c) => c.size === copies[0].size),
      extraBytes: copies.reduce((n, c) => n + c.size, 0) - largest,
    })
  }
  return out.sort((a, b) => a.folderPath.localeCompare(b.folderPath, undefined, { numeric: true }) || a.name.localeCompare(b.name, undefined, { numeric: true }))
}

/** Duplicate groups for the signed-in library. */
export function useDuplicates() {
  const lib = useLibrary()
  const groups = useMemo(() => findDuplicates(lib.files), [lib.files])

  const byFolder = useMemo(() => {
    const m = new Map<string, number>()
    for (const g of groups) m.set(g.folderId ?? 'root', (m.get(g.folderId ?? 'root') ?? 0) + g.copies.length - 1)
    return m
  }, [groups])

  return { groups, byFolder, extraCopies: groups.reduce((n, g) => n + g.copies.length - 1, 0), loading: lib.filesLoading }
}
