/** Folder as returned by GET /api/v1/folders */
export interface Folder {
  id: string
  name: string
  public: boolean
  file_count: number
  folder_count: number
  created_at: string
  parent: string | null
  parent_id: string | null
}

/** File as returned by GET /api/v1/files */
export interface FileItem {
  id: number
  uuid: string
  name: string
  size: number
  type: string
  url: string
  folder_id: string | null
  created_at: string
  downloads: number
  /** Thumbnail image (from the CSV export; absent with the API fallback) */
  thumbnail?: string | null
}

export interface Account {
  id: number
  username: string
  storage_used: number
  storage_limit: number
  files_count: number
  folders_count: number
  api_requests_today: number
}

export interface Pagination {
  page: number
  per_page: number
  total: number
  pages: number
}

/** GET /api/file/info (web endpoint) */
export interface FileInfo {
  slug: string
  uuid: string
  original_name: string
  type: string
  size: number
  upload_date: string
  downloads: number
  views: number
  last_viewed: string
  last_downloaded: string
  md5: string | null
  sha256: string | null
  folder_identifier: string | null
  folder_name: string | null
  has_thumbnail: boolean
  thumbnail_url: string
  blocked: boolean
  flagged: boolean
}

/** GET /api/folder/info (web endpoint) */
export interface FolderInfo {
  identifier: string
  name: string
  access: number
  creation_date: string
  file_count: number
  subfolder_count: number
  total_size: number
  has_password: boolean
  hide_related: boolean
  thumbnail_url: string | null
}

/** Folder enriched with tree data, computed client-side */
export interface FolderNode extends Folder {
  /** Folder names from the top level down to (and including) this folder */
  path: string[]
  /** Folder ids from the top level down to (and including) this folder */
  pathIds: string[]
  pathText: string
  depth: number
  children: string[]
  /** Size of files directly inside this folder */
  directSize: number
  /** Files directly inside, counted from the real file list */
  directFiles: number
  /**
   * Files Filester still counts for this folder that no longer exist. Filester's
   * per-folder counter keeps deleted files (yours or its inactivity cleanup).
   */
  deletedFiles: number
  /** Files / size including every nested subfolder */
  totalFiles: number
  totalSize: number
  totalFolders: number
  lastActivity: string
}

export interface FileRow extends FileItem {
  slug: string
  ext: string
  kind: FileKind
  folderPath: string
}

export type FileKind = 'video' | 'image' | 'audio' | 'document' | 'archive' | 'code' | 'other'
