import { useMemo, useState } from 'react'
import { Link } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { AlertTriangle, ArrowRight, Info } from 'lucide-react'
import { getAccountStats, type StatItem } from '../lib/api'
import { useAccount, useLibrary } from '../lib/library'
import { useExpiring } from '../lib/expiry'
import { formatBytes, formatDate, KIND_LABELS, plural } from '../lib/format'
import { ExpiryBadge } from '../components/ExpiryBadge'
import { FileKindIcon, FolderIcon } from '../components/icons'
import type { FileKind, FileRow } from '../lib/types'

const DAY = 86_400_000
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

export function InsightsPage() {
  const lib = useLibrary()
  const account = useAccount()
  const exp = useExpiring()
  // Filester refreshes these every few minutes; no need to ask more often.
  const stats = useQuery({ queryKey: ['account-stats'], queryFn: getAccountStats, staleTime: 5 * 60_000 })
  const st = stats.data

  const bySlug = useMemo(() => new Map(lib.files.map((f) => [f.slug, f])), [lib.files])

  // ---- storage
  const totalSize = useMemo(() => lib.files.reduce((n, f) => n + f.size, 0), [lib.files])
  const growth = useMemo(() => {
    const m = new Map<string, number>()
    for (const f of lib.files) {
      const k = f.created_at.slice(0, 7)
      if (/^\d{4}-\d{2}$/.test(k)) m.set(k, (m.get(k) ?? 0) + f.size)
    }
    const months = [...m.keys()].sort()
    if (!months.length) return []
    // Fill gaps so the axis is even, then accumulate.
    const out: { label: string; key: string; value: number; added: number }[] = []
    let [y, mo] = months[0].split('-').map(Number)
    const last = months[months.length - 1]
    let sum = 0
    for (;;) {
      const key = `${y}-${String(mo).padStart(2, '0')}`
      const added = m.get(key) ?? 0
      sum += added
      out.push({ key, label: new Date(Date.UTC(y, mo - 1, 1)).toLocaleDateString(undefined, { month: 'short', year: '2-digit', timeZone: 'UTC' }), value: sum, added })
      if (key >= last) break
      if (++mo > 12) { mo = 1; y++ }
    }
    return out.slice(-24)
  }, [lib.files])
  const byKind = useMemo(() => {
    const m = new Map<FileKind, { n: number; size: number }>()
    for (const f of lib.files) { const e = m.get(f.kind) ?? { n: 0, size: 0 }; e.n++; e.size += f.size; m.set(f.kind, e) }
    return [...m.entries()].sort((a, b) => b[1].size - a[1].size)
  }, [lib.files])
  const bigFolders = useMemo(() => lib.folders.filter((f) => f.totalSize > 0).sort((a, b) => b.totalSize - a.totalSize).slice(0, 10), [lib.folders])
  const bigFiles = useMemo(() => [...lib.files].sort((a, b) => b.size - a.size).slice(0, 10), [lib.files])

  // ---- traffic (all-time per file comes from the CSV export, so it covers every file)
  const activity = lib.activity
  const downloadsOf = (f: FileRow) => activity?.get(f.slug)?.downloads ?? f.downloads
  const folderDownloads = useMemo(() => {
    const downloadsOf = (f: FileRow) => activity?.get(f.slug)?.downloads ?? f.downloads
    const direct = new Map<string, number>()
    for (const f of lib.files) if (f.folder_id) direct.set(f.folder_id, (direct.get(f.folder_id) ?? 0) + downloadsOf(f))
    const total = (id: string, seen = new Set<string>()): number => {
      if (seen.has(id)) return 0
      seen.add(id)
      const n = lib.byId.get(id)
      return (direct.get(id) ?? 0) + (n?.children ?? []).reduce((s, c) => s + total(c, seen), 0)
    }
    return lib.folders.map((f) => ({ folder: f, downloads: total(f.id) })).filter((x) => x.downloads > 0).sort((a, b) => b.downloads - a.downloads).slice(0, 10)
  }, [lib.files, lib.folders, lib.byId, activity])

  // ---- quiet files drifting toward Filester's inactivity limit
  const quiet = useMemo(() => {
    const now = Date.now()
    const never = exp.files.filter((f) => (activity?.get(f.slug)?.downloads ?? f.downloads) === 0)
    // No activity (as counted by the chosen rule) for 30+ days.
    const cold = exp.files.filter((f) => now - Date.parse(f.lastActive) >= 30 * DAY)
    return {
      never: { n: never.length, size: never.reduce((s, f) => s + f.size, 0) },
      cold: { n: cold.length, size: cold.reduce((s, f) => s + f.size, 0) },
      list: exp.files.filter((f) => f.daysLeft > -1 && f.level !== 'ok').slice(0, 10),
    }
  }, [exp.files, activity])

  const acct = account.data
  const loading = lib.filesLoading

  return (
    <div className="max-w-6xl mx-auto p-4 sm:p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Insights</h1>
        <p className="text-sm text-muted max-w-3xl">Where your storage goes, which files people download, and which ones nobody touches anymore (and will be deleted for inactivity).</p>
      </div>

      {stats.error && (
        <p className="flex gap-2 text-sm bg-accent-soft text-accent-ink rounded-lg px-3 py-2">
          <AlertTriangle className="size-4 shrink-0 mt-0.5" /> Couldn't load download stats from Filester: {(stats.error as Error).message}. Storage figures below still work.
        </p>
      )}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Tile label="Downloads · 24 hours" value={st ? st.totals.d24.toLocaleString() : '…'} />
        <Tile label="Downloads · 7 days" value={st ? st.totals.d7.toLocaleString() : '…'} />
        <Tile label="Downloads · 30 days" value={st ? st.totals.d30.toLocaleString() : '…'} />
        <Tile label="Storage used" value={acct ? formatBytes(acct.storage_used) : '…'}
          sub={acct ? <Meter value={acct.storage_used} max={acct.storage_limit} label={`${Math.round((acct.storage_used / acct.storage_limit) * 100)}% of ${formatBytes(acct.storage_limit, 0)}`} /> : null} />
      </div>

      {/* ---------------------------------------------------------------- traffic */}
      <div className="grid lg:grid-cols-5 gap-4">
        <Panel className="lg:col-span-3" title="Downloads per day" note="Last 30 days · Filester updates these every few minutes">
          {st ? <Columns data={st.days.map((d) => ({ key: d.day, label: formatDate(d.day + 'T12:00:00Z'), value: d.downloads }))} format={(v) => plural(v, 'download')} ticks={(i, n) => i === 0 || i === n - 1 || i === Math.floor(n / 2)} /> : <ChartSkeleton />}
        </Panel>
        <Panel className="lg:col-span-2" title="When files get downloaded" note={st?.dataSince ? `By weekday and hour (UTC), since ${formatDate(st.dataSince + 'T12:00:00Z')}` : 'By weekday and hour (UTC)'}>
          {st ? (st.heatmap ? <Heatmap grid={st.heatmap} /> : <Empty>Filester didn't return this chart.</Empty>) : <ChartSkeleton />}
        </Panel>
      </div>

      <div className="grid lg:grid-cols-2 gap-4">
        <TopFiles stats={st} bySlug={bySlug} />
        <Panel title="Most-downloaded folders" note="All time, including subfolders">
          {loading ? <ChartSkeleton /> : folderDownloads.length === 0 ? <Empty>No folder downloads yet.</Empty> : (
            <BarList rows={folderDownloads.map(({ folder, downloads }) => ({
              key: folder.id, value: downloads, valueText: downloads.toLocaleString(),
              label: <Link to="/folders/$id" params={{ id: folder.id }} className="flex items-center gap-2 min-w-0 hover:underline"><FolderIcon className="size-4 shrink-0" /><span className="truncate" title={folder.pathText}>{folder.pathText}</span></Link>,
            }))} />
          )}
        </Panel>
      </div>

      {/* ---------------------------------------------------------------- inactivity */}
      <Panel title="Quiet files" note={`Filester deletes files after ${exp.rule === 'faq' ? '35 days without downloads' : '45 days without views or downloads'}`}
        action={<Link to="/expiring" className="text-sm text-accent-ink inline-flex items-center gap-1 hover:underline">Expiring soon <ArrowRight className="size-3.5" /></Link>}>
        {loading ? <ChartSkeleton /> : (
          <div className="space-y-4">
            <div className="grid sm:grid-cols-2 gap-3">
              <div className="rounded-lg bg-raised px-3 py-2.5">
                <div className="text-xs text-muted">Never downloaded</div>
                <div className="text-lg font-semibold tabular">{plural(quiet.never.n, 'file')} <span className="text-sm font-normal text-muted">· {formatBytes(quiet.never.size)}</span></div>
              </div>
              <div className="rounded-lg bg-raised px-3 py-2.5">
                <div className="text-xs text-muted">No activity for 30+ days</div>
                <div className="text-lg font-semibold tabular">{plural(quiet.cold.n, 'file')} <span className="text-sm font-normal text-muted">· {formatBytes(quiet.cold.size)}</span></div>
              </div>
            </div>
            {quiet.list.length === 0 ? <Empty>Nothing is drifting toward deletion in the next 14 days.</Empty> : (
              <ul className="divide-y divide-line text-sm" aria-label="Files closest to deletion">
                {quiet.list.map((f) => (
                  <li key={f.id} className="flex items-center gap-2.5 py-2">
                    <FileKindIcon kind={f.kind} />
                    <FileLink file={f} />
                    <span className="hidden sm:inline text-xs text-faint tabular whitespace-nowrap">{formatBytes(f.size)} · {plural(downloadsOf(f), 'download')}</span>
                    <ExpiryBadge compact daysLeft={f.daysLeft} level={f.level} />
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </Panel>

      {/* ---------------------------------------------------------------- storage */}
      <div className="grid lg:grid-cols-5 gap-4">
        <Panel className="lg:col-span-3" title="Storage growth" note="Total size of the files you have now, by the month they were uploaded">
          {loading ? <ChartSkeleton /> : growth.length < 2 ? <Empty>Not enough history yet.</Empty>
            : <Columns data={growth.map((g) => ({ key: g.key, label: g.label, value: g.value, extra: g.added ? `+${formatBytes(g.added)} uploaded` : 'nothing uploaded' }))} format={(v) => formatBytes(v)} ticks={(i, n) => i === 0 || i === n - 1 || (n > 6 && i === Math.floor(n / 2))} />}
        </Panel>
        <Panel className="lg:col-span-2" title="By file type" note={`${formatBytes(totalSize)} in ${plural(lib.files.length, 'file')}`}>
          {loading ? <ChartSkeleton /> : byKind.length === 0 ? <Empty>No files yet.</Empty> : (
            <BarList rows={byKind.map(([k, v]) => ({
              key: k, value: v.size, valueText: formatBytes(v.size),
              label: <Link to="/files" search={{ kind: k }} className="flex items-center gap-2 min-w-0 hover:underline"><FileKindIcon kind={k} /><span className="truncate">{KIND_LABELS[k]}</span><span className="text-xs text-faint">{v.n.toLocaleString()}</span></Link>,
            }))} />
          )}
        </Panel>
      </div>

      <div className="grid lg:grid-cols-2 gap-4">
        <Panel title="Largest folders" note="Including subfolders">
          {loading ? <ChartSkeleton /> : bigFolders.length === 0 ? <Empty>No folders with files.</Empty> : (
            <BarList rows={bigFolders.map((f) => ({
              key: f.id, value: f.totalSize, valueText: formatBytes(f.totalSize),
              label: <Link to="/folders/$id" params={{ id: f.id }} className="flex items-center gap-2 min-w-0 hover:underline"><FolderIcon className="size-4 shrink-0" /><span className="truncate" title={f.pathText}>{f.pathText}</span></Link>,
            }))} />
          )}
        </Panel>
        <Panel title="Largest files">
          {loading ? <ChartSkeleton /> : bigFiles.length === 0 ? <Empty>No files yet.</Empty> : (
            <BarList rows={bigFiles.map((f) => ({ key: String(f.id), value: f.size, valueText: formatBytes(f.size), label: <span className="flex items-center gap-2 min-w-0"><FileKindIcon kind={f.kind} /><FileLink file={f} /></span> }))} />
          )}
        </Panel>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------- top files (Filester's own rankings)

type Range = '24h' | '7d' | '30d' | 'all'
const RANGE_LABEL: Record<Range, string> = { '24h': '24 hours', '7d': '7 days', '30d': '30 days', all: 'All time' }

function TopFiles({ stats, bySlug }: { stats: Awaited<ReturnType<typeof getAccountStats>> | undefined; bySlug: Map<string, FileRow> }) {
  const [range, setRange] = useState<Range>('30d')
  const items: StatItem[] = !stats ? [] : range === 'all' ? stats.alltimeFiles : stats.trendingFiles[range]
  return (
    <Panel title="Most-downloaded files" note="From Filester's own stats"
      action={
        <div className="flex gap-1" role="tablist" aria-label="Time range">
          {(Object.keys(RANGE_LABEL) as Range[]).map((r) => (
            <button key={r} role="tab" aria-selected={range === r} className={`${range === r ? 'chip-active' : 'chip'} h-7`} onClick={() => setRange(r)}>{r === 'all' ? 'All' : r}</button>
          ))}
        </div>
      }>
      {!stats ? <ChartSkeleton /> : items.length === 0 ? <Empty>No downloads in the last {RANGE_LABEL[range].toLowerCase()}.</Empty> : (
        <>
          <BarList rows={items.slice(0, 10).map((it) => {
            const f = it.id ? bySlug.get(it.id) : undefined
            return {
              key: `${it.id}-${it.name}`, value: it.downloads, valueText: it.downloads.toLocaleString(),
              label: f
                ? <span className="flex items-center gap-2 min-w-0"><FileKindIcon kind={f.kind} /><FileLink file={f} /></span>
                : <span className="truncate text-muted" title="No longer in your account">{it.name}</span>,
            }
          })} />
          {(stats.risingFiles.length > 0 || stats.coolingFiles.length > 0) && (
            <div className="grid sm:grid-cols-2 gap-3 mt-4 pt-3 border-t border-line text-sm">
              <MiniList title="Rising" items={stats.risingFiles} />
              <MiniList title="Cooling off" items={stats.coolingFiles} />
            </div>
          )}
        </>
      )}
    </Panel>
  )
}

function MiniList({ title, items }: { title: string; items: StatItem[] }) {
  if (!items.length) return null
  return (
    <div>
      <div className="text-xs text-muted mb-1">{title}</div>
      <ul className="space-y-0.5">{items.slice(0, 5).map((it) => <li key={`${it.id}-${it.name}`} className="flex gap-2"><span className="truncate flex-1" title={it.name}>{it.name}</span><span className="tabular text-muted">{it.downloads}</span></li>)}</ul>
    </div>
  )
}

// ---------------------------------------------------------------- building blocks

function FileLink({ file }: { file: FileRow }) {
  return (
    <Link to="/folders/$id" params={{ id: file.folder_id ?? 'root' }} search={{ file: file.slug }} className="truncate flex-1 min-w-0 hover:underline" title={file.folderPath ? `${file.folderPath} / ${file.name}` : file.name}>
      {file.name}
    </Link>
  )
}

function Tile({ label, value, sub }: { label: string; value: React.ReactNode; sub?: React.ReactNode }) {
  return (
    <div className="card p-4">
      <div className="text-xs text-muted">{label}</div>
      <div className="text-2xl font-semibold mt-1 tabular">{value}</div>
      {sub && <div className="mt-1.5">{sub}</div>}
    </div>
  )
}

function Meter({ value, max, label }: { value: number; max: number; label: string }) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0
  return (
    <div>
      <div className="h-1.5 rounded-full bg-raised overflow-hidden" role="meter" aria-valuemin={0} aria-valuemax={max} aria-valuenow={value} aria-label="Storage used">
        <div className="h-full rounded-full bg-accent" style={{ width: `${Math.max(pct, value > 0 ? 2 : 0)}%` }} />
      </div>
      <div className="text-xs text-faint mt-1">{label}</div>
    </div>
  )
}

function Panel({ title, note, action, className = '', children }: { title: string; note?: string; action?: React.ReactNode; className?: string; children: React.ReactNode }) {
  return (
    <section className={`card p-4 min-w-0 ${className}`} aria-label={title}>
      <div className="flex flex-wrap items-start gap-x-3 gap-y-1 mb-3">
        <div className="flex-1 min-w-0">
          <h2 className="font-semibold">{title}</h2>
          {note && <p className="text-xs text-faint">{note}</p>}
        </div>
        {action}
      </div>
      {children}
    </section>
  )
}

const Empty = ({ children }: { children: React.ReactNode }) => <p className="text-sm text-faint py-6 text-center flex items-center justify-center gap-1.5"><Info className="size-4" />{children}</p>
const ChartSkeleton = () => <div className="h-40 rounded-lg bg-raised animate-pulse" />

/** Horizontal bars with the label above: one measure, one hue, value as text. */
function BarList({ rows }: { rows: { key: string; label: React.ReactNode; value: number; valueText: string }[] }) {
  const max = Math.max(1, ...rows.map((r) => r.value))
  return (
    <ul className="space-y-2.5">
      {rows.map((r) => (
        <li key={r.key} className="group text-sm">
          <div className="flex items-center gap-3 min-w-0">
            <div className="flex-1 min-w-0 flex">{r.label}</div>
            <span className="tabular text-muted whitespace-nowrap">{r.valueText}</span>
          </div>
          <div className="h-1.5 mt-1 rounded-full bg-raised">
            <div className="h-full rounded-full bg-accent/80 group-hover:bg-accent transition-colors" style={{ width: `${Math.max(1, (r.value / max) * 100)}%` }} />
          </div>
        </li>
      ))}
    </ul>
  )
}

/** Vertical columns with a hover readout (and a hidden table for screen readers). */
function Columns({ data, format, ticks }: { data: { key: string; label: string; value: number; extra?: string }[]; format: (v: number) => string; ticks: (i: number, n: number) => boolean }) {
  const [hover, setHover] = useState<number | null>(null)
  const max = Math.max(1, ...data.map((d) => d.value))
  const total = data.reduce((s, d) => s + d.value, 0)
  const shown = hover !== null ? data[hover] : null
  return (
    <div>
      <div className="h-5 text-xs text-muted tabular mb-1" aria-live="polite">
        {shown ? <><b className="text-ink font-medium">{format(shown.value)}</b> · {shown.label}{shown.extra && ` · ${shown.extra}`}</> : <span className="text-faint">Hover or tap a bar for details</span>}
      </div>
      <div className="relative h-40" onMouseLeave={() => setHover(null)}>
        {/* recessive gridlines at 50% and 100% */}
        <div className="absolute inset-x-0 top-0 border-t border-dashed border-line" />
        <div className="absolute inset-x-0 top-1/2 border-t border-dashed border-line" />
        <div className="absolute right-0 -top-0.5 -translate-y-full text-[10px] text-faint tabular">{format(max)}</div>
        <div className="absolute inset-0 flex items-end gap-[2px]" aria-hidden>
          {data.map((d, i) => (
            <div key={d.key} className="flex-1 h-full flex items-end justify-center cursor-default" onMouseEnter={() => setHover(i)} onClick={() => setHover(i)}>
              <div className={`w-full max-w-12 rounded-t-[4px] transition-colors ${hover === i ? 'bg-accent' : 'bg-accent/70'} ${d.value === 0 ? 'opacity-0' : ''}`}
                style={{ height: `${d.value === 0 ? 0 : Math.max(2, (d.value / max) * 100)}%` }} />
            </div>
          ))}
        </div>
        <div className="absolute inset-x-0 bottom-0 border-t border-line" />
      </div>
      <div className="relative h-4 mt-1 text-[10px] text-faint">
        {data.map((d, i) => ticks(i, data.length) && (
          <span key={d.key} className="absolute whitespace-nowrap" style={{ left: `${((i + 0.5) / data.length) * 100}%`, transform: i === 0 ? 'translateX(-15%)' : i === data.length - 1 ? 'translateX(-85%)' : 'translateX(-50%)' }}>{d.label}</span>
        ))}
      </div>
      <table className="sr-only">
        <caption>Values, total {format(total)}</caption>
        <tbody>{data.map((d) => <tr key={d.key}><th>{d.label}</th><td>{format(d.value)}</td></tr>)}</tbody>
      </table>
    </div>
  )
}

/** 7×24 grid, one hue light → dark. Zero cells stay neutral. */
function Heatmap({ grid }: { grid: number[][] }) {
  const [hover, setHover] = useState<[number, number] | null>(null)
  const max = Math.max(0, ...grid.flat())
  const step = (v: number) => (v === 0 || max === 0 ? 0 : Math.min(4, Math.ceil((v / max) * 4)))
  const fill = ['', 'bg-accent/25', 'bg-accent/45', 'bg-accent/70', 'bg-accent']
  const hour = (h: number) => `${String(h).padStart(2, '0')}:00`
  const shown = hover ? grid[hover[0]][hover[1]] : null
  if (max === 0) return <Empty>No downloads recorded yet.</Empty>
  return (
    <div>
      <div className="h-5 text-xs text-muted tabular mb-1" aria-live="polite">
        {hover ? <><b className="text-ink font-medium">{plural(shown!, 'download')}</b> · {WEEKDAYS[hover[0]]} {hour(hover[1])}–{hour((hover[1] + 1) % 24)} UTC</> : <span className="text-faint">Hover or tap a cell for details</span>}
      </div>
      <div className="grid gap-[2px]" style={{ gridTemplateColumns: 'auto repeat(24, minmax(0, 1fr))' }} onMouseLeave={() => setHover(null)} role="img"
        aria-label={`Downloads by weekday and hour. Busiest: ${busiest(grid)}`}>
        {grid.map((row, d) => [
          <div key={`l${d}`} className="text-[10px] text-faint pr-1.5 leading-none flex items-center">{WEEKDAYS[d]}</div>,
          ...row.map((v, h) => (
            <div key={`${d}-${h}`} className={`aspect-square rounded-[3px] ${v ? fill[step(v)] : 'bg-raised'} ${hover?.[0] === d && hover?.[1] === h ? 'ring-2 ring-ink/60' : ''}`}
              onMouseEnter={() => setHover([d, h])} onClick={() => setHover([d, h])} />
          )),
        ])}
      </div>
      <div className="flex items-center justify-between mt-1.5 text-[10px] text-faint">
        <span className="pl-7">00</span><span>06</span><span>12</span><span>18</span><span>23</span>
      </div>
      <div className="flex items-center gap-1 justify-end mt-2 text-[10px] text-faint">
        Less {['bg-raised', ...fill.slice(1)].map((c) => <span key={c} className={`size-2.5 rounded-[2px] ${c}`} />)} More
      </div>
    </div>
  )
}

function busiest(grid: number[][]) {
  let best = [0, 0, -1]
  grid.forEach((row, d) => row.forEach((v, h) => { if (v > best[2]) best = [d, h, v] }))
  return `${WEEKDAYS[best[0]]} around ${String(best[1]).padStart(2, '0')}:00 UTC`
}

