/** Build a validateSearch that keeps only the given keys, as short strings. */
export function stringParams<K extends string>(...keys: K[]) {
  return (raw: Record<string, unknown>): { [P in K]?: string } => {
    const out: { [P in K]?: string } = {}
    for (const k of keys) {
      const v = raw[k]
      if (typeof v === 'string' && v !== '') out[k] = v.slice(0, 200)
      else if (typeof v === 'number' || typeof v === 'boolean') out[k] = String(v)
    }
    return out
  }
}
