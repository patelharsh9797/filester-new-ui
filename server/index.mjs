// Local companion server for the Filester UI.
//
// Filester's APIs only allow CORS from https://filester.me, so the browser
// cannot call them directly. This tiny zero-dependency server:
//   - logs in to filester.me and returns the session token + API key
//   - proxies the documented REST API (u1.filester.me, Bearer API key)
//   - proxies the web-only endpoints (filester.me/api, auth_token cookie)
//     for features the public API lacks (rename, folder edit, file info, ...)
//   - serves the built UI from ./dist in production
//
// Credentials are never stored here: the browser sends them on every request
// in X-Fs-Key / X-Fs-Token headers and they are forwarded upstream only.

import http from 'node:http';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { extname, join, normalize, resolve } from 'node:path';
import { Readable } from 'node:stream';

const PORT = Number(process.env.PORT || 8787);
const HOST = process.env.HOST || '127.0.0.1';
const WEB = 'https://filester.me';
const U1 = 'https://u1.filester.me';
const DIST = resolve(import.meta.dirname, '..', 'dist');
const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36';

// Request headers we pass through to Filester (everything else is dropped).
const FORWARD_REQ = ['content-type', 'content-length', 'x-upload-id', 'x-chunk-index', 'x-folder-id', 'accept'];
// Response headers we pass back to the browser.
const FORWARD_RES = ['content-type', 'content-disposition', 'retry-after',
  'x-ratelimit-limit', 'x-ratelimit-remaining', 'x-ratelimit-reset'];

const ROUTES = [
  // prefix            upstream base           auth style
  ['/proxy/v1/',  `${U1}/api/v1/`, 'key'],
  ['/proxy/v2/',  `${U1}/api/v2/`, 'key'],
  ['/proxy/u1/',  `${U1}/`,        'key'],
  ['/proxy/web/', `${WEB}/api/`,   'cookie'],
];

function json(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}

async function readJson(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); } catch { return {}; }
}

function tokenFromSetCookie(headers) {
  const all = headers.getSetCookie ? headers.getSetCookie() : [];
  for (const c of all) {
    const m = /^auth_token=([^;]+)/.exec(c);
    if (m && m[1]) return m[1];
  }
  return '';
}

async function fetchApiKey(token) {
  const r = await fetch(`${WEB}/account`, { headers: { cookie: `auth_token=${token}`, 'user-agent': UA } });
  const html = await r.text();
  const m = /id="apiKeyValue"[^>]*>\s*([^<\s]+)\s*</.exec(html);
  return m ? m[1] : '';
}

async function handleLogin(req, res) {
  const { username, password, code } = await readJson(req);
  if (!username || !password) return json(res, 400, { success: false, message: 'Username and password are required' });
  const body = { username, password };
  if (code) body.code = code;
  const r = await fetch(`${WEB}/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'user-agent': UA },
    body: JSON.stringify(body),
  });
  const data = await r.json().catch(() => ({}));
  if (data.requires_2fa) return json(res, 200, { success: false, requires_2fa: true, message: 'Enter your 2FA or backup code' });
  if (!r.ok || !data.success) return json(res, r.status === 200 ? 401 : r.status, { success: false, message: data.message || 'Login failed' });
  const token = data.token || tokenFromSetCookie(r.headers);
  if (!token) return json(res, 502, { success: false, message: 'Login succeeded but no session token was returned' });
  const apiKey = await fetchApiKey(token).catch(() => '');
  json(res, 200, { success: true, username, token, apiKey });
}

async function handleProxy(req, res, upstreamBase, auth, rest) {
  const headers = { 'user-agent': UA };
  for (const h of FORWARD_REQ) if (req.headers[h]) headers[h] = req.headers[h];
  if (auth === 'key') {
    const key = req.headers['x-fs-key'];
    if (key) headers.authorization = `Bearer ${key}`;
  } else {
    const token = req.headers['x-fs-token'];
    if (token) headers.cookie = `auth_token=${token}`;
  }
  const hasBody = !['GET', 'HEAD'].includes(req.method);
  const upstream = await fetch(upstreamBase + rest, {
    method: req.method,
    headers,
    body: hasBody ? Readable.toWeb(req) : undefined,
    duplex: hasBody ? 'half' : undefined,
    redirect: 'manual',
  });
  const out = {};
  for (const h of FORWARD_RES) { const v = upstream.headers.get(h); if (v) out[h] = v; }
  res.writeHead(upstream.status, out);
  if (upstream.body) Readable.fromWeb(upstream.body).pipe(res);
  else res.end();
}

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json', '.woff2': 'font/woff2' };

function serveStatic(req, res, pathname) {
  if (!existsSync(DIST)) return json(res, 404, { message: 'UI not built. Run `npm run build` or use `npm run dev`.' });
  let file = normalize(join(DIST, decodeURIComponent(pathname)));
  if (!file.startsWith(DIST)) return json(res, 403, { message: 'Forbidden' });
  if (!existsSync(file) || statSync(file).isDirectory()) file = join(DIST, 'index.html'); // SPA fallback
  res.writeHead(200, { 'content-type': MIME[extname(file)] || 'application/octet-stream' });
  createReadStream(file).pipe(res);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://local');
  try {
    if (url.pathname === '/local/health') return json(res, 200, { ok: true });
    if (url.pathname === '/local/login' && req.method === 'POST') return await handleLogin(req, res);
    for (const [prefix, base, auth] of ROUTES) {
      if (url.pathname.startsWith(prefix)) {
        return await handleProxy(req, res, base, auth, url.pathname.slice(prefix.length) + url.search);
      }
    }
    if (url.pathname.startsWith('/proxy/') || url.pathname.startsWith('/local/')) return json(res, 404, { message: 'Unknown route' });
    serveStatic(req, res, url.pathname);
  } catch (err) {
    console.error(req.method, req.url, err);
    if (!res.headersSent) json(res, 502, { success: false, message: `Upstream error: ${err.message}` });
    else res.destroy(err);
  }
});

server.requestTimeout = 0; // allow long uploads
server.listen(PORT, HOST, () => console.log(`Filester UI server on http://${HOST}:${PORT}`));
