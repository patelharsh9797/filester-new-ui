/**
 * Small fuzzy matcher used for both folder and file search.
 *
 * Scoring (higher is better):
 *   exact name match > name prefix > word prefix > substring > all query words
 *   present (any order, name or path) > in-order subsequence of characters.
 * Matching is case-insensitive and ignores separators like `_ - .` so that
 * "sci fi" finds "Sci-Fi_Classics".
 */

const SEP = /[\s_\-.()[\]{}]+/g

export function normalize(s: string): string {
  return s.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(SEP, ' ').trim()
}

function subsequence(q: string, t: string): boolean {
  let i = 0
  for (let j = 0; j < t.length && i < q.length; j++) if (t[j] === q[i]) i++
  return i === q.length
}

/** Score `name` (and optionally its folder `path`) against a pre-normalized query. 0 = no match. */
export function score(nq: string, name: string, path = ''): number {
  if (!nq) return 1
  const n = normalize(name)
  if (n === nq) return 1000
  if (n.startsWith(nq)) return 800 - n.length
  if (n.split(' ').some((w) => w.startsWith(nq))) return 650 - n.length
  const idx = n.indexOf(nq)
  if (idx >= 0) return 500 - idx - n.length / 10
  const words = nq.split(' ').filter(Boolean)
  const p = path ? normalize(path) : ''
  if (words.length > 1 && words.every((w) => n.includes(w))) return 400 - n.length / 10
  if (p && words.every((w) => n.includes(w) || p.includes(w))) return 250 - p.length / 10
  const compact = nq.replace(/ /g, '')
  if (compact.length >= 2 && subsequence(compact, n.replace(/ /g, ''))) return 100 - n.length / 5
  return 0
}

export function searchItems<T>(items: T[], query: string, getName: (t: T) => string, getPath?: (t: T) => string, limit = Infinity): T[] {
  const nq = normalize(query)
  if (!nq) return items.slice(0, limit)
  const scored: { item: T; s: number }[] = []
  for (const item of items) {
    const s = score(nq, getName(item), getPath?.(item))
    if (s > 0) scored.push({ item, s })
  }
  scored.sort((a, b) => b.s - a.s)
  return scored.slice(0, limit).map((x) => x.item)
}

/** Split text into [before, match, after] for highlighting a plain substring match. */
export function highlightParts(text: string, query: string): [string, string, string] | null {
  const q = query.trim().toLowerCase()
  if (!q) return null
  const i = text.toLowerCase().indexOf(q)
  if (i < 0) return null
  return [text.slice(0, i), text.slice(i, i + q.length), text.slice(i + q.length)]
}
