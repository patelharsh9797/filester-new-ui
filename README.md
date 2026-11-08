# Filester Navigator

A faster, easier-to-search UI for your [filester.me](https://filester.me) account.
Personal-use tool. It runs on Cloudflare Workers and talks to Filester's own APIs on your behalf.

**What it adds over the stock site**

- 🔎 **Folder search.** Search by name or any part of the path, fuzzy, words in any order (`sci fi`, `movies classics`, `lofi`).
- ⌘K **Command palette.** One search box for folders *and* files. Tab switches between All, Folders and Files; Enter opens.
- 📁 **`/folders` page.** Every folder in one sortable table with full path, recursive file count, size, visibility and last activity. Also has a tree view, filters, and bulk move and delete.
- 📄 **`/files` page.** Every file, searchable by name and folder path. Filter by type, size, age and folder; sort any column; bulk move, delete and copy links.
- 🗂 **Folder pages.** Breadcrumbs, subfolder cards, files with an "include subfolders" toggle, and in-folder search.
- 🌲 **Sidebar folder tree.** Expands to the folder you're viewing.
- ⬆️ **Uploads.** Drag and drop anywhere to upload into the current folder. Files go up in chunks with retries using Filester's v2 protocol (up to 10 GB each).
- ⏳ **Expiring soon.** Filester deletes files after a stretch with no downloads. A dedicated page shows how many days each file has left, an Overview banner and a sidebar badge warn you about anything due within 7 days, and red or amber badges appear next to at-risk files in every list. You can count from the FAQ rule (35 days without downloads, the default) or the API-docs rule (45 days without views or downloads).
- 💾 **Manual R2 backups.** From the Expiring soon page, back up one file or a selection to your Cloudflare R2 bucket. Large files are copied in 64 MB parts with live progress. A Backups page lists stored copies with download and delete buttons, a space meter and a size limit, and copies are deleted automatically after 7 days (configurable).
- 🙈 **Bulk “Hide related”.** Turn Filester's “More from this album” section off (or back on) for many folders at once from the Folders page, with a filter showing which folders still display it. Password-protected folders are skipped so their passwords aren't removed.
- 🧬 **Duplicate protection.** Uploads skip files already in the destination folder (same name and size), with options to skip by name only or upload everything. A Duplicates page finds same-named files within a folder and deletes the extra copies, keeping the oldest, newest or most-downloaded one.
- ✏️ **Editing.** Rename files and folders, move with a searchable folder picker, change public or private, delete.
- 🔐 **Password safeguard.** Editing a password-protected folder can't drop its password by accident. Filester's own endpoint does this when the password field is blank.

See [`docs/API.md`](docs/API.md) for the full API reference and [`docs/SITE-AUDIT.md`](docs/SITE-AUDIT.md) for the audit of the current site.

## Stack

- **TanStack Start** (React 19, TanStack Router file routes, server functions and server routes)
- **TanStack Query** for the client-side data cache
- **Tailwind CSS 4**, **lucide-react** icons
- **Cloudflare Workers** for hosting (via `@cloudflare/vite-plugin`). There's no Node server.

The original Node.js + Vite version is kept on the [`node`](../../tree/node) branch.

## Run it locally

```bash
cp .dev.vars.example .dev.vars   # set SESSION_SECRET
npm install
npm run dev                      # http://localhost:3000 (Cloudflare's local runtime)
```

## Deploy

See **[docs/DEPLOY.md](docs/DEPLOY.md)**. In short: connect this repo in Cloudflare → Workers & Pages,
set the `SESSION_SECRET` secret, and the app goes live at **https://fs.snippface.vip**.

## How it works

```
browser ──pages, /_serverFn (login/logout/session)──▶ Cloudflare Worker (TanStack Start)
        ──/api/fs/v1|v2|u1/* ─────────────────────▶   ──Bearer API key──────▶ u1.filester.me
        ──/api/fs/web/* ──────────────────────────▶   ──auth_token cookie───▶ filester.me/api
```

- Filester only allows CORS from `https://filester.me`, so the browser can't call it directly. The Worker forwards requests and attaches your credentials.
- **Sign-in:** a server function logs in to filester.me and reads your API key from the Account page. It stores the session JWT and API key in an **AES-GCM-encrypted, HttpOnly, Secure, SameSite=Lax cookie**. Page scripts never see them, and nothing is stored server-side.
- `/api/fs/*` rejects requests without a valid session and cross-site POSTs.
- The signed-in pages render client-side (`ssr: false`). On load the browser fetches **all folders** (one call) and **all files** (100 per call). It builds the tree, paths, recursive sizes and search index in memory, so search is instant. Filester allows 1,000 requests an hour.

## Project layout

```
wrangler.jsonc                 Worker config (name, custom domain fs.snippface.vip)
src/router.tsx                 router + QueryClient
src/routes/__root.tsx          HTML shell
src/routes/login.tsx           sign-in page
src/routes/_app.tsx            signed-in layout (auth guard, client-rendered)
src/routes/_app/…              /, /folders, /folders/$id, /files, /settings
src/routes/api/fs/$.ts         server route: pass-through to Filester
src/routes/api/backup/$.ts     server route: manual Filester → R2 backups
src/server/backup.server.ts    backup logic (download tokens, ranged copy, R2 multipart)
src/server/auth.functions.ts   server functions: login, logout, getSession
src/server/session.server.ts   encrypted session cookie
src/server/filester.server.ts  Filester login + proxy logic
src/lib/*                      API client, folder index, search, uploader
src/state/*, src/components/*, src/pages/*   UI
docs/                          API reference, site audit, deploy guide
```

## Scripts

`npm run dev` · `npm run build` · `npm run deploy` · `npm run lint` · `npm run typecheck` · `npm run cf-typegen`
