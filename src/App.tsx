import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { useAuth } from './state/auth'
import { DialogProvider } from './state/dialogs'
import { UploadProvider } from './state/uploads'
import { Layout } from './components/Layout'
import { LoginPage } from './pages/Login'
import { OverviewPage } from './pages/Overview'
import { FoldersPage } from './pages/Folders'
import { FolderPage } from './pages/Folder'
import { FilesPage } from './pages/Files'
import { SettingsPage } from './pages/Settings'

export default function App() {
  const { session } = useAuth()
  if (!session) return <LoginPage />
  return (
    <BrowserRouter>
      <UploadProvider>
        <DialogProvider>
          <Routes>
            <Route element={<Layout />}>
              <Route index element={<OverviewPage />} />
              <Route path="folders" element={<FoldersPage />} />
              <Route path="folders/:id" element={<FolderPage />} />
              <Route path="files" element={<FilesPage />} />
              <Route path="settings" element={<SettingsPage />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Route>
          </Routes>
        </DialogProvider>
      </UploadProvider>
    </BrowserRouter>
  )
}
