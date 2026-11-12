import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * Text input whose value also lives in the URL (?q=…).
 *
 * Binding an input straight to the URL drops keystrokes: each change navigates,
 * and until that lands the input re-renders with the old URL value, so a fast
 * next key is lost. Here the input keeps its own text (instant), and the URL is
 * updated after a short pause. Changes that come from elsewhere (Clear, Reset,
 * opening a saved search, back/forward) still flow into the input.
 */
export function useUrlText(urlValue: string, commit: (v: string | null) => void, delay = 150) {
  const [text, setText] = useState(urlValue)
  const sent = useRef<string[]>([])
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const commitRef = useRef(commit)
  commitRef.current = commit

  useEffect(() => {
    const i = sent.current.indexOf(urlValue)
    if (i >= 0) sent.current.splice(0, i + 1) // our own update arriving: ignore it (and anything older)
    else { setText(urlValue); sent.current = [] } // changed elsewhere
  }, [urlValue])

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current) }, [])

  const pending = useRef<string | null>(null)
  const flush = useCallback(() => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = null
    const v = pending.current
    if (v === null) return
    pending.current = null
    sent.current.push(v)
    commitRef.current(v || null)
  }, [])

  const onChange = useCallback((v: string) => {
    setText(v)
    pending.current = v
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(flush, delay)
  }, [delay, flush])

  /** Set and write to the URL right away (e.g. the Clear button). */
  const setNow = useCallback((v: string) => {
    if (timer.current) clearTimeout(timer.current)
    pending.current = null
    setText(v)
    sent.current.push(v)
    commitRef.current(v || null)
  }, [])

  /** Pass as the input's onBlur: clicking a button right after typing (e.g. Save search) sees the latest text. */
  return [text, onChange, setNow, flush] as const
}
