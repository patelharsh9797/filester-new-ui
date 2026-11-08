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

## 3. R2 bucket for backups

The Expiring soon page can copy files into R2. Create the bucket once (the name must match `wrangler.jsonc`):

```bash
npx wrangler r2 bucket create filester-backups
```

Or use the Dashboard: **R2 → Create bucket → `filester-backups`**. The Worker gets access through the `BACKUPS` binding automatically on the next deploy.

Two plain-text vars in `wrangler.jsonc` control it (you can also override them in the Worker's **Settings → Variables and Secrets**):

| Var | Default | Meaning |
|---|---|---|
| `BACKUP_LIMIT_GB` | `10` | New backups are refused once the bucket would go over this. 10 GB is R2's free tier. |
| `BACKUP_RETENTION_DAYS` | `7` | Backups older than this are deleted automatically, whenever the app lists backups. |

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
