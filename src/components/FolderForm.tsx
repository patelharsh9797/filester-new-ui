import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Lock, TriangleAlert } from 'lucide-react'
import { Modal } from '../state/dialogs'
import { getFolderInfo } from '../lib/api'
import type { FolderNode } from '../lib/types'

export interface FolderFormValues {
  name: string
  isPublic: boolean
  password: string
  hideRelated: boolean
}

/**
 * Create / edit folder dialog.
 *
 * Filester's edit endpoint wipes an existing password when the password field
 * is blank, so for protected folders we require the password to be re-entered
 * (or the user to explicitly choose to remove it).
 */
export function FolderFormDialog({ mode, folder, parentLabel, onDone }: {
  mode: 'create' | 'edit'
  folder?: FolderNode
  parentLabel?: string
  onDone: (v: FolderFormValues | null) => void
}) {
  const info = useQuery({
    queryKey: ['folder-info', folder?.id],
    queryFn: () => getFolderInfo(folder!.id),
    enabled: mode === 'edit' && !!folder,
  })
  const [name, setName] = useState(folder?.name ?? '')
  const [isPublic, setPublic] = useState(folder?.public ?? true)
  const [password, setPassword] = useState('')
  const [removePassword, setRemovePassword] = useState(false)
  const [hideRelated, setHideRelated] = useState(false)

  useEffect(() => { if (info.data) setHideRelated(info.data.hide_related) }, [info.data])

  const hasPassword = !!info.data?.has_password
  const needsPassword = mode === 'edit' && hasPassword && isPublic && !removePassword && !password
  const waiting = mode === 'edit' && info.isPending
  const valid = name.trim().length > 0 && name.trim().length <= 100 && !needsPassword && !waiting

  const submit = () => valid && onDone({ name: name.trim(), isPublic, password: isPublic && !removePassword ? password : '', hideRelated })

  return (
    <Modal title={mode === 'create' ? 'New folder' : 'Edit folder'} onClose={() => onDone(null)} footer={<>
      <button className="btn" onClick={() => onDone(null)}>Cancel</button>
      <button className="btn-primary" disabled={!valid} onClick={submit}>{mode === 'create' ? 'Create' : 'Save'}</button>
    </>}>
      <div className="space-y-4">
        {mode === 'create' && parentLabel && <p className="text-xs text-faint -mt-1">Inside <span className="text-muted">{parentLabel}</span></p>}
        <div>
          <label className="block text-sm text-muted mb-1.5">Name</label>
          <input autoFocus className="input" maxLength={100} value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && submit()} />
        </div>

        <label className="flex items-start gap-2.5 text-sm cursor-pointer">
          <input type="checkbox" className="mt-0.5 accent-[var(--color-accent)]" checked={isPublic} onChange={(e) => setPublic(e.target.checked)} />
          <span><span className="font-medium">Public</span><span className="block text-xs text-faint">Anyone with the folder link can browse it. Private folders can't have a password.</span></span>
        </label>

        {isPublic && (
          <div>
            <label className="block text-sm text-muted mb-1.5">
              <Lock className="inline size-3.5 -mt-0.5 mr-1" />
              {mode === 'create' ? 'Password (optional)' : hasPassword ? 'Folder password' : 'Set a password (optional)'}
            </label>
            <input type="password" className="input" value={password} disabled={removePassword} autoComplete="new-password"
              placeholder={hasPassword ? 'Re-enter the current or a new password' : ''} onChange={(e) => setPassword(e.target.value)} />
            {mode === 'edit' && hasPassword && (
              <>
                <p className="flex gap-1.5 text-xs text-accent-ink bg-accent-soft rounded-md px-2 py-1.5 mt-2">
                  <TriangleAlert className="size-3.5 shrink-0 mt-px" />
                  This folder is password-protected. Filester removes the password when you save without one, so enter it again to keep it.
                </p>
                <label className="flex items-center gap-2 text-xs text-muted mt-2 cursor-pointer">
                  <input type="checkbox" checked={removePassword} onChange={(e) => setRemovePassword(e.target.checked)} /> Remove password
                </label>
              </>
            )}
          </div>
        )}

        {mode === 'edit' && (
          <label className="flex items-start gap-2.5 text-sm cursor-pointer">
            <input type="checkbox" className="mt-0.5" checked={hideRelated} onChange={(e) => setHideRelated(e.target.checked)} />
            <span><span className="font-medium">Hide related</span><span className="block text-xs text-faint">Don't show other folders on this folder's public page.</span></span>
          </label>
        )}
      </div>
    </Modal>
  )
}
