import { highlightParts } from '../lib/search'

export function Highlight({ text, query }: { text: string; query: string }) {
  const parts = highlightParts(text, query)
  if (!parts) return <>{text}</>
  return <>{parts[0]}<mark className="bg-accent-soft text-accent-ink rounded-sm px-px">{parts[1]}</mark>{parts[2]}</>
}
