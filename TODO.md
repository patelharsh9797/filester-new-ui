# Roadmap

Sizes: **S** = an hour or two · **M** = half a day · **L** = needs design or new infrastructure (ask first).

## Next up

- [ ] **Bulk rename** (S–M). Many files are named like `c747cecf-…jpg`. Select files and rename them by pattern
  (`{folder} {n}`, `{name}`, `{date}`, zero-padded numbers), with a before/after preview and progress in the task panel.
  Uses `POST /api/file/update`, which needs the file's current `folderId` or the file moves.
- [ ] **Cleanup page** (S). Gather empty folders (0 files, no subfolders), folders whose files were all deleted by
  Filester (`deletedFiles > 0`, `directFiles = 0`) and duplicate copies on one page, with one-click cleanup.

## Backlog

- [ ] **Gallery extras** (S). Zoom and pan in the lightbox; a slideshow; preload the next image (only if it doesn't
  count extra views on Filester); bigger and smaller tile sizes.
- [ ] **Sync pins and saved searches across devices** (S). They're in `localStorage` per browser today. Store them in
  KV per Filester user id, encrypted like the R2 settings, and keep localStorage as a cache. Update the privacy note.
- [ ] **Share links** (S). Copy a folder's link, or the selected files' links grouped by folder (plain text or
  Markdown), in one click.
- [ ] **Activity log** (S–M). What you uploaded, moved, renamed, deleted or backed up, and when, recorded from
  `useActions()` and kept in the browser (capped, with clear and export buttons).
- [ ] **Expiry alerts** (L). Web Push through the installed PWA, or email, when files are about to expire, without opening
  the app. Needs a Cron Trigger that checks accounts while users are away, so it must keep Filester access
  server-side: opt-in, encrypted, and stated in the privacy note.
- [ ] Phone: on touch screens, show unpin and remove buttons on pinned folders and saved searches without needing hover (S).
- [ ] Always show **Save search** (greyed out with a hint) instead of hiding it until there's a query or filter (S, optional).

## Done

- 2026-11-13: Gallery view: thumbnail grid on Files and folder pages, lightbox with full images, video/audio streaming,
  selection and bulk actions (`2fea4b8`)
- 2026-11-13: Fix dropped keystrokes in URL-bound search boxes; Save search name without quotes (`fb818bc`)
- 2026-11-12: Pinned folders and saved searches (`e54777d`)
- 2026-11-12: Stored request logs turned off (`673beed`)
- 2026-11-12: Privacy note on sign-in and in Settings (`cd93957`)
- 2026-11-12: Insights page: download stats, heatmap, storage breakdown, quiet files (`869d99e`)
- 2026-11-12: Tests and CI, Filester change detection and connection check, optional Turnstile (`bf55df3`)
- Earlier: real per-folder counts (`9f34829`) · fair daily backup cap with meter (`85694ec`) · public app with
  bring-your-own-bucket backups (`3bf45e6`) · allowlist (`d53f49d`) · bulk delete/move with progress (`6a92316`) ·
  resumable backups (`719fe1d`) · login tweaks (`0647d34`) · PWA (`a80cb7b`) · duplicate protection (`dbd560e`) ·
  bulk Hide related (`c9854b3`) · R2 backups (`3a47845`) · Expiring soon (`77e0963`) · TanStack Start + Workers
  rebuild (`285607c`) · first version (`8458bc8`)

## Decided against

- **Automatic keep-alive** (copy files to R2 and delete again, or request download tokens just to reset the
  inactivity timer). It would work around Filester's retention policy. Backups stay manual and in the user's own bucket.
