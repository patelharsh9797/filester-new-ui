# Filester Navigator

A faster, easier-to-search UI for your [filester.me](https://filester.me) account.
Personal-use tool. It talks to Filester's own APIs through a small local proxy.

**What it adds over the stock site**

- 🔎 **Folder search.** Search by name or any part of the path, fuzzy, words in any order (`sci fi`, `movies classics`, `lofi`).
- ⌘K **Command palette.** One search box for folders *and* files. Tab switches between All, Folders and Files; Enter opens.
- 📁 **`/folders` page.** Every folder in one sortable table with full path, recursive file count, size, visibility and last activity. Also has a tree view, filters, and bulk move and delete.
- 📄 **`/files` page.** Every file, searchable by name and folder path. Filter by type, size, age and folder; sort any column; bulk move, delete and copy links.
- 🗂 **Folder pages.** Breadcrumbs, subfolder cards, files with an "include subfolders" toggle, and in-folder search.
- 🌲 **Sidebar folder tree.** Expands to the folder you're viewing.
- ⬆️ **Uploads.** Drag and drop anywhere to upload into the current folder. Files go up in chunks with retries using Filester's v2 protocol (up to 10 GB each).
- ✏️ **Editing.** Rename files and folders, move with a searchable folder picker, change public or private, delete.
- 🔐 **Password safeguard.** Editing a password-protected folder can't drop its password by accident. Filester's own endpoint does this when the password field is blank.

See [`docs/API.md`](docs/API.md) for the full API reference and [`docs/SITE-AUDIT.md`](docs/SITE-AUDIT.md) for the audit of the current site.

## Run it

Requires Node 20+.

```bash
npm install
npm run dev        # UI on http://localhost:5173 (proxy server on :8787)
```

For everyday use:

```bash
npm run build
npm start          # everything on http://127.0.0.1:8787
```

Sign in with your Filester username and password (2FA supported). The server
logs in to filester.me and reads your API key from the Account page. If that
fails, you'll be asked to paste the key.

### Configuration (env vars)

| Var | Default | |
|---|---|---|
| `PORT` | `8787` | Server port |
| `HOST` | `127.0.0.1` | Bind address. Keep it local; anyone who can reach the server can use it as a proxy. |
| `NODE_USE_ENV_PROXY=1` | | Set this if you're behind an HTTP(S) proxy (Node ≥ 22.21). |

## How it works

```
browser (React SPA) ──/proxy/v1, /proxy/v2, /proxy/u1──▶ server/index.mjs ──Bearer API key──▶ u1.filester.me
                    ──/proxy/web─────────────────────▶                  ──auth_token cookie─▶ filester.me/api
                    ──/local/login───────────────────▶                  ──/auth/login───────▶ filester.me
```

- Filester only allows CORS from `https://filester.me`, so the browser can't call its APIs directly. The zero-dependency Node server forwards requests and adds the credentials.
- The server stores nothing. The browser keeps the session JWT (valid 30 days) and the API key in `localStorage` and sends them with each request.
- On load, the app fetches **all folders** (one call) and **all files** (100 per call, 4 in parallel). It then builds the tree, paths, recursive sizes and search index in memory, so search is instant. The data refreshes after every change and when you click ↻. Filester's limit is 1,000 requests an hour, so a 5,000-file library costs about 50 requests per full refresh.

## Project layout

```
server/index.mjs          local proxy + static server
src/lib/api.ts            typed API client (v1 + web endpoints)
src/lib/library.ts        loads everything, builds the folder tree / index
src/lib/search.ts         fuzzy matcher used everywhere
src/lib/upload.ts         chunked v2 uploader with v1 fallback
src/state/*               auth, dialogs, toasts, uploads, actions (mutations)
src/components/*          layout, search palette, tables, pickers, dialogs
src/pages/*               Overview, Folders, Folder, Files, Settings, Login
docs/                     API reference + site audit
```

## Scripts

`npm run dev` · `npm run build` · `npm start` · `npm run lint` · `npm run typecheck`
