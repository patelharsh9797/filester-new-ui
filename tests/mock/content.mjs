/** Deterministic pseudo-random file content, so tests can compare bytes. */
export function contentFor(name, size) {
  const buf = Buffer.alloc(size)
  let x = [...name].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7)
  for (let i = 0; i < size; i++) { x = (x * 1103515245 + 12345) >>> 0; buf[i] = x >>> 24 }
  return buf
}
