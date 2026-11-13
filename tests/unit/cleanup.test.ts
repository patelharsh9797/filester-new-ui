import { describe, it, expect } from 'vitest'
import { buildIndex } from '../../src/lib/library'
import { findEmptyFolders } from '../../src/lib/cleanup'
import type { Folder, FileItem } from '../../src/lib/types'

const folder = (id: string, parent: string | null, file_count = 0): Folder =>
  ({ id, name: id, parent, parent_id: parent, public: true, file_count, folder_count: 0, created_at: '2025-01-01T00:00:00Z' })
let n = 0
const file = (folder_id: string | null): FileItem =>
  ({ id: ++n, uuid: `u${n}`, name: `f${n}.jpg`, size: 1, type: '', url: `https://filester.me/d/s${n}`, folder_id, created_at: '2025-01-01T00:00:00Z', downloads: 0 })

describe('findEmptyFolders', () => {
  // A has a file. A/B empty with empty child A/B/C (C: 2 deleted by Filester). D empty top-level. E has a file only deep down.
  const idx = buildIndex(
    [folder('A', null), folder('B', 'A'), folder('C', 'B', 2), folder('D', null), folder('E', null), folder('F', 'E'), folder('G', 'F')],
    [file('A'), file('G')],
  )
  const empty = findEmptyFolders(idx)

  it('lists only the topmost folder of each empty tree', () => {
    expect(empty.map((e) => e.folder.id).sort()).toEqual(['B', 'D'])
  })
  it('counts the empty subfolders that go with it, and files Filester deleted there', () => {
    const b = empty.find((e) => e.folder.id === 'B')!
    expect(b.subfolders).toBe(1)
    expect(b.deleted).toBe(2)
    expect(empty.find((e) => e.folder.id === 'D')!.deleted).toBe(0)
  })
  it('a folder with files only in a deep subfolder is not empty', () => {
    expect(empty.some((e) => ['E', 'F', 'G'].includes(e.folder.id))).toBe(false)
  })
})
