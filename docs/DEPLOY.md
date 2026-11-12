# Deploying to Cloudflare Workers (with fs.snippface.vip)

The app is a TanStack Start app that runs entirely on one Cloudflare Worker:
the pages, the sign-in logic, and the `/api/fs/*` pass-through to Filester.

## 0. Prerequisites

- A Cloudflare account. The free plan is enough: requests up to 100 MB, and upload chunks are 5 MB.
- **`snippface.vip` added to that same Cloudflare account as a zone** (Dashboard → *Add a domain*, with the domain's nameservers pointed at Cloudflare). You can only attach `fs.snippface.vip` if Cloudflare manages `snippface.vip`.
  - If `snippface.vip` is already on Cloudflare: nothing to do.
  - If it isn't: either move its nameservers to Cloudflare, or remove the `routes` block from `wrangler.jsonc` and use the free `*.workers.dev` URL for now.
- No existing DNS record for `fs.snippface.vip`. Delete it first if there is one, or Cloudflare will refuse to create the custom domain.

## 1. Pick how you want to deploy

### Option A — Automatic deploys from GitHub (recommended)

Every push to `main` builds and deploys. You don't need any tokens on your machine.

1. Cloudflare Dashboard → **Workers & Pages** → **Create** → **Import a repository**.
2. Connect GitHub and pick **`patelharsh9797/filester-new-ui`**.
3. Settings:
   - **Project name:** `filester-navigator` (must match `name` in `wrangler.jsonc`)
   - **Production branch:** `main`
   - **Build command:** `npm run build`
   - **Deploy command:** `npx wrangler deploy`
4. Click **Create and deploy**. The first build takes 1–2 minutes.
5. Then add the secret (step 2 below).

### Option B — Deploy from your computer

```bash
git clone https://github.com/patelharsh9797/filester-new-ui && cd filester-new-ui
npm install
npx wrangler login          # opens the browser once
npm run deploy              # builds and deploys
```

## 2. Set the session secret (required, once)

The login cookie is encrypted with `SESSION_SECRET`. Generate a long random value:

```bash
openssl rand -base64 48
```

Then either:

- **CLI:** `npx wrangler secret put SESSION_SECRET` and paste the value, or
- **Dashboard:** Workers & Pages → **filester-navigator** → **Settings** → **Variables and Secrets** → **Add** → type **Secret**, name `SESSION_SECRET`, paste the value → **Deploy**.

Changing this secret later signs everyone out (old cookies can't be decrypted), which is a handy "log out everywhere" switch.

## 2b. Set the credentials secret (required, once)

Backups are **bring-your-own-bucket**: each user connects their own R2 bucket in the app,
and their R2 keys are stored encrypted in a KV namespace (created automatically on the first
deploy — no ID needed). The encryption key comes from this secret, separate from the cookie secret:

```bash
openssl rand -base64 48            # generate a value
npx wrangler secret put CREDENTIALS_SECRET
```

Keep it stable: if you change it, everyone's stored bucket keys become unreadable and
users have to connect their bucket again (nothing else is lost).

## 2c. Optional: restrict who can sign in

The app is public by default — anyone with a Filester account can use it, and their backups
go to *their own* bucket. To limit sign-in to specific Filester usernames:

```bash
npx wrangler secret put ALLOWED_USERS     # e.g. alice,bob
```

Delete the secret to make the app public again. Removing a name signs that person out on their next request.

## 2d. Optional: bot check on sign-in (Cloudflare Turnstile)

Useful once the app is public. Off unless both values are set.

1. Cloudflare dashboard → **Turnstile** → **Add widget**. Hostname `fs.snippface.vip` (add `localhost`
   too if you want it in local dev), widget mode **Managed**.
2. Copy the **site key** and **secret key**, then:

```bash
npx wrangler secret put TURNSTILE_SECRET           # the secret key
```

and add the site key as a plain-text variable: **filester-navigator → Settings → Variables and Secrets →
Add → Text**, name `TURNSTILE_SITE_KEY`. (Or put `"TURNSTILE_SITE_KEY": "0x…"` under `vars` in
`wrangler.jsonc`; it's public.)

The sign-in button stays disabled until the check passes. The token is checked on the server before
the password is sent to Filester. To turn it off again, delete either value.

## 3. Backups (each user's own R2 bucket)

Nothing to set up on the Worker. Each user turns backups on in **Settings → Backups**:

1. Create an R2 bucket in **their** Cloudflare account.
2. Create an R2 API token with **Object Read & Write**, limited to **only that bucket**.
3. Paste the account ID, access key ID, secret access key and bucket name, then **Test & connect**.

Their keys are encrypted (AES-GCM, bound to their Filester account), never sent back to the browser,
and can be removed with **Disconnect**. The Worker only ever talks to `https://<account-id>.r2.cloudflarestorage.com`.
Each user sets their own retention (default 7 days) and size limit (default 10 GB).

One setting is yours, as the operator, because every backup is copied **through your Worker**:

| Var | Default | Meaning |
|---|---|---|
| `BACKUP_DAILY_CAP_GB` | `50` | Max GB each user may copy per day (0 = no cap). Protects your Worker's request quota. Counted per Filester account as data is actually copied (failed or cancelled backups only count what went through); resets at 00:00 UTC. Users see a usage meter on the Backups page and in Settings. |

**Unfinished uploads.** Big files are copied with multipart uploads. If a backup stops part-way (tab closed,
phone call), its pieces stay in the user's bucket until resumed or discarded; the app lists them on the
Backups page and aborts anything older than 24 hours. Users can also add an R2 lifecycle rule
(bucket → Settings → Object lifecycle rules) that aborts incomplete multipart uploads after 1 day.

**Moving from the earlier version:** the Worker no longer has its own `BACKUPS` bucket binding. Connect your
`filester-backups` bucket in Settings like any user; old objects under `backups/…` can be deleted in the R2 dashboard.

## 4. Custom domain

`wrangler.jsonc` already contains:

```jsonc
"routes": [{ "pattern": "fs.snippface.vip", "custom_domain": true }]
```

So the deploy attaches the domain, creates the DNS record and issues the HTTPS certificate. To check:
Workers & Pages → **filester-navigator** → **Settings** → **Domains & Routes**. You should see
`fs.snippface.vip` (custom domain) and the `*.workers.dev` URL. The certificate can take a few minutes the first time.

Then open **https://fs.snippface.vip** and sign in with your Filester username and password.

## 5. If sign-in fails with "Filester blocked the request"

filester.me sits behind DDoS-Guard, which may block traffic coming from Cloudflare's servers. That can only be checked after the first deploy. If it happens:

- Check the Worker logs: **filester-navigator** → **Logs** (observability is enabled in `wrangler.jsonc`).
- Try a Filester mirror domain (listed at https://filester.me/proxy) by setting the plain-text vars
  `FILESTER_WEB_ORIGIN` and `FILESTER_API_ORIGIN` under **Settings → Variables and Secrets**.

## 6. If something stops working: Settings → Filester connection

Filester has no stable public contract for most of what this app uses, so it can change without notice.
The app checks every response for the fields it reads. When one changes you'll see
*“Filester changed how … responds”*, and the affected feature stops instead of acting on wrong data.
**Settings → Filester connection → Check connection** runs read-only checks of every endpoint
(it never asks for a download link, because Filester counts those as downloads). It shows which ones work,
which changed, and which are down or rate-limited.

## Optional hardening

The app is private to whoever has a Filester login, but the sign-in page is public. To hide the whole site
behind your own identity, put **Cloudflare Access** (Zero Trust → Access → Applications → Self-hosted,
domain `fs.snippface.vip`) in front of it. It's free for up to 50 users.

## Local development

```bash
cp .dev.vars.example .dev.vars   # then set SESSION_SECRET
npm install
npm run dev                      # http://localhost:3000, running in Cloudflare's local runtime (workerd)
```
