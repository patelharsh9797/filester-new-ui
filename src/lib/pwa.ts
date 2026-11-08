import { useCallback, useEffect, useState } from 'react'

/** Chrome/Edge's install event (not in the standard DOM typings). */
interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

declare global {
  interface Window {
    __fsnavInstall?: BeforeInstallPromptEvent | null
  }
}

const KEY = 'fsnav.install'

export function installChoice(): 'dismissed' | 'installed' | null {
  try {
    const v = localStorage.getItem(KEY)
    return v === 'dismissed' || v === 'installed' ? v : null
  } catch {
    return null
  }
}

export function rememberInstallChoice(v: 'dismissed' | 'installed') {
  try { localStorage.setItem(KEY, v) } catch { /* per-session only */ }
}

export function isStandalone() {
  if (typeof window === 'undefined') return false
  return window.matchMedia?.('(display-mode: standalone)').matches
    || window.matchMedia?.('(display-mode: window-controls-overlay)').matches
    || (navigator as Navigator & { standalone?: boolean }).standalone === true
}

/** iPhone / iPad Safari (iPadOS reports itself as a Mac with touch). */
export function isIos() {
  if (typeof navigator === 'undefined') return false
  const ua = navigator.userAgent
  return /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)
}

export function usePwaInstall() {
  const [prompt, setPrompt] = useState<BeforeInstallPromptEvent | null>(() => (typeof window !== 'undefined' ? window.__fsnavInstall ?? null : null))
  const [installed, setInstalled] = useState(() => isStandalone() || installChoice() === 'installed')

  useEffect(() => {
    const onReady = () => setPrompt(window.__fsnavInstall ?? null)
    const onInstalled = () => { setPrompt(null); setInstalled(true) }
    window.addEventListener('fsnav-installable', onReady)
    window.addEventListener('fsnav-installed', onInstalled)
    return () => {
      window.removeEventListener('fsnav-installable', onReady)
      window.removeEventListener('fsnav-installed', onInstalled)
    }
  }, [])

  /** Shows the browser's install dialog. Resolves true if the user accepted. */
  const install = useCallback(async () => {
    const e = window.__fsnavInstall
    if (!e) return false
    await e.prompt()
    const { outcome } = await e.userChoice
    window.__fsnavInstall = null
    setPrompt(null)
    if (outcome === 'accepted') { rememberInstallChoice('installed'); setInstalled(true) }
    return outcome === 'accepted'
  }, [])

  return {
    /** Browser can show its own install dialog (Chrome, Edge, Samsung Internet…) */
    canPrompt: !!prompt,
    /** Needs manual "Add to Home Screen" (iOS) */
    ios: isIos(),
    installed,
    install,
  }
}

/** Register the service worker (production builds only, so dev never serves stale code). */
export function registerServiceWorker() {
  if (!import.meta.env.PROD || typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return
  const go = () => navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(() => { /* app works without it */ })
  if (document.readyState === 'complete') go()
  else window.addEventListener('load', go, { once: true })
}
