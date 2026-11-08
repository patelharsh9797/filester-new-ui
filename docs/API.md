# Filester API reference (as observed)

Researched on 2026‑11‑05 against filester.me **beta v0.13**. Everything below was
verified with live requests from a test account unless marked *(from JS only)*.

Filester has **two** API surfaces:

| Surface | Base URL | Auth | CORS |
|---|---|---|---|
| Public REST API (documented at `/api-docs`) | `https://u1.filester.me` | `Authorization: Bearer <API key>` | only `https://filester.me` |
| Web-app API (used by `/manager`, `/account`, …) | `https://filester.me/api` | `auth_token` cookie (JWT) | same-origin only |

Because neither allows other origins, a browser app must go through a proxy —
that is what `src/routes/api/fs/$.ts` (a Cloudflare Worker route) does.

The **API key** is shown on `https://filester.me/account` (`#apiKeyValue`) and
can be regenerated there. The **session JWT** comes from `/auth/login`
(30‑day expiry, payload `{exp, iat, user_id}`).

Rate limit for the public API: **1,000 requests / hour / key**. Responses
include `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset`;
over the limit → `429` + `Retry-After`.

Errors: `{"success": false, "message": "...", "error": "CODE"}`.

---

## Auth (web)

| Method | Path | Body | Notes |
|---|---|---|---|
| POST | `/auth/register` | `{username, password}` | `201` on success. Username ≥ 3 chars, password ≥ 8. **No email, no CAPTCHA.** `409` if taken. |
| POST | `/auth/login` | `{username, password, code?}` | Returns `{success, token}` **and** sets `auth_token` cookie. If 2FA is on: `{requires_2fa: true}` → resend with `code` (6‑digit TOTP or 8‑char backup code). |
| GET | `/logout` | | |

---

## Public REST API — `https://u1.filester.me`

### Account
| Method | Path | Response |
|---|---|---|
| GET | `/health` | `{status, timestamp, service}` (no auth) |
| GET | `/api/v1/account` | `{data: {id, username, storage_used, storage_limit, files_count, folders_count, api_requests_today}}` |

### Files
| Method | Path | Notes |
|---|---|---|
| GET | `/api/v1/files?page=&per_page=&folder=&search=` | `per_page` 1–100. `folder=root` → only unfiled files. `search` matches **file names only**. Returns `{data: File[], pagination: {page, per_page, total, pages}}`. `data` is `null` (not `[]`) when empty. |
| GET | `/api/v1/file/{id}` | `id` = slug, UUID or numeric id. |
| POST | `/api/v1/file/move` | `{file, folder}` — `folder: "root"` or omitted → top level. |
| POST | `/api/v1/files/move` | `{files: [...≤200], folder}` — per-file results. |
| POST | `/file/delete` *(no `/api` prefix)* | `{identifiers: [...]}` |

`File` = `{id, uuid, name, size, type, url, folder_id, created_at, downloads}`.
`type` is frequently `application/octet-stream`; derive the kind from the
extension. `created_at` has date precision only (`T00:00:00Z`). The slug is the
last segment of `url` (`https://filester.me/d/<slug>`).

### Folders
| Method | Path | Notes |
|---|---|---|
| GET | `/api/v1/folders` | **All** folders in one call (no pagination). Each has `{id, name, public, file_count, folder_count, created_at, parent, parent_id}` — enough to build the full tree client-side. |
| POST | `/api/v1/folder` | `{name ≤100, parent?, public? (1/0, default 1), password?}` → `{data: {identifier, name, parent, hasPassword}}` |
| GET | `/api/v1/folder/{id}/files` | Files directly in a folder. |
| POST | `/api/v1/folder/thumbnail` | multipart `folder`, `thumbnail` (jpg/png/gif/webp ≤ 5 MB) |
| POST | `/api/v1/folder/move` | `{folder, parent}` — rejects moving into own subtree / duplicate name. |
| POST | `/api/v1/folders/move` | `{folders: [...≤200], parent}` |
| POST | `/folder/delete` *(no `/api` prefix)* | `{identifiers: [...]}` — deletes folders **and all files inside**. |

There is **no folder search** and **no rename** in the public API.

### Upload
Single request (v1):
```
POST /api/v1/upload        multipart "file"; optional header X-Folder-ID
→ {success, slug, url, file_id}
GET  /api/v1/upload/status?slug=
```
Chunked, parallel, resumable (v2 — what the website uses; works with the API key):
```
POST /api/v2/upload/init    {filename, size, folder}  → {id, chunk_size (5 MiB), total_chunks, parallel}
PUT  /api/v2/upload/chunk   headers X-Upload-Id, X-Chunk-Index; raw bytes   → {success, i}
POST /api/v2/upload/finish  header X-Upload-Id  → 200 result | 202 still processing (poll) | 409 missing chunks
POST /api/v2/upload/abort   header X-Upload-Id
```
The website sends chunks to `wu1.filester.me` using a short-lived token from
`GET /api/upload-token` (cookie auth). `u1.filester.me/api/v2/upload/*` accepts the
API key directly. Max file size 10 GB; account storage 10 GB.

---

## Web-app API — `https://filester.me/api` (cookie `auth_token`)

Verified:

| Method | Path | Body / query | Notes |
|---|---|---|---|
| GET | `/api/manager/data` | `files_page, folders_page, all_folders=1, with_hierarchy=1, folder_sort=az, folder=` | Manager page data; nested `allFoldersHierarchical` with Go-style field names (`Identifier`, `Name`, `ParentID`, `Subfolders`, …). |
| GET | `/api/manager/search` | `q, scope=all\|current, folder` | **Files only** — searching a folder name returns 0 results. Min 2 chars. |
| GET | `/api/file/info?id=<slug>` | | `views, downloads, last_viewed, last_downloaded, md5, sha256, folder_identifier, folder_name, blocked, flagged, public_override, …` |
| GET | `/api/folder/info?id=<identifier>` | | `name, access, file_count, subfolder_count, total_size, has_password, hide_related, thumbnail_url` |
| POST | `/api/file/update` | `{fileId: <slug>, name, folderId, publicOverride?}` | **Rename.** `folderId` must be the current folder or the file moves. |
| POST | `/api/folder/edit` | `{identifier, name, public: 0\|1, password, hide_related: 0\|1}` | **Rename / visibility.** ⚠️ An empty `password` **removes** an existing folder password. |
| POST | `/api/folder/create` | `{name, public, password, hide_related, parent_identifier?}` | |
| GET | `/api/files/top?limit=50` | | Most-downloaded files. |
| GET | `/api/files/export.csv` | | CSV of every file: ids, name, size, dates, downloads, views, md5, folder id/name/slug, URLs. |
| GET | `/api/account/stats` | | `{totals: {d24, d7, d30}, sparkline: [{day, downloads}]}` |
| GET | `/api/manager/preferences` | | `{preferences: {}}` |

Seen in the site's JavaScript *(from JS only, not exercised)*:
`/api/manager/preferences/save`, `/api/user/folders`, `/api/files/move`
(`{fileIds, folder}`), `/api/file/delete` (`{fileId}` or `{fileIds}`),
`/api/folder/move` (`{folder, parent}`), `/api/folder/delete` (`{identifier}`),
`/api/folder/thumbnail/upload|delete`, `/api/upload-token`,
`/api/account/change-pw`, `/api/account/regen-key`, `/api/account/indexing`,
`/api/account/{generate,enable,disable,verify}-2fa…`,
`/api/notifications{,/count,/read,/delete/<id>,/delete-all}`.

---

## Public links
- File page: `https://filester.me/d/<slug>` (also `/h/<slug>`)
- Folder page: `https://filester.me/f/<identifier>`
- Thumbnail: `/t/<uuid>`

## Policies worth knowing
- Files are deleted after inactivity. The **FAQ says 35 days without downloads**; the **API docs say 45 days without views or downloads**. `last_viewed` / `last_downloaded` per file are available in `/api/files/export.csv`, and both are set to the upload time on upload.
- Private folders can't have a password.
- The account setting **Default Hide Related Files** only applies to folders created after it is turned on; existing folders keep their own `hide_related`. There is no bulk endpoint — change existing folders with `POST /api/folder/edit` one by one (re-sending the password for protected folders, or it is removed).

---

## Endpoints this app actually uses

Every call from the browser goes to our own Worker first; the Worker calls Filester and attaches your credentials.

### Filester — API key (`Authorization: Bearer`, host `u1.filester.me`)

| # | Method & path | Used for | When |
|---|---|---|---|
| 1 | `GET /api/v1/account` | Storage used/limit, account info | App load (cached 1 min); also to check a pasted API key at sign-in |
| 2 | `GET /api/v1/folders` | All folders (tree, paths, counts) | App load, after changes |
| 3 | `GET /api/v1/files?page=&per_page=100` | File list | **Fallback only** — if the CSV export (#14) fails |
| 4 | `POST /api/v1/folder` | Create folder / subfolder | New folder |
| 5 | `POST /api/v1/folders/move` | Move folders | Move |
| 6 | `POST /api/v1/files/move` | Move files (≤200 per call) | Move |
| 7 | `POST /file/delete` | Delete files | Delete |
| 8 | `POST /folder/delete` | Delete folders (and their files) | Delete |
| 9 | `POST /api/v2/upload/init` · `PUT /api/v2/upload/chunk` · `POST /api/v2/upload/finish` · `POST /api/v2/upload/abort` | Chunked, resumable uploads | Upload |
| 10 | `POST /api/v1/upload` | Single-request upload | Fallback if v2 upload is unavailable |

Only uploads count against the rate limit (they return `X-RateLimit-Remaining`); read calls don't.

### Filester — your session (`auth_token` cookie, host `filester.me`)

| # | Method & path | Used for | When |
|---|---|---|---|
| 11 | `POST /auth/login` | Sign in (returns the session JWT) | Sign-in |
| 12 | `GET /account` (HTML page) | Read your API key from the page | Sign-in |
| 13 | `POST /v2/api/public/download` | Download token for a file. **Counts as a download on Filester.** | Each backup (plus a refresh if a token expires mid-copy) |
| 14 | `GET /api/files/export.csv` | Entire file list + last view/download dates, in one request | App load, after changes, and 3 and 8 min after a backup batch |
| 15 | `GET /api/file/info?id=<slug>` | Views, MD5, last viewed/downloaded | Opening file details |
| 16 | `GET /api/folder/info?id=<id>` | Password/“hide related” status | Opening the edit-folder dialog |
| 17 | `POST /api/file/update` | Rename file | Rename |
| 18 | `POST /api/folder/edit` | Rename folder, public/private, password, hide related | Edit folder; bulk “Hide related” (one call per folder) |
| 18b | `GET /api/manager/data?folders_page=1&all_folders=1&with_hierarchy=1&folder_sort=az` | `HideRelated` + `HasPassword` for every folder, in one request | Folders page (cached 5 min) and before a bulk “Hide related” |

### Filester CDN — no credentials (token in the URL)

| # | Method & path | Used for |
|---|---|---|
| 19 | `GET https://fsc{1,2,3}.cdn.cr/v2/<file>?token=…&download=true` with `Range` | Copying file bytes into R2 during a backup (1-byte request for the size, then 64 MB ranges) |

### Our own Worker (what the browser calls)

| Path | Purpose |
|---|---|
| `/_serverFn/…` | TanStack Start server functions: `login`, `logout`, `getSession` |
| `/api/fs/v1/*`, `/api/fs/u1/*`, `/api/fs/v2/*`, `/api/fs/web/*` | Pass-through to the Filester endpoints above |
| `/api/backup/list` · `download` · `init` · `ticket` · `part` · `complete` · `abort` · `delete` | R2 backups |

### Calls per action (566-file account)

| Action | Before | Now |
|---|---|---|
| Open / reload the app | 2 key calls + 6 paged file calls + 1 export | 2 key calls (#1, #2) + 1 export (#14) |
| Back up one file | 1 key call (`/api/v1/file/<id>`) + 1 token | 1 token (#13), no key calls |
