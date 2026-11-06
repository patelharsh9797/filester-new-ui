import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'
import { Link, Outlet, useLocation, useParams } from '@tanstack/react-router'
import { Files, FolderTree as FolderTreeIcon, LayoutDashboard, LogOut, Menu as MenuIcon, RefreshCw, Search, Settings, Upload, X } from 'lucide-react'
import { useAccount, useLibrary } from '../lib/library'
import { formatBytes } from '../lib/format'
import { useSession, useSignOut } from '../state/session'
import { useActions } from '../state/actions'
import { useOpenDialog } from '../state/dialogs'
import { FolderTree } from './FolderTree'
import { SearchPalette } from './SearchPalette'
import { UploadDialog, UploadDock } from './Uploads'
import { FolderIcon } from './icons'

interface ShellCtx {
  openSearch: (scope?: 'all' | 'folders' | 'files') => void
  openUpload: (folder?: string | null, files?: File[]) => void
}
const Ctx = createContext<ShellCtx>({ openSearch: () => {}, openUpload: () => {} })
export const useShell = () => useContext(Ctx)

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform)

export function Layout() {
  const session = useSession()
  const signOut = useSignOut()
  const lib = useLibrary()
  const account = useAccount()
  const actions = useActions()
  const openDialog = useOpenDialog()
  const params = useParams({ strict: false })
  const location = useLocation()
  const [searchScope, setSearchScope] = useState<null | 'all' | 'folders' | 'files'>(null)
  const [drawer, setDrawer] = useState(false)
  const [dragging, setDragging] = useState(false)
  const dragDepth = useRef(0)

  const currentFolder = params.id && params.id !== 'root' ? params.id : null

  const openUpload = useCallback((folder: string | null = currentFolder, files: File[] = []) => {
    openDialog((close) => <UploadDialog folder={folder} initialFiles={files} onClose={close} />)
  }, [openDialog, currentFolder])

  const openSearch = useCallback((scope: 'all' | 'folders' | 'files' = 'all') => setSearchScope(scope), [])

  useEffect(() => setDrawer(false), [location.pathname])

  // Keyboard shortcuts
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement
      const typing = t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setSearchScope((s) => (s ? null : 'all')) }
      else if (!typing && e.key === '/') { e.preventDefault(); setSearchScope('all') }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // Drop files anywhere to upload into the current folder
  useEffect(() => {
    const hasFiles = (e: DragEvent) => e.dataTransfer?.types.includes('Files')
    const enter = (e: DragEvent) => { if (!hasFiles(e)) return; dragDepth.current++; setDragging(true) }
    const leave = (e: DragEvent) => { if (!hasFiles(e)) return; if (--dragDepth.current <= 0) { dragDepth.current = 0; setDragging(false) } }
    const over = (e: DragEvent) => { if (hasFiles(e)) e.preventDefault() }
    const drop = (e: DragEvent) => {
      if (!hasFiles(e)) return
      dragDepth.current = 0
      setDragging(false)
      // Let dialogs with their own drop zones handle it
      if ((e.target as HTMLElement).closest('[role=dialog]')) return
      e.preventDefault()
      const files = Array.from(e.dataTransfer?.files ?? [])
      if (files.length) openUpload(currentFolder, files)
    }
    window.addEventListener('dragenter', enter)
    window.addEventListener('dragleave', leave)
    window.addEventListener('dragover', over)
    window.addEventListener('drop', drop)
    return () => {
      window.removeEventListener('dragenter', enter)
      window.removeEventListener('dragleave', leave)
      window.removeEventListener('dragover', over)
      window.removeEventListener('drop', drop)
    }
  }, [openUpload, currentFolder])

  const acct = account.data
  const pct = acct ? Math.min(100, (acct.storage_used / acct.storage_limit) * 100) : 0

  const navCls = 'flex items-center gap-2.5 rounded-lg px-2.5 h-9 text-sm'
  const nav = (to: '/' | '/folders' | '/files', icon: React.ReactNode, label: string, count?: number) => (
    <Link to={to} className={navCls} activeOptions={{ exact: to === '/', includeSearch: false }}
      activeProps={{ className: 'bg-hover text-ink font-medium' }} inactiveProps={{ className: 'text-muted hover:bg-hover hover:text-ink' }}>
      {icon}<span className="flex-1">{label}</span>{count !== undefined && <span className="text-xs text-faint tabular">{count.toLocaleString()}</span>}
    </Link>
  )

  const sidebar = (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-2 px-4 h-14 shrink-0">
        <FolderIcon className="size-6" />
        <span className="font-semibold tracking-tight">Filester<span className="text-faint font-normal"> Navigator</span></span>
        <button className="btn-icon ml-auto lg:hidden" onClick={() => setDrawer(false)} aria-label="Close menu"><X className="size-4" /></button>
      </div>
      <nav className="px-2 space-y-0.5">
        {nav('/', <LayoutDashboard className="size-4" />, 'Overview')}
        {nav('/folders', <FolderTreeIcon className="size-4" />, 'Folders', lib.foldersLoading ? undefined : lib.folders.length)}
        {nav('/files', <Files className="size-4" />, 'Files', lib.filesLoading ? undefined : lib.files.length)}
      </nav>
      <div className="mt-5 mb-1.5 px-4 flex items-center justify-between">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-faint">Folder tree</span>
        <button className="text-[11px] text-faint hover:text-ink" onClick={() => actions.newFolder(null)}>+ New</button>
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto pb-3">
        <Link to="/folders/$id" params={{ id: 'root' }} className="ml-6 mr-1 flex items-center gap-1.5 rounded-md px-1.5 py-1 text-[13px]"
          activeOptions={{ includeSearch: false }}
          activeProps={{ className: 'bg-accent-soft text-accent-ink font-medium' }} inactiveProps={{ className: 'text-muted hover:bg-hover hover:text-ink' }}>
          <Files className="size-4" /> Unfiled files <span className="ml-auto text-[11px] text-faint tabular">{lib.filesLoading ? '' : lib.rootFiles.length}</span>
        </Link>
        <FolderTree onNavigate={() => setDrawer(false)} />
      </div>
      <div className="border-t border-line p-3 space-y-3 shrink-0">
        {acct && (
          <div>
            <div className="flex justify-between text-xs mb-1.5"><span className="text-muted">Storage</span><span className="text-faint tabular">{formatBytes(acct.storage_used)} / {formatBytes(acct.storage_limit, 0)}</span></div>
            <div className="h-1.5 rounded-full bg-raised overflow-hidden"><div className={`h-full ${pct > 90 ? 'bg-danger' : 'bg-accent'}`} style={{ width: `${Math.max(pct, 1)}%` }} /></div>
          </div>
        )}
        <div className="flex items-center gap-1">
          <div className="size-7 rounded-full bg-accent-soft text-accent-ink grid place-items-center text-xs font-semibold uppercase">{session?.username.slice(0, 1)}</div>
          <span className="text-sm truncate flex-1 ml-1">{session?.username}</span>
          <Link to="/settings" className="btn-icon" aria-label="Settings"><Settings className="size-4" /></Link>
          <button className="btn-icon" onClick={() => signOut()} aria-label="Sign out"><LogOut className="size-4" /></button>
        </div>
      </div>
    </div>
  )

  return (
    <Ctx.Provider value={{ openSearch, openUpload }}>
      <div className="flex h-full">
        <aside className="hidden lg:block w-64 shrink-0 border-r border-line bg-panel">{sidebar}</aside>
        {drawer && (
          <div className="fixed inset-0 z-40 lg:hidden" onClick={() => setDrawer(false)}>
            <div className="absolute inset-0 bg-black/40" />
            <aside className="absolute inset-y-0 left-0 w-72 bg-panel shadow-2xl" onClick={(e) => e.stopPropagation()}>{sidebar}</aside>
          </div>
        )}
        <div className="flex-1 min-w-0 flex flex-col">
          <header className="h-14 shrink-0 flex items-center gap-2 px-4 border-b border-line bg-panel/80 backdrop-blur sticky top-0 z-30">
            <button className="btn-icon lg:hidden -ml-1" onClick={() => setDrawer(true)} aria-label="Open menu"><MenuIcon className="size-5" /></button>
            <button onClick={() => openSearch('all')} className="flex-1 max-w-xl flex items-center gap-2.5 h-9 px-3 rounded-lg border border-line bg-bg text-sm text-faint hover:border-faint/50 transition-colors">
              <Search className="size-4" /><span className="flex-1 text-left truncate">Search folders &amp; files…</span>
              <kbd className="hidden sm:inline text-[11px] border border-line rounded px-1.5 py-0.5">{isMac ? '⌘' : 'Ctrl'} K</kbd>
            </button>
            <div className="ml-auto flex items-center gap-1.5">
              <button className="btn-icon" onClick={() => actions.refresh()} aria-label="Refresh" title="Reload from Filester">
                <RefreshCw className={`size-4 ${lib.fetching ? 'animate-spin' : ''}`} />
              </button>
              <button className="btn-primary" onClick={() => openUpload()}><Upload className="size-4" /><span className="hidden sm:inline">Upload</span></button>
            </div>
          </header>
          {lib.error && (
            <div className="px-4 py-2 bg-danger-soft text-danger text-sm border-b border-line">Couldn't load your library: {(lib.error as Error).message}</div>
          )}
          <main className="flex-1 min-h-0 overflow-y-auto">
            <Outlet />
          </main>
        </div>
      </div>
      {searchScope && <SearchPalette initialScope={searchScope} onClose={() => setSearchScope(null)} />}
      {dragging && (
        <div className="fixed inset-0 z-[70] pointer-events-none grid place-items-center bg-accent/10 border-4 border-dashed border-accent">
          <div className="card px-6 py-4 shadow-2xl text-center">
            <Upload className="size-6 mx-auto text-accent mb-1" />
            <p className="font-medium">Drop to upload</p>
            <p className="text-sm text-muted">to {currentFolder ? lib.byId.get(currentFolder)?.pathText : 'Top level'}</p>
          </div>
        </div>
      )}
      <UploadDock />
    </Ctx.Provider>
  )
}
