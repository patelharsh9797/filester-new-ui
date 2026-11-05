import type { FileKind } from './types'

export function formatBytes(n: number, digits = 1): string {
  if (!Number.isFinite(n) || n <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.min(units.length - 1, Math.floor(Math.log(n) / Math.log(1024)))
  const v = n / 1024 ** i
  return `${v.toFixed(i === 0 ? 0 : v < 10 ? digits : 0)} ${units[i]}`
}

export function formatDate(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime()) || d.getFullYear() < 2000) return '—'
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
}

export function formatRelative(iso: string): string {
  const d = new Date(iso).getTime()
  if (Number.isNaN(d)) return '—'
  const s = (Date.now() - d) / 1000
  if (s < 60) return 'just now'
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`
  if (s < 86400 * 30) return `${Math.floor(s / 86400)}d ago`
  return formatDate(iso)
}

const KINDS: Record<Exclude<FileKind, 'other'>, string[]> = {
  video: ['mp4', 'mkv', 'webm', 'mov', 'avi', 'wmv', 'flv', 'm4v', 'ts', 'mpg', 'mpeg', '3gp'],
  image: ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'svg', 'heic', 'avif', 'tiff', 'ico'],
  audio: ['mp3', 'flac', 'wav', 'aac', 'ogg', 'm4a', 'opus', 'wma'],
  document: ['pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'txt', 'md', 'rtf', 'odt', 'csv', 'epub'],
  archive: ['zip', 'rar', '7z', 'tar', 'gz', 'bz2', 'xz', 'iso', 'dmg', 'apk', 'exe', 'msi'],
  code: ['js', 'ts', 'tsx', 'jsx', 'py', 'json', 'html', 'css', 'go', 'rs', 'java', 'c', 'cpp', 'sh', 'yml', 'yaml', 'xml', 'sql'],
}
const EXT_TO_KIND = new Map<string, FileKind>()
for (const [kind, exts] of Object.entries(KINDS)) for (const e of exts) EXT_TO_KIND.set(e, kind as FileKind)

export function extOf(name: string): string {
  const i = name.lastIndexOf('.')
  return i > 0 ? name.slice(i + 1).toLowerCase() : ''
}

/** Filester often reports application/octet-stream, so prefer the extension. */
export function kindOf(name: string, mime: string): FileKind {
  const byExt = EXT_TO_KIND.get(extOf(name))
  if (byExt) return byExt
  const top = mime.split('/')[0]
  if (top === 'video' || top === 'image' || top === 'audio') return top
  if (mime === 'application/pdf' || top === 'text') return 'document'
  return 'other'
}

export const KIND_LABELS: Record<FileKind, string> = {
  video: 'Video', image: 'Image', audio: 'Audio', document: 'Document', archive: 'Archive', code: 'Code', other: 'Other',
}

export function slugOf(url: string): string {
  const m = /\/d\/([^/?#]+)/.exec(url)
  return m ? m[1] : url
}

export const folderUrl = (id: string) => `https://filester.me/f/${id}`
