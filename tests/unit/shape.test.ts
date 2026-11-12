import { describe, it, expect } from 'vitest'
import { expectShape, expectList, expectColumns, problemIn, FilesterChangedError, SHAPES } from '../../src/lib/shape'

describe('shape checks', () => {
  it('accepts extra fields and allowed nulls', () => {
    expect(problemIn({ id: 'a', name: 'x', file_count: 1, created_at: 'd', parent: null, public: true, extra: 1 }, SHAPES.folder)).toBeNull()
  })
  it('names the missing or mistyped field', () => {
    expect(problemIn({ id: 1 }, { id: 'string' })).toBe('response.id is number, expected string')
    expect(problemIn({}, { id: 'string|null' })).toBeNull()
    expect(problemIn({}, { id: 'string' })).toBe('response.id is missing')
  })
  it('throws FilesterChangedError with the endpoint', () => {
    try {
      expectShape('v1/account', { id: '1' }, SHAPES.account)
      expect.unreachable()
    } catch (e) {
      expect(e).toBeInstanceOf(FilesterChangedError)
      expect((e as FilesterChangedError).endpoint).toBe('v1/account')
      expect((e as Error).message).toMatch(/Filester changed how “v1\/account” responds \(response\.id is string, expected number\)/)
    }
  })
  it('lists: null is empty, non-arrays and bad items throw', () => {
    expect(expectList('x', null, { a: 'string' })).toEqual([])
    expect(() => expectList('x', { a: 1 }, { a: 'string' })).toThrow(/expected a list, got object/)
    expect(() => expectList('x', [{ a: 'ok' }, { a: 2 }], { a: 'string' })).toThrow(/item 2\.a is number/)
  })
  it('CSV columns', () => {
    expect(() => expectColumns('csv', undefined)).not.toThrow()
    expect(() => expectColumns('csv', { slug: 'x' })).toThrow(/columns file_id, uuid/)
  })
})
