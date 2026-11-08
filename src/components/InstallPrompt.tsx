import { useEffect, useState } from 'react'
import { Download, Share, SquarePlus } from 'lucide-react'
import { Modal } from '../state/dialogs'
import { installChoice, rememberInstallChoice, usePwaInstall } from '../lib/pwa'

/**
 * Offered once after sign-in: Chrome/Edge/Android get the browser's install
 * dialog, iPhone/iPad get Add-to-Home-Screen steps (Apple has no install API).
 * Never shown inside the installed app or after the user dismissed it.
 */
export function InstallPrompt() {
  const pwa = usePwaInstall()
  const [open, setOpen] = useState(false)

  useEffect(() => {
    if (pwa.installed || installChoice()) return
    if (!pwa.canPrompt && !pwa.ios) return
    // Let the app finish loading first.
    const t = setTimeout(() => setOpen(true), 1500)
    return () => clearTimeout(t)
  }, [pwa.installed, pwa.canPrompt, pwa.ios])

  if (!open || pwa.installed) return null

  const close = () => { rememberInstallChoice('dismissed'); setOpen(false) }

  return (
    <Modal title="Install Filester Navigator" onClose={close} footer={
      pwa.canPrompt ? <>
        <button className="btn" onClick={close}>Not now</button>
        <button className="btn-primary" onClick={async () => { const ok = await pwa.install(); if (!ok) rememberInstallChoice('dismissed'); setOpen(false) }}>
          <Download className="size-4" /> Install app
        </button>
      </> : <button className="btn-primary" onClick={close}>Got it</button>
    }>
      <div className="flex gap-4">
        <img src="/icons/icon-192.png" alt="" className="size-16 rounded-2xl shrink-0" />
        <div className="text-sm text-muted space-y-2">
          <p>Add it to your {pwa.ios ? 'home screen' : 'device'} to open it like an app — full screen, with its own icon, no browser bars.</p>
          {pwa.ios && !pwa.canPrompt && (
            <ol className="space-y-2 text-ink">
              <li className="flex items-start gap-2">
                <span className="size-6 shrink-0 rounded-full bg-raised grid place-items-center text-xs font-semibold">1</span>
                <span className="pt-0.5">Tap <Share className="inline size-4 -mt-1 text-accent-ink" /> <b>Share</b> in Safari's toolbar</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="size-6 shrink-0 rounded-full bg-raised grid place-items-center text-xs font-semibold">2</span>
                <span className="pt-0.5">Choose <SquarePlus className="inline size-4 -mt-1 text-accent-ink" /> <b>Add to Home Screen</b></span>
              </li>
            </ol>
          )}
          <p className="text-xs text-faint">You can do this later from Settings.</p>
        </div>
      </div>
    </Modal>
  )
}
