// A small stand-in for filester.me used by the end-to-end tests.
//
// It implements every Filester endpoint the app calls, under three prefixes that
// match the app's test settings:
//   /web/*  → https://filester.me/*        (session cookie)
//   /u1/*   → https://u1.filester.me/*     (Bearer API key)
//   /cdn/<host>/*  → Filester's download CDN (token in the URL, Range support)
// and reproduces the real quirks the app relies on or works around:
//   - a folder's file_count also counts deleted files
//   - deleting a folder does NOT delete its subfolders (they become orphans)
//   - manager/data returns no folders at all while an orphan exists
//   - folder/edit with an empty password removes the folder's password
//   - asking for a download token counts as a download
//   - files in private folders need the session cookie to get a download token
// POST /__break {what} simulates Filester changing a response format.
//
// Test-only control endpoints: POST /__reset, GET /__state?user=, POST /__age.
import http from 'node:http'
import crypto from 'node:crypto'
import { contentFor } from './content.mjs'

const PORT = Number(process.env.MOCK_PORT || 8899)
const CDN_HOST = 'fsc9.cdn.cr'
const DAY = 86_400_000

const hex = (n) => crypto.randomBytes(n).toString('hex')
const slugGen = () => crypto.randomBytes(5).toString('base64url').replace(/[^A-Za-z0-9]/g, 'x').slice(0, 7)
const iso = (t) => new Date(t).toISOString().replace(/\.\d{3}Z$/, 'Z')

let db
/** Simulated upstream format changes: 'folders' | 'export' | 'html' */
let breaks = new Set()
let seqFile = 1000
let seqFolder = 100

function makeUser(id, username, password) {
  return { id, username, password, apiKey: `KEY${username.toUpperCase()}${hex(8)}`, tokens: new Set(), folders: [], files: [] }
}

function addFolder(u, name, parent = null, opts = {}) {
  const f = {
    id: hex(8), numId: ++seqFolder, name, parent, public: opts.public ?? true, password: opts.password ?? '',
    hideRelated: false, created: Date.now() - 3 * DAY,
  }
  u.folders.push(f)
  return f
}

function addFile(u, name, folder = null, size = 1000 + name.length * 37, opts = {}) {
  const created = opts.created ?? Date.now() - 3 * DAY
  const f = {
    id: ++seqFile, uuid: crypto.randomUUID(), slug: slugGen(), name, size, folder: folder?.id ?? null,
    type: 'application/octet-stream', data: contentFor(name, size), created, downloads: 0, views: 0,
    lastViewed: created, lastDownloaded: created, deleted: false,
  }
  u.files.push(f)
  return f
}

function seed() {
  breaks = new Set()
  seqFile = 1000; seqFolder = 100
  // Fresh account ids on every reset: the app keys stored settings (KV) by Filester
  // user id, so this gives each test a clean slate without wiping the Worker's KV.
  const base = 1 + crypto.randomInt(1e9)
  const alice = makeUser(base, 'alice', 'alice-pass-123')
  const movies = addFolder(alice, 'Movies')
  const scifi = addFolder(alice, 'Sci-Fi Classics 70s', movies.id)
  const horror = addFolder(alice, 'Horror', movies.id)
  const slasher = addFolder(alice, 'Slasher', horror.id)
  const music = addFolder(alice, 'Music')
  const jazz = addFolder(alice, 'Jazz', music.id)
  const lofi = addFolder(alice, 'Lo-fi Beats', music.id)
  const photos = addFolder(alice, 'Photos')
  const japan = addFolder(alice, 'Trip to Japan 2025', photos.id)
  const docs = addFolder(alice, 'Documents', null, { public: false })
  const taxes = addFolder(alice, 'Taxes 2025', docs.id, { public: false })
  addFolder(alice, 'Locked Vault', null, { password: 'vault-pass-123' })
  const old = addFolder(alice, 'Old Uploads')
  addFile(alice, 'Blade.Runner.1982.trailer.mp4', scifi)
  addFile(alice, '2001-a-space-odyssey-poster.jpg', scifi)
  addFile(alice, 'halloween-1978-notes.txt', slasher)
  addFile(alice, 'kind-of-blue.flac', jazz)
  addFile(alice, 'take-five.mp3', jazz)
  addFile(alice, 'study-mix-vol3.mp3', lofi)
  addFile(alice, 'kyoto-temple.jpg', japan, 16952)
  addFile(alice, 'tokyo-night.jpg', japan, 15955)
  addFile(alice, 'W2-form.pdf', taxes)
  addFile(alice, 'notes-unsorted.md')
  addFile(alice, 'photo (1).jpg')
  addFile(alice, 'big-12mb.bin', null, 12 * 1024 * 1024)
  // Two files Filester already removed: the folder still "counts" them.
  for (const n of ['old-1.jpg', 'old-2.jpg']) addFile(alice, n, old).deleted = true

  const bob = makeUser(base + 1, 'bob', 'bob-pass-123')
  addFile(bob, 'bob-notes.txt')
  db = { users: [alice, bob], tickets: new Map(), uploads: new Map(), logins: 0, usedTurnstile: new Set() }
}
seed()

// ---------------------------------------------------------------- helpers

const json = (res, status, body, headers = {}) => {
  res.writeHead(status, { 'content-type': 'application/json', ...headers })
  res.end(JSON.stringify(body))
}
async function readBody(req) {
  const chunks = []
  for await (const c of req) chunks.push(c)
  return Buffer.concat(chunks)
}
const readJson = async (req) => { try { return JSON.parse((await readBody(req)).toString() || '{}') } catch { return {} } }
const userByKey = (req) => {
  const m = /^Bearer (.+)$/.exec(req.headers.authorization || '')
  return m ? db.users.find((u) => u.apiKey === m[1]) : undefined
}
const userByCookie = (req) => {
  const m = /auth_token=([^;]+)/.exec(req.headers.cookie || '')
  return m ? db.users.find((u) => u.tokens.has(m[1])) : undefined
}
const live = (u) => u.files.filter((f) => !f.deleted)
const folderById = (u, id) => u.folders.find((f) => f.id === id)
const fileByAny = (u, id) => live(u).find((f) => f.slug === id || f.uuid === id || String(f.id) === String(id))
const url = (f) => `https://filester.me/d/${f.slug}`
const isOrphan = (u, f) => f.parent && !folderById(u, f.parent)
const v1File = (u, f) => ({ id: f.id, uuid: f.uuid, name: f.name, size: f.size, type: f.type, url: url(f), folder_id: f.folder, created_at: iso(f.created).slice(0, 10) + 'T00:00:00Z', downloads: f.downloads })
const v1Folder = (u, f) => ({
  id: f.id, name: f.name, public: f.public, created_at: iso(f.created),
  file_count: u.files.filter((x) => x.folder === f.id).length, // includes deleted files, like Filester
  folder_count: u.folders.filter((x) => x.parent === f.id).length,
  parent: isOrphan(u, f) ? null : f.parent, parent_id: isOrphan(u, f) ? null : f.parent,
})
const csvCell = (v) => (/[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v))
function subtreeIds(u, id) {
  const out = [id]
  for (const c of u.folders.filter((f) => f.parent === id)) out.push(...subtreeIds(u, c.id))
  return out
}

// ---------------------------------------------------------------- routes

async function web(req, res, path, q) {
  if (path === '/auth/login' && req.method === 'POST') {
    db.logins++
    const b = await readJson(req)
    const u = db.users.find((x) => x.username === b.username)
    if (!u || u.password !== b.password) return json(res, 401, { success: false, message: 'Invalid username or password' })
    const token = `tok.${hex(12)}`
    u.tokens.add(token)
    return json(res, 200, { success: true, message: 'Login successful', token }, { 'set-cookie': `auth_token=${token}; Path=/; HttpOnly` })
  }
  const u = userByCookie(req)
  if (path === '/account') {
    if (!u) { res.writeHead(302, { location: '/auth' }); return res.end() }
    res.writeHead(200, { 'content-type': 'text/html' })
    return res.end(`<html><body><div class="api-key-input" style="filter:blur(5px)" id="apiKeyValue">${u.apiKey}</div></body></html>`)
  }
  if (path === '/v2/api/public/download' && req.method === 'POST') {
    const b = await readJson(req)
    const owner = db.users.find((x) => live(x).some((f) => f.slug === b.file_slug))
    const f = owner && fileByAny(owner, b.file_slug)
    if (!f) return json(res, 404, { success: false, message: 'File not found' })
    const folder = f.folder && folderById(owner, f.folder)
    if (folder && !folder.public && u !== owner) return json(res, 403, { success: false, error: 'E2007', message: 'Access denied' })
    f.downloads++; f.lastDownloaded = Date.now() // a token request counts as a download
    const token = `t${hex(16)}`
    db.tickets.set(token, { owner, slug: f.slug })
    const ext = f.name.includes('.') ? f.name.split('.').pop() : 'bin'
    return json(res, 200, { expires_in: 1800, file: `${f.uuid}.${ext}`, name: f.name, server: `https://${CDN_HOST}`, success: true, token })
  }
  if (!u) return json(res, 401, { success: false, error: 'E1001', message: 'Authentication required' })

  if (path === '/api/files/export.csv') {
    let cols = ['file_id', 'uuid', 'slug', 'original_name', 'type', 'size_bytes', 'size_mb', 'upload_date', 'downloads', 'views', 'last_viewed', 'last_downloaded', 'sha256', 'md5', 'has_thumbnail', 'thumbnail_url', 'preview_url', 'blocked', 'flagged', 'public_override', 'album_id', 'album_name', 'album_slug', 'download_url']
    const rows = live(u).map((f) => {
      const fo = f.folder && folderById(u, f.folder)
      return [f.id, f.uuid, f.slug, f.name, f.type, f.size, (f.size / 1048576).toFixed(2), iso(f.created).slice(0, 10) + 'T00:00:00Z', f.downloads, f.views, iso(f.lastViewed), iso(f.lastDownloaded), '', '', 'false', '', '', 'false', 'false', 'false', fo?.numId ?? '', fo?.name ?? '', fo?.id ?? '', url(f)].map(csvCell).join(',')
    })
    if (breaks.has('export')) cols = cols.map((c) => (c === 'last_downloaded' ? 'lastDownload' : c))
    res.writeHead(200, { 'content-type': 'text/csv' })
    return res.end([cols.join(','), ...rows].join('\n') + '\n')
  }
  if (path === '/api/file/info') {
    const f = fileByAny(u, q.get('id'))
    if (!f) return json(res, 404, { success: false, message: 'File not found' })
    const fo = f.folder && folderById(u, f.folder)
    return json(res, 200, { success: true, slug: f.slug, uuid: f.uuid, original_name: f.name, type: f.type, size: f.size, upload_date: iso(f.created), downloads: f.downloads, views: f.views, last_viewed: iso(f.lastViewed), last_downloaded: iso(f.lastDownloaded), md5: 'd41d8cd98f00b204e9800998ecf8427e', sha256: null, folder_identifier: fo?.id ?? null, folder_name: fo?.name ?? null, has_thumbnail: false, thumbnail_url: '', blocked: false, flagged: false })
  }
  if (path === '/api/folder/info') {
    const f = folderById(u, q.get('id'))
    if (!f) return json(res, 404, { success: false, message: 'Folder not found' })
    return json(res, 200, { success: true, identifier: f.id, name: f.name, access: f.public ? 1 : 0, creation_date: iso(f.created), file_count: u.files.filter((x) => x.folder === f.id).length, subfolder_count: u.folders.filter((x) => x.parent === f.id).length, total_size: 0, has_password: !!f.password, hide_related: f.hideRelated, thumbnail_url: null })
  }
  if (path === '/api/file/update' && req.method === 'POST') {
    const b = await readJson(req)
    const f = fileByAny(u, b.fileId)
    if (!f) return json(res, 404, { success: false, message: 'File not found' })
    f.name = b.name; f.folder = b.folderId || null
    return json(res, 200, { success: true, message: 'File updated successfully' })
  }
  if (path === '/api/folder/edit' && req.method === 'POST') {
    const b = await readJson(req)
    const f = folderById(u, b.identifier)
    if (!f || typeof b.name !== 'string') return json(res, 400, { success: false, error: 'E4002', message: 'Invalid request payload' })
    f.name = b.name; f.public = b.public === 1 || b.public === true; f.password = b.password || '' // empty removes it
    f.hideRelated = b.hide_related === 1 || b.hide_related === true
    return json(res, 200, { success: true, message: 'Folder updated successfully' })
  }
  if (path === '/api/manager/data') {
    // Real Filester builds the tree from parent links and returns nothing at all when a folder's parent is missing.
    if (u.folders.some((f) => isOrphan(u, f))) return json(res, 200, { success: true, allFoldersHierarchical: null, folders: [], folderCount: 0 })
    const node = (f) => ({ Identifier: f.id, Name: f.name, ID: f.numId, ParentID: f.parent ? folderById(u, f.parent).numId : null, Public: f.public ? 1 : 0, HasPassword: !!f.password, HideRelated: f.hideRelated, Subfolders: u.folders.filter((c) => c.parent === f.id).map(node) })
    const roots = u.folders.filter((f) => !f.parent).map(node)
    return json(res, 200, { success: true, allFoldersHierarchical: roots, folders: roots, folderCount: roots.length })
  }
  return json(res, 404, { success: false, message: `mock: no web route ${path}` })
}

async function u1(req, res, path, q) {
  const u = userByKey(req)
  if (!u) return json(res, 401, { success: false, message: 'Authentication required', error: 'UNAUTHORIZED' })

  if (path === '/api/v1/account' && breaks.has('html')) { res.writeHead(200, { 'content-type': 'text/html' }); return res.end('<!doctype html><title>Maintenance</title>') }
  if (path === '/api/v1/account') return json(res, 200, { success: true, data: { id: u.id, username: u.username, storage_used: live(u).reduce((n, f) => n + f.size, 0), storage_limit: 10 * 1024 ** 3, files_count: live(u).length, folders_count: u.folders.length, api_requests_today: 0 } })
  if (path === '/api/v1/folders') {
    const data = u.folders.map((f) => v1Folder(u, f))
    if (breaks.has('folders')) for (const f of data) { f.title = f.name; delete f.name }
    return json(res, 200, { success: true, data })
  }
  if (path === '/api/v1/files') {
    let list = live(u)
    if (q.get('folder')) list = list.filter((f) => (q.get('folder') === 'root' ? !f.folder : f.folder === q.get('folder')))
    if (q.get('search')) list = list.filter((f) => f.name.toLowerCase().includes(q.get('search').toLowerCase()))
    const per = Math.min(100, Number(q.get('per_page')) || 20), page = Number(q.get('page')) || 1
    return json(res, 200, { success: true, data: list.slice((page - 1) * per, page * per).map((f) => v1File(u, f)), pagination: { page, per_page: per, total: list.length, pages: Math.max(1, Math.ceil(list.length / per)) } })
  }
  if (path.startsWith('/api/v1/folder/') && path.endsWith('/files')) {
    const id = path.split('/')[4]
    return json(res, 200, { success: true, data: live(u).filter((f) => f.folder === id).map((f) => v1File(u, f)) })
  }
  if (path === '/api/v1/folder' && req.method === 'POST') {
    const b = await readJson(req)
    const parent = b.parent && b.parent !== 'root' ? b.parent : null
    if (parent && !folderById(u, parent)) return json(res, 404, { success: false, message: 'Parent folder not found' })
    const f = addFolder(u, String(b.name).slice(0, 100), parent, { public: b.public !== 0, password: b.password || '' })
    f.created = Date.now()
    return json(res, 200, { success: true, message: 'Folder created successfully', data: { identifier: f.id, name: f.name, parent: parent ?? 'root', hasPassword: !!f.password } })
  }
  if (path === '/api/v1/folders/move' && req.method === 'POST') {
    const b = await readJson(req)
    const parent = b.parent && b.parent !== 'root' ? b.parent : null
    const results = (b.folders || []).map((id) => {
      const f = folderById(u, id)
      if (!f) return { folder: id, success: false, error: 'FOLDER_NOT_FOUND' }
      if (parent && subtreeIds(u, id).includes(parent)) return { folder: id, success: false, error: 'INVALID_DESTINATION' }
      f.parent = parent
      return { folder: id, success: true, folders_updated: subtreeIds(u, id).length }
    })
    const moved = results.filter((r) => r.success).length
    return json(res, 200, { success: moved === results.length, message: `Moved ${moved} of ${results.length} folders`, data: { parent: parent ?? 'root', moved, failed: results.length - moved, results } })
  }
  if (path === '/api/v1/files/move' && req.method === 'POST') {
    const b = await readJson(req)
    const folder = b.folder && b.folder !== 'root' ? b.folder : null
    const results = (b.files || []).map((id) => {
      const f = fileByAny(u, id)
      if (!f) return { file: id, success: false, error: 'FILE_NOT_FOUND' }
      f.folder = folder
      return { file: id, success: true }
    })
    const moved = results.filter((r) => r.success).length
    return json(res, 200, { success: true, message: `Moved ${moved} of ${results.length} files`, data: { folder: folder ?? 'root', moved, failed: results.length - moved, results } })
  }
  if (path === '/file/delete' && req.method === 'POST') {
    const b = await readJson(req)
    const results = (b.identifiers || []).map((id) => {
      const f = fileByAny(u, id)
      if (!f) return { file_id: id, success: false, error: 'not found' }
      f.deleted = true
      return { file_id: id, success: true, file_name: f.name }
    })
    const ok = results.filter((r) => r.success).length
    return json(res, 200, { success: true, message: `Successfully deleted ${ok} files`, results, total_processed: results.length, successful_deletes: ok, failed_deletes: results.length - ok, files_deleted: ok })
  }
  if (path === '/folder/delete' && req.method === 'POST') {
    const b = await readJson(req)
    let filesDeleted = 0
    const results = (b.identifiers || []).map((id) => {
      const f = folderById(u, id)
      if (!f) return { identifier: id, success: false, error: 'not found' }
      // Only the folder and its direct files: subfolders survive as orphans.
      for (const x of live(u).filter((x) => x.folder === id)) { x.deleted = true; filesDeleted++ }
      u.folders = u.folders.filter((x) => x.id !== id)
      return { identifier: id, success: true, files_deleted: filesDeleted, folder_name: f.name }
    })
    const ok = results.filter((r) => r.success).length
    return json(res, 200, { success: true, message: `Successfully deleted ${ok} folders and ${filesDeleted} files`, results, total_processed: results.length, successful_deletes: ok, failed_deletes: results.length - ok, files_deleted: filesDeleted })
  }
  if (path === '/api/v1/upload' && req.method === 'POST') {
    const body = await readBody(req)
    const form = await new Request('http://x/', { method: 'POST', headers: { 'content-type': req.headers['content-type'] }, body }).formData()
    const file = form.get('file')
    if (!file) return json(res, 400, { success: false, message: 'No file' })
    const folder = req.headers['x-folder-id'] ? folderById(u, req.headers['x-folder-id']) : null
    const f = addFile(u, file.name, folder, file.size, { created: Date.now() })
    f.data = Buffer.from(await file.arrayBuffer())
    return json(res, 200, { success: true, message: 'File uploaded successfully', slug: f.slug, url: url(f), file_id: f.id }, { 'x-ratelimit-limit': '1000', 'x-ratelimit-remaining': '999' })
  }
  // chunked uploads
  if (path === '/api/v2/upload/init' && req.method === 'POST') {
    const b = await readJson(req)
    const id = hex(16), chunk = 5 * 1024 * 1024
    db.uploads.set(id, { u, name: b.filename, size: b.size, folder: b.folder || null, chunks: new Map(), chunk })
    return json(res, 200, { success: true, id, chunk_size: chunk, total_chunks: Math.max(1, Math.ceil(b.size / chunk)), parallel: 2 })
  }
  if (path === '/api/v2/upload/chunk' && req.method === 'PUT') {
    const up = db.uploads.get(req.headers['x-upload-id'])
    if (!up) return json(res, 404, { success: false, message: 'Unknown upload' })
    const i = Number(req.headers['x-chunk-index'])
    up.chunks.set(i, await readBody(req))
    return json(res, 200, { success: true, i })
  }
  if (path === '/api/v2/upload/finish' && req.method === 'POST') {
    const up = db.uploads.get(req.headers['x-upload-id'])
    if (!up) return json(res, 404, { success: false, message: 'Unknown upload' })
    const data = Buffer.concat([...up.chunks.keys()].sort((a, b) => a - b).map((k) => up.chunks.get(k)))
    const f = addFile(up.u, up.name, up.folder ? folderById(up.u, up.folder) : null, data.length, { created: Date.now() })
    f.data = data
    db.uploads.delete(req.headers['x-upload-id'])
    return json(res, 200, { success: true, message: 'File uploaded successfully', slug: f.slug, url: url(f), file_id: f.id })
  }
  if (path === '/api/v2/upload/abort' && req.method === 'POST') {
    db.uploads.delete(req.headers['x-upload-id'])
    return json(res, 200, { success: true })
  }
  return json(res, 404, { success: false, message: `mock: no u1 route ${path}` })
}

function cdn(req, res, path, q) {
  const t = db.tickets.get(q.get('token'))
  if (!t) { res.writeHead(403); return res.end('invalid token') }
  const f = fileByAny(t.owner, t.slug)
  if (!f) { res.writeHead(404); return res.end() }
  const m = /bytes=(\d+)-(\d+)?/.exec(req.headers.range || '')
  if (!m) {
    res.writeHead(200, { 'content-length': f.size, 'accept-ranges': 'bytes', 'content-disposition': `attachment; filename*=UTF-8''${encodeURIComponent(f.name)}` })
    return res.end(f.data)
  }
  const start = Number(m[1]), end = Math.min(m[2] ? Number(m[2]) : f.size - 1, f.size - 1)
  if (start >= f.size) { res.writeHead(416); return res.end() }
  res.writeHead(206, { 'content-length': end - start + 1, 'content-range': `bytes ${start}-${end}/${f.size}`, 'accept-ranges': 'bytes' })
  res.end(f.data.subarray(start, end + 1))
}

// Stand-in for Cloudflare's Turnstile siteverify. The tests' fake widget hands out
// "fake-pass-…" tokens; each is accepted once, unless /__break {what:'turnstile'}.
async function siteverify(req, res) {
  const body = await readBody(req)
  const form = await new Request('http://x/', { method: 'POST', headers: { 'content-type': req.headers['content-type'] }, body }).formData()
  const token = String(form.get('response') || '')
  if (form.get('secret') !== 'e2e-turnstile-secret') return json(res, 200, { success: false, 'error-codes': ['invalid-input-secret'] })
  if (breaks.has('turnstile') || !token.startsWith('fake-pass-')) return json(res, 200, { success: false, 'error-codes': ['invalid-input-response'] })
  if (db.usedTurnstile.has(token)) return json(res, 200, { success: false, 'error-codes': ['timeout-or-duplicate'] })
  db.usedTurnstile.add(token)
  return json(res, 200, { success: true })
}

async function control(req, res, path, q) {
  if (path === '/__reset') { seed(); return json(res, 200, { ok: true }) }
  if (path === '/__break' && req.method === 'POST') { breaks.add((await readJson(req)).what); return json(res, 200, { ok: true }) }
  const u = db.users.find((x) => x.username === (q.get('user') || 'alice'))
  if (path === '/__state') {
    return json(res, 200, {
      logins: db.logins,
      apiKey: u.apiKey,
      folders: u.folders.map((f) => ({ id: f.id, name: f.name, parent: f.parent, orphan: !!isOrphan(u, f), public: f.public, hasPassword: !!f.password, hideRelated: f.hideRelated })),
      files: u.files.map((f) => ({ slug: f.slug, name: f.name, folder: f.folder, deleted: f.deleted, size: f.size, downloads: f.downloads })),
    })
  }
  if (path === '/__age' && req.method === 'POST') {
    // Pretend files were last downloaded `days` ago (to test expiry warnings).
    const b = await readJson(req)
    for (const f of u.files) if (!b.names || b.names.includes(f.name)) { f.lastDownloaded = f.lastViewed = f.created = Date.now() - b.days * DAY }
    return json(res, 200, { ok: true })
  }
  return json(res, 404, { message: 'unknown control route' })
}

http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://mock')
  const p = u.pathname
  try {
    if (p.startsWith('/__')) return await control(req, res, p, u.searchParams)
    if (p === '/turnstile/siteverify') return await siteverify(req, res)
    if (p.startsWith('/web/')) return await web(req, res, p.slice(4), u.searchParams)
    if (p.startsWith('/u1/')) return await u1(req, res, p.slice(3), u.searchParams)
    if (p.startsWith(`/cdn/${CDN_HOST}/`)) return cdn(req, res, p.slice(`/cdn/${CDN_HOST}`.length), u.searchParams)
    json(res, 404, { message: 'mock: unknown prefix' })
  } catch (e) {
    console.error(e)
    json(res, 500, { success: false, message: String(e) })
  }
}).listen(PORT, '127.0.0.1', () => console.log(`filester mock on http://127.0.0.1:${PORT}`))
