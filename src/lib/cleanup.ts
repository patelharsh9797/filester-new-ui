// What the Cleanup page offers to tidy. Pure (works on the library index) so it's unit-tested.
import type { LibraryIndex } from './library'
import type { FolderNode } from './types'

export interface EmptyFolder {
  folder: FolderNode
  /** Empty subfolders that go with it */
  subfolders: number
  /** Files Filester still counts in this tree that no longer exist (deleted by you or its inactivity cleanup) */
  deleted: number
}

/**
 * Folders whose whole tree has no files left, topmost only: an empty folder inside
 * another empty folder is covered by its parent.
 */
export function findEmptyFolders(lib: Pick<LibraryIndex, 'folders' | 'byId'>): EmptyFolder[] {
  const deletedIn = (f: FolderNode, seen = new Set<string>()): number => {
    if (seen.has(f.id)) return 0
    seen.add(f.id)
    return f.deletedFiles + f.children.reduce((n, c) => n + (lib.byId.has(c) ? deletedIn(lib.byId.get(c)!, seen) : 0), 0)
  }
  return lib.folders
    .filter((f) => f.totalFiles === 0)
    .filter((f) => { const p = f.parent ? lib.byId.get(f.parent) : undefined; return !p || p.totalFiles > 0 })
    .map((f) => ({ folder: f, subfolders: f.totalFolders, deleted: deletedIn(f) }))
}
