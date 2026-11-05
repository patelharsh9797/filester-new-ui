import { useQuery } from '@tanstack/react-query'
import { Copy, Download, ExternalLink } from 'lucide-react'
import { Link } from 'react-router-dom'
import { getFileInfo } from '../lib/api'
import { formatBytes, formatDate, formatRelative } from '../lib/format'
import type { FileRow } from '../lib/types'
import { Modal } from '../state/dialogs'
import { copyText } from '../state/actions'
import { useToast } from '../state/toast'
import { FileKindIcon } from './icons'

export function FileInfoDialog({ file, onClose }: { file: FileRow; onClose: () => void }) {
  const toast = useToast()
  const info = useQuery({ queryKey: ['file-info', file.slug], queryFn: () => getFileInfo(file.slug) })
  const d = info.data
  const rows: [string, React.ReactNode][] = [
    ['Size', `${formatBytes(file.size, 2)} (${file.size.toLocaleString()} bytes)`],
    ['Type', d?.type || file.type],
    ['Folder', file.folder_id ? <Link className="text-accent-ink hover:underline" to={`/folders/${file.folder_id}`} onClick={onClose}>{file.folderPath || d?.folder_name}</Link> : 'Top level'],
    ['Uploaded', formatDate(file.created_at)],
    ['Views', d ? d.views.toLocaleString() : '…'],
    ['Downloads', (d?.downloads ?? file.downloads).toLocaleString()],
    ['Last viewed', d ? formatRelative(d.last_viewed) : '…'],
    ['Last downloaded', d ? formatRelative(d.last_downloaded) : '…'],
    ['MD5', d?.md5 ? <span className="font-mono text-xs break-all">{d.md5}</span> : '—'],
    ['Slug', <span className="font-mono text-xs">{file.slug}</span>],
  ]
  return (
    <Modal title={<span className="flex items-center gap-2 min-w-0"><FileKindIcon kind={file.kind} /><span className="truncate">{file.name}</span></span>}
      onClose={onClose} wide footer={<>
        <button className="btn mr-auto" onClick={() => copyText(file.url, toast)}><Copy className="size-4" /> Copy link</button>
        <a className="btn" href={file.url} target="_blank" rel="noreferrer"><ExternalLink className="size-4" /> Open on Filester</a>
        <a className="btn-primary" href={file.url} target="_blank" rel="noreferrer"><Download className="size-4" /> Download page</a>
      </>}>
      {(d?.blocked || d?.flagged) && <p className="text-sm text-danger bg-danger-soft rounded-md px-3 py-2 mb-3">This file is {d.blocked ? 'blocked' : 'flagged'} by Filester.</p>}
      <p className="text-xs text-faint mb-3">Files are deleted after 45 days without views or downloads.</p>
      <dl className="grid grid-cols-[130px_1fr] gap-y-2 text-sm">
        {rows.map(([k, v]) => <div key={k} className="contents"><dt className="text-muted">{k}</dt><dd className="min-w-0">{v}</dd></div>)}
      </dl>
      {info.error && <p className="text-xs text-danger mt-3">Couldn't load extra details: {(info.error as Error).message}</p>}
    </Modal>
  )
}
