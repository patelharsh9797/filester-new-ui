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
- 📊 **Insights.** Downloads over the last 24 hours, 7 and 30 days, a daily chart, a weekday × hour heatmap and Filester's top files (24h/7d/30d/all time), from Filester's own stats. Plus downloads per folder including subfolders, storage growth by upload month, storage by file type, largest folders and files, and “quiet files” that nobody downloads and are drifting toward deletion.
- 💾 **Backups to your own R2 bucket (opt-in).** Off by default. Each user connects their own Cloudflare R2 bucket in Settings (keys encrypted, never shown again); then they can back up at-risk files from the Expiring soon page. Large files go in 64 MB parts with live progress, resume after interruptions, and old copies are deleted after the user's chosen retention.
- 🙈 **Bulk “Hide related”.** Turn Filester's “More from this album” section off (or back on) for many folders at once from the Folders page, with a filter showing which folders still display it. Password-protected folders are skipped so their passwords aren't removed.
- 🧬 **Duplicate protection.** Uploads skip files already in the destination folder (same name and size), with options to skip by name only or upload everything. A Duplicates page finds same-named files within a folder and deletes the extra copies, keeping the oldest, newest or most-downloaded one.
- 📱 **Installable app (PWA).** Install it on Android, iPhone/iPad or desktop to get its own icon and a full-screen window. A one-time popup after sign-in offers to install (Chrome/Edge show their install dialog; iOS gets Add to Home Screen steps), and Settings has the same option. The service worker caches only the app's own code and icons, never your files or API responses, and shows an offline page when there's no connection.
- ✏️ **Editing.** Rename files and folders, move with a searchable folder picker, change public or private, delete.
- 🩺 **Filester change detection.** Every Filester response the app relies on is checked for the fields it reads. If Filester changes a format, you get a clear “Filester changed how … responds” message instead of empty pages or wrong data. **Settings → Filester connection** runs read-only checks of every endpoint and shows what works, what changed and what's down.
- 🤖 **Optional bot check.** Cloudflare Turnstile on the sign-in form for public deploys; it's off unless you set its keys.
- 🛡 **Privacy note.** The sign-in page says in one line what happens to your password and files, and expands to the full list of what passes through the server and what's stored (and where). The same text is in Settings.
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
- **Public by default:** anyone with a Filester account can sign in; set the optional `ALLOWED_USERS` secret to restrict it. Backups only ever go to each user's own bucket.
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
src/routes/_app/…              /, /folders, /folders/$id, /files, /expiring, /insights, /backups, /duplicates, /settings
src/routes/api/fs/$.ts         server route: pass-through to Filester
src/routes/api/backup/$.ts     server route: connect bucket + Filester → user's R2 backups
src/server/backup.server.ts    backup logic (download tokens, ranged copy, multipart)
src/server/r2config.server.ts  users' R2 settings, encrypted in KV; daily cap
src/server/s3.server.ts        minimal R2 (S3 API) client, SigV4
src/server/auth.functions.ts   server functions: login, logout, getSession
src/server/session.server.ts   encrypted session cookie
src/server/filester.server.ts  Filester login + proxy logic
src/server/turnstile.server.ts optional Turnstile check on sign-in
src/lib/shape.ts               checks Filester responses (“Filester changed …” errors)
src/lib/*                      API client, folder index, search, uploader
src/state/*, src/components/*, src/pages/*   UI
docs/                          API reference, site audit, deploy guide
tests/unit/                    Vitest unit tests (search, folder index, expiry, crypto, keys…)
tests/e2e/                     Playwright tests against the real Worker build
tests/mock/filester-mock.mjs   fake Filester (with its quirks) used by the e2e tests
.github/workflows/ci.yml       CI: typecheck, lint, unit, build, e2e on every push
```

## Scripts

`npm run dev` · `npm run build` · `npm run deploy` · `npm run lint` · `npm run typecheck` · `npm run cf-typegen` · `npm test` · `npm run build:test` · `npm run test:e2e`

## Tests

Nothing in the test suite touches a real Filester account or R2 bucket.

- **Unit** (`npm test`, Vitest): search ranking, CSV parsing, the folder index (including Filester's
  deleted-file counts), duplicates, expiry estimates, response-shape checks, R2 credential validation,
  encryption (and that a stored record can't be decrypted for another user), daily usage, S3 key encoding.
- **End-to-end** (`npm run build:test && npm run test:e2e`, Playwright): the real Worker build
  (`vite preview` runs it in workerd) against `tests/mock/filester-mock.mjs`, a fake Filester that copies
  the real quirks (deleted files still counted, orphaned subfolders, password wiped by an empty edit, a
  download token counts as a download…), and [moto](https://github.com/getmoto/moto) as the R2 bucket.
  It covers sign-in (and Turnstile), search, bulk move, delete and hide-related, uploads and duplicates,
  expiring files, backups (multipart, byte-for-byte checked, isolated between users), what users see when
  Filester changes a format, and the PWA files.
  Needs `pip install "moto[server]"` and `npx playwright install chromium` once. The test build reads
  `tests/e2e/wrangler.test.jsonc` and its `.dev.vars`, which hold test-only values.
- **CI**: `.github/workflows/ci.yml` runs all of it on every push and pull request.

