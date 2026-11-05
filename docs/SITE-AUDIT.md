# filester.me UI audit (beta v0.13, 2026‑11‑05)

## Pages crawled

| Route | Title | What it is |
|---|---|---|
| `/` | Filester – Integrity-Focused File Hosting | Upload landing page (drag & drop, chunked uploader) |
| `/auth` | Login / Register | One form for both modes; username + password, optional 2FA/backup code |
| `/manager` | File Manager | **The only place to browse your files** |
| `/account` | Account Settings | API key (blurred), change password, 2FA, search-indexing toggle |
| `/stats` | Your Stats | Download totals (24h / 7d / 30d) and a sparkline |
| `/notifications` | Notifications | Filter by `file_blocked`, `account_warning`, `custom`, `system` |
| `/paste` | Encrypted Paste | Pastebin |
| `/api-docs` | API Documentation | Public REST API (see `API.md`) |
| `/changelog`, `/blog`, `/faq`, `/contact`, `/report`, `/proxy` | | Info pages; `/proxy` lists mirror domains |
| `/d/<slug>`, `/f/<id>` | | Public file / folder pages |

There are **no `/files`, `/folders` or `/dashboard` routes** (all return 404).

## File manager (`/manager`) as it is now

- One page that mixes a **folder grid** and a **file grid** for the current folder, with breadcrumbs.
- Buttons: *All Files*, *New Folder*, *Options*, *Export CSV*; a *Newest/Oldest/A–Z* sort per section; *Select* mode for bulk move/delete.
- Search icon opens a file search (`/api/manager/search`), scope *all* or *current folder*. Minimum 2 characters. **Folders are not searched.**
- File cards show a type badge, name (truncated), folder chip and size. Kebab menu: info, edit (rename / change folder / public override), copy link, delete.
- Folder cards show name, lock/globe icon and a kebab menu (edit, move, thumbnail, delete).

## Pain points the new UI addresses

| Problem on filester.me | Filester Navigator |
|---|---|
| No folder search | Folder search by name **or any part of the path**, fuzzy, words in any order; also in the Ctrl+K palette and the "Move to" picker |
| No dedicated folders page | `/folders`: every folder in one sortable table (path, total files, total size, access, activity, created) + tree view, filters (public/private, top-level, empty, has files), bulk move/delete |
| No dedicated files page | `/files`: every file with search over name *and* folder path, type chips, size and age filters, folder-scope filter, sortable columns, bulk actions |
| Hard to know where a file lives | Folder path shown on every file row and search result; clicking a result jumps to its folder and highlights it |
| Sizes per folder unknown | Recursive file counts and sizes for every folder |
| Folder tree only via breadcrumbs | Persistent, expandable sidebar tree that auto-expands to the current folder |
| Editing a folder silently drops its password | The edit dialog detects password-protected folders and requires re-entering (or explicitly removing) the password |
