import { describe, it, expect } from 'vitest'
import { normalize, score, searchItems, highlightParts } from '../../src/lib/search'
import { parseCsv } from '../../src/lib/csv'
import { formatBytes, extOf, kindOf, slugOf } from '../../src/lib/format'
import { computeExpiry, levelFor } from '../../src/lib/expiry'
import { buildIndex } from '../../src/lib/library'

describe('search', () => {
  const names = ['Sci-Fi_Classics', 'Movies', 'Science notes', 'Horror']
  it('normalizes separators, case and accents', () => {
    expect(normalize('Sci-Fi_Classics.(70s)')).toBe('sci fi classics 70s')
    expect(normalize('Café')).toBe('cafe')
  })
  it('finds words in any order', () => {
    expect(searchItems(names, 'classics sci', (s) => s)).toEqual(['Sci-Fi_Classics'])
  })
  it('ranks exact > prefix > substring', () => {
    expect(searchItems(['xmovies', 'movies 2', 'movies'], 'movies', (s) => s)).toEqual(['movies', 'movies 2', 'xmovies'])
  })
  it('matches against the folder path too', () => {
    expect(score('movies blade', 'Blade Runner', 'Movies / Sci-Fi')).toBeGreaterThan(0)
    expect(score('music blade', 'Blade Runner', 'Movies / Sci-Fi')).toBe(0)
  })
  it('empty query returns everything', () => {
    expect(searchItems(names, '  ', (s) => s)).toHaveLength(4)
  })
  it('highlights a substring', () => {
    expect(highlightParts('Blade Runner', 'run')).toEqual(['Blade ', 'Run', 'ner'])
    expect(highlightParts('Blade', 'zz')).toBeNull()
  })
})

describe('parseCsv', () => {
  it('handles quotes, escaped quotes, commas and CRLF', () => {
    const rows = parseCsv('a,b,c\r\n1,"x, y","say ""hi"""\r\n2,,\n')
    expect(rows).toEqual([{ a: '1', b: 'x, y', c: 'say "hi"' }, { a: '2', b: '', c: '' }])
  })
  it('handles a missing final newline and empty input', () => {
    expect(parseCsv('a\n1')).toEqual([{ a: '1' }])
    expect(parseCsv('')).toEqual([])
  })
})

describe('format', () => {
  it('formats bytes', () => {
    expect(formatBytes(0)).toBe('0 B')
    expect(formatBytes(1023)).toBe('1023 B')
    expect(formatBytes(1536)).toBe('1.5 KB')
    expect(formatBytes(12 * 1024 ** 3)).toBe('12 GB')
  })
  it('detects extensions and kinds', () => {
    expect(extOf('a.tar.GZ')).toBe('gz')
    expect(extOf('.bashrc')).toBe('')
    expect(kindOf('movie.MKV', 'application/octet-stream')).toBe('video')
    expect(kindOf('noext', 'application/pdf')).toBe('document')
  })
  it('extracts slugs', () => {
    expect(slugOf('https://filester.me/d/AbC123x')).toBe('AbC123x')
  })
})

describe('expiry', () => {
  const now = Date.parse('2025-06-30T00:00:00Z')
  const [f] = buildIndex([], [{ id: 1, uuid: 'u', name: 'a.jpg', size: 1, type: '', url: 'https://filester.me/d/s', folder_id: null, created_at: '2025-05-01T00:00:00Z', downloads: 0 }]).files
  it('FAQ rule counts 35 days from the last download', () => {
    const e = computeExpiry(f, { lastDownloaded: '2025-06-01T00:00:00Z', lastViewed: '2025-06-29T00:00:00Z', uploadDate: '2025-05-01T00:00:00Z' } as never, 'faq', now)
    expect(e.lastActive).toBe('2025-06-01T00:00:00Z')
    expect(Math.round(e.daysLeft)).toBe(6)
    expect(e.level).toBe('soon')
  })
  it('docs rule also counts views', () => {
    const e = computeExpiry(f, { lastDownloaded: '2025-06-01T00:00:00Z', lastViewed: '2025-06-29T00:00:00Z' } as never, 'docs', now)
    expect(Math.round(e.daysLeft)).toBe(44)
    expect(e.level).toBe('ok')
  })
  it('ignores bogus dates and falls back to the upload date', () => {
    const e = computeExpiry(f, { lastDownloaded: '0001-01-01T00:00:00Z' } as never, 'faq', now)
    expect(e.lastActive).toBe('2025-05-01T00:00:00Z')
    expect(e.daysLeft).toBeLessThan(0)
    expect(e.level).toBe('critical')
  })
  it('levels', () => {
    expect([levelFor(-1), levelFor(3), levelFor(7), levelFor(14), levelFor(15)]).toEqual(['critical', 'critical', 'soon', 'watch', 'ok'])
  })
})
