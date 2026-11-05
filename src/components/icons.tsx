import { FileArchive, FileAudio, FileCode, FileImage, FileText, FileVideo, File as FileGeneric } from 'lucide-react'
import type { FileKind } from '../lib/types'

export function FolderIcon({ className = 'size-5', open }: { className?: string; open?: boolean }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden>
      <path fill="var(--color-folder)" d={open
        ? 'M3 7a2 2 0 0 1 2-2h4l2 2h7a2 2 0 0 1 2 2v1H7.5a2 2 0 0 0-1.9 1.4L3 19z M6 12h16l-2.6 7.2A2 2 0 0 1 17.5 20H4z'
        : 'M3 6.5A2.5 2.5 0 0 1 5.5 4h3.6c.5 0 1 .2 1.4.6L12 6h6.5A2.5 2.5 0 0 1 21 8.5v9a2.5 2.5 0 0 1-2.5 2.5h-13A2.5 2.5 0 0 1 3 17.5z'} />
    </svg>
  )
}

const KIND_ICON = { video: FileVideo, image: FileImage, audio: FileAudio, document: FileText, archive: FileArchive, code: FileCode, other: FileGeneric }
const KIND_COLOR: Record<FileKind, string> = {
  video: 'text-violet-500', image: 'text-sky-500', audio: 'text-pink-500', document: 'text-blue-500',
  archive: 'text-amber-600', code: 'text-emerald-500', other: 'text-faint',
}

export function FileKindIcon({ kind, className = 'size-4' }: { kind: FileKind; className?: string }) {
  const Icon = KIND_ICON[kind]
  return <Icon className={`${className} ${KIND_COLOR[kind]} shrink-0`} aria-hidden />
}
