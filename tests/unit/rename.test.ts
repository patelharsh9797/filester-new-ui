import { describe, it, expect } from 'vitest'
import { planRenames, splitName, cleanName, DEFAULT_RENAME, type RenameFile, type RenameOptions } from '../../src/lib/rename'

let id = 0
const f = (name: string, folder_id: string | null = 'p', created_at = '2025-01-01T00:00:00Z'): RenameFile => ({ id: ++id, slug: `s${id}`, name, folder_id, created_at })
const folders: Record<string, string> = { p: 'photos', v: 'videos' }
const name = (fid: string | null) => (fid ? folders[fid] : 'Unfiled')
const plan = (files: RenameFile[], o: Partial<RenameOptions> = {}, others: Record<string, string[]> = {}) =>
  planRenames(files, { ...DEFAULT_RENAME, ...o }, name, (k) => others[k] ?? [])

describe('splitName / cleanName', () => {
  it('splits the last extension only', () => {
    expect(splitName('a.tar.gz')).toEqual({ stem: 'a.tar', ext: 'gz' })
    expect(splitName('.bashrc')).toEqual({ stem: '.bashrc', ext: '' })
    expect(splitName('noext')).toEqual({ stem: 'noext', ext: '' })
  })
  it('removes slashes and control characters, tidies spaces', () => {
    expect(cleanName(' a/b\\c\u0001  d ')).toBe('a_b_c_ d')
  })
})

describe('pattern mode', () => {
  it('numbers files, keeps extensions, pads to the count', () => {
    const files = Array.from({ length: 12 }, (_, i) => f(`c747cecf-${i}.jpg`))
    const p = plan(files)
    expect(p.rows.map((r) => r.to).slice(0, 2)).toEqual(['photos 01.jpg', 'photos 02.jpg'])
    expect(p.rows[11].to).toBe('photos 12.jpg')
    expect(p.counts.rename).toBe(12)
    expect(p.blocked).toBe(false)
  })
  it('supports {name}, {date}, start and fixed padding', () => {
    const p = plan([f('IMG.JPG', 'p', '2024-07-09T10:00:00Z')], { pattern: '{date} {name} #{n}', start: 7, pad: 3 })
    expect(p.rows[0].to).toBe('2024-07-09 IMG #007.JPG')
  })
  it('{ext} puts the extension where you want it', () => {
    expect(plan([f('a.mp4')], { pattern: '{n}-{ext}' }).rows[0].to).toBe('1-mp4')
  })
  it('restarts numbering per folder, or runs one sequence', () => {
    const files = [f('a.jpg', 'p'), f('b.mp4', 'v'), f('c.jpg', 'p')]
    expect(plan(files).rows.map((r) => r.to)).toEqual(['photos 1.jpg', 'videos 1.mp4', 'photos 2.jpg'])
    expect(plan(files, { perFolder: false, pattern: 'x {n}' }).rows.map((r) => r.to)).toEqual(['x 1.jpg', 'x 2.mp4', 'x 3.jpg'])
  })
  it('orders by name or upload date before numbering', () => {
    const files = [f('b.jpg', 'p', '2025-01-02'), f('a10.jpg', 'p', '2025-01-03'), f('a2.jpg', 'p', '2025-01-01')]
    expect(plan(files, { order: 'name', pattern: '{n} {name}' }).rows.map((r) => r.to)).toEqual(['1 a2.jpg', '2 a10.jpg', '3 b.jpg'])
    expect(plan(files, { order: 'date', pattern: '{n} {name}' }).rows.map((r) => r.to)).toEqual(['1 a2.jpg', '2 b.jpg', '3 a10.jpg'])
  })
  it('marks unchanged names', () => {
    const p = plan([f('photos 1.jpg')])
    expect(p.rows[0].status).toBe('same')
    expect(p.toRename).toHaveLength(0)
  })
})

describe('find & replace', () => {
  it('replaces in the name only, never the extension', () => {
    const p = plan([f('jpg-photo.jpg'), f('Other.JPG')], { mode: 'replace', find: 'jpg', replace: 'pic' })
    expect(p.rows.map((r) => r.to)).toEqual(['pic-photo.jpg', 'Other.JPG'])
    expect(p.rows[1].status).toBe('same')
  })
  it('match case, and special characters are literal', () => {
    expect(plan([f('A (1).png')], { mode: 'replace', find: ' (1)', replace: '' }).rows[0].to).toBe('A.png')
    expect(plan([f('Aa.png')], { mode: 'replace', find: 'a', replace: 'x', matchCase: true }).rows[0].to).toBe('Ax.png')
  })
})

describe('problems block the rename', () => {
  it('two selected files getting the same name', () => {
    const p = plan([f('a.jpg'), f('b.jpg')], { pattern: 'same' })
    expect(p.rows.map((r) => r.status)).toEqual(['clash', 'clash'])
    expect(p.blocked).toBe(true)
  })
  it('a name already used by an unselected file in that folder (any case)', () => {
    const p = plan([f('a.jpg')], { pattern: 'Cover' }, { p: ['cover.JPG'] })
    expect(p.rows[0].status).toBe('clash')
  })
  it('swapping names within the selection is fine', () => {
    const p = plan([f('1.jpg'), f('2.jpg')], { mode: 'pattern', pattern: '{n}', order: 'current', start: 2, perFolder: false })
    // 1→2, 2→3: "2.jpg" is freed by the second file being renamed
    expect(p.rows.map((r) => [r.to, r.status])).toEqual([['2.jpg', 'rename'], ['3.jpg', 'rename']])
  })
  it('same name in different folders is fine', () => {
    expect(plan([f('a.jpg', 'p'), f('b.jpg', 'v')], { pattern: 'x', perFolder: true }).blocked).toBe(false)
  })
  it('empty and over-long names', () => {
    expect(plan([f('a.jpg')], { pattern: '  ' }).rows[0].status).toBe('invalid')
    expect(plan([f('a.jpg')], { pattern: 'x'.repeat(250) }).rows[0].status).toBe('invalid')
  })
})
