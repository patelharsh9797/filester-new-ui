import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { getAccount, getAllFiles, getFolders } from './api'
import { extOf, kindOf, slugOf } from './format'
import type { FileItem, FileRow, Folder, FolderNode } from './types'

export interface LibraryIndex {
  folders: FolderNode[]
  byId: Map<string, FolderNode>
  roots: FolderNode[]
  files: FileRow[]
  filesByFolder: Map<string, FileRow[]>
  rootFiles: FileRow[]
}

export function buildIndex(rawFolders: Folder[], rawFiles: FileItem[]): LibraryIndex {
  const byId = new Map<string, FolderNode>()
  for (const f of rawFolders) {
    byId.set(f.id, {
      ...f, path: [], pathIds: [], pathText: '', depth: 0, children: [],
      directSize: 0, totalFiles: 0, totalSize: 0, totalFolders: 0, lastActivity: f.created_at,
    })
  }
  for (const node of byId.values()) {
    if (node.parent && byId.has(node.parent)) byId.get(node.parent)!.children.push(node.id)
  }

  // Paths (with protection against cycles / orphaned parents)
  for (const node of byId.values()) {
    const names: string[] = []
    const ids: string[] = []
    const seen = new Set<string>()
    let cur: FolderNode | undefined = node
    while (cur && !seen.has(cur.id)) {
      seen.add(cur.id)
      names.unshift(cur.name)
      ids.unshift(cur.id)
      cur = cur.parent ? byId.get(cur.parent) : undefined
    }
    node.path = names
    node.pathIds = ids
    node.pathText = names.join(' / ')
    node.depth = names.length - 1
  }

  const files: FileRow[] = rawFiles.map((f) => ({
    ...f,
    slug: slugOf(f.url),
    ext: extOf(f.name),
    kind: kindOf(f.name, f.type),
    folderPath: f.folder_id && byId.has(f.folder_id) ? byId.get(f.folder_id)!.pathText : '',
  }))

  const filesByFolder = new Map<string, FileRow[]>()
  const rootFiles: FileRow[] = []
  for (const f of files) {
    const node = f.folder_id ? byId.get(f.folder_id) : undefined
    if (!node) {
      rootFiles.push(f)
      continue
    }
    let list = filesByFolder.get(node.id)
    if (!list) filesByFolder.set(node.id, (list = []))
    list.push(f)
    node.directSize += f.size
    if (f.created_at > node.lastActivity) node.lastActivity = f.created_at
  }

  // Recursive totals (post-order)
  const visit = (node: FolderNode, stack: Set<string>): void => {
    stack.add(node.id)
    node.totalFiles = filesByFolder.get(node.id)?.length ?? node.file_count
    node.totalSize = node.directSize
    node.totalFolders = 0
    for (const cid of node.children) {
      const c = byId.get(cid)!
      if (stack.has(c.id)) continue
      visit(c, stack)
      node.totalFiles += c.totalFiles
      node.totalSize += c.totalSize
      node.totalFolders += 1 + c.totalFolders
      if (c.lastActivity > node.lastActivity) node.lastActivity = c.lastActivity
    }
    stack.delete(node.id)
  }
  const folders = [...byId.values()]
  const roots = folders.filter((f) => !f.parent || !byId.has(f.parent))
  for (const r of roots) visit(r, new Set())

  const byName = (a: FolderNode, b: FolderNode) => a.name.localeCompare(b.name, undefined, { numeric: true })
  roots.sort(byName)
  for (const n of folders) n.children.sort((a, b) => byName(byId.get(a)!, byId.get(b)!))
  folders.sort((a, b) => a.pathText.localeCompare(b.pathText, undefined, { numeric: true }))

  return { folders, byId, roots, files, filesByFolder, rootFiles }
}

export function useAccount() {
  return useQuery({ queryKey: ['account'], queryFn: getAccount, staleTime: 60_000 })
}

export function useLibrary() {
  const [progress, setProgress] = useState<{ loaded: number; total: number } | null>(null)
  const foldersQ = useQuery({ queryKey: ['folders'], queryFn: getFolders, staleTime: 5 * 60_000 })
  const filesQ = useQuery({
    queryKey: ['files'],
    queryFn: () => getAllFiles((loaded, total) => setProgress({ loaded, total })),
    staleTime: 5 * 60_000,
  })
  const index = useMemo(
    () => buildIndex(foldersQ.data ?? [], filesQ.data ?? []),
    [foldersQ.data, filesQ.data],
  )
  return {
    ...index,
    foldersLoading: foldersQ.isPending,
    filesLoading: filesQ.isPending,
    loading: foldersQ.isPending || filesQ.isPending,
    fetching: foldersQ.isFetching || filesQ.isFetching,
    error: foldersQ.error || filesQ.error,
    progress,
  }
}
