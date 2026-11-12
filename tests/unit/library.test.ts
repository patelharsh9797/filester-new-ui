import { describe, it, expect } from 'vitest'
import { buildIndex } from '../../src/lib/library'
import { findDuplicates } from '../../src/lib/duplicates'
import type { Folder, FileItem } from '../../src/lib/types'

const folder = (id: string, name: string, parent: string | null, file_count = 0): Folder =>
  ({ id, name, parent, parent_id: parent, public: true, file_count, folder_count: 0, created_at: '2025-01-01T00:00:00Z' })
let n = 0
const file = (name: string, folder_id: string | null, size = 100, created_at = '2025-02-01T00:00:00Z'): FileItem =>
  ({ id: ++n, uuid: `u${n}`, name, size, type: 'application/octet-stream', url: `https://filester.me/d/s${n}`, folder_id, created_at, downloads: 0 })

const folders = [folder('a', 'Movies', null, 0), folder('b', 'Sci-Fi', 'a', 3), folder('c', 'Old', 'b', 2), folder('o', 'Orphan', 'gone', 0)]
const files = [file('x.mp4', 'b', 1000), file('y.jpg', 'b', 500, '2025-06-01T00:00:00Z'), file('loose.txt', null), file('lost.txt', 'deleted-folder')]

describe('buildIndex', () => {
  const idx = buildIndex(folders, files)

  it('builds paths, depths and children', () => {
    expect(idx.byId.get('c')!.pathText).toBe('Movies / Sci-Fi / Old')
    expect(idx.byId.get('c')!.depth).toBe(2)
    expect(idx.byId.get('a')!.children).toEqual(['b'])
    expect(idx.roots.map((r) => r.name)).toEqual(['Movies', 'Orphan'])
  })

  it('counts real files, not Filester’s counter (which includes deleted files)', () => {
    const b = idx.byId.get('b')!
    expect(b.directFiles).toBe(2)
    expect(b.deletedFiles).toBe(1)
    expect(idx.byId.get('c')!.directFiles).toBe(0)
    expect(idx.byId.get('c')!.deletedFiles).toBe(2)
  })

  it('totals include nested folders', () => {
    const a = idx.byId.get('a')!
    expect(a.totalFiles).toBe(2)
    expect(a.totalSize).toBe(1500)
    expect(a.totalFolders).toBe(2)
    expect(a.lastActivity).toBe('2025-06-01T00:00:00Z')
  })

  it('files in unknown folders go to the top level', () => {
    expect(idx.rootFiles.map((f) => f.name).sort()).toEqual(['loose.txt', 'lost.txt'])
    expect(idx.files.find((f) => f.name === 'x.mp4')!.folderPath).toBe('Movies / Sci-Fi')
    expect(idx.files.find((f) => f.name === 'x.mp4')!.kind).toBe('video')
  })

  it('falls back to Filester’s counter while files are loading', () => {
    const loading = buildIndex(folders, [], false)
    expect(loading.byId.get('b')!.directFiles).toBe(3)
    expect(loading.byId.get('b')!.deletedFiles).toBe(0)
  })

  it('survives parent cycles', () => {
    const cyc = buildIndex([folder('p', 'P', 'q'), folder('q', 'Q', 'p')], [])
    expect(cyc.folders).toHaveLength(2)
  })
})

describe('findDuplicates', () => {
  const idx = buildIndex([folder('f', 'Photos', null)], [
    file('IMG.jpg', 'f', 10), file('img.JPG', 'f', 10), file('img.jpg', null, 10),
    file('a.txt', 'f', 1), file('a.txt', 'f', 2), file('unique.png', 'f'),
  ])
  const groups = findDuplicates(idx.files)

  it('groups same name (case-insensitive) within the same folder only', () => {
    expect(groups.map((g) => [g.name, g.copies.length])).toEqual([['a.txt', 2], ['IMG.jpg', 2]])
  })
  it('marks identical copies and computes freed bytes', () => {
    const img = groups.find((g) => g.name === 'IMG.jpg')!
    expect(img.identical).toBe(true)
    expect(img.extraBytes).toBe(10)
    const a = groups.find((g) => g.name === 'a.txt')!
    expect(a.identical).toBe(false)
    expect(a.extraBytes).toBe(1)
    expect(a.copies[0].id).toBeLessThan(a.copies[1].id)
  })
})
