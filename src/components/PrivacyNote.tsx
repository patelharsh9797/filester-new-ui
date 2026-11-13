import { ShieldCheck } from 'lucide-react'

// One source of truth for what this app does with people's data. Keep it in step
// with the code: session.server.ts (cookie), r2config.server.ts (KV), backup.server.ts,
// filester.server.ts (proxy), wrangler.jsonc (observability is off: no stored logs), public/sw.js.

const PASSES = [
  <><b>Your password</b> goes to filester.me once, when you sign in. It isn't stored or logged.</>,
  <><b>Requests to Filester</b> (listing, renaming, moving, deleting) and <b>uploads</b> pass through this site’s server, because Filester doesn’t let browsers call it directly. Nothing from them is kept.</>,
  <><b>Backups</b> stream from Filester straight into <i>your own</i> R2 bucket through this server; the files aren’t stored here.</>,
  <><b>Downloads</b> you start go straight from Filester to you. <b>Thumbnails and previews</b> in the gallery also load straight from Filester into your browser; opening a preview counts as a view on Filester.</>,
]

const STORED = [
  <><b>In your browser:</b> an encrypted session cookie with your Filester session and API key, which page scripts can’t read. It lasts up to 30 days and is deleted when you sign out. Also your preferences, pinned folders and saved searches, and the progress of unfinished backups so they can resume.</>,
  <><b>On this site’s server, only if you turn on backups:</b> your R2 keys, encrypted so they only decrypt for your account, and your backup settings. Disconnecting deletes them. There’s also a count of bytes you backed up today (for the daily limit), deleted after 2 days.</>,
  <><b>No request logs are kept.</b> Like any web host, Cloudflare handles your connection to serve the site.</>,
]

const NEVER = 'Never stored here: your files, your password, or your file list. No analytics, ads or trackers.'
const TRUST = 'Whoever runs this site holds the encryption keys, so only sign in to a copy run by someone you trust, or run your own.'

/** Full version for Settings. */
export function PrivacyDetails({ turnstile }: { turnstile?: boolean }) {
  return (
    <section className="card p-4 space-y-3 text-sm" aria-labelledby="privacy-h">
      <h2 id="privacy-h" className="font-semibold flex items-center gap-1.5"><ShieldCheck className="size-4" /> Privacy</h2>
      <Body turnstile={turnstile} />
    </section>
  )
}

function Body({ turnstile }: { turnstile?: boolean }) {
  return (
    <div className="space-y-3 text-muted">
      <div>
        <h3 className="text-ink font-medium mb-1">What passes through this site</h3>
        <ul className="list-disc pl-5 space-y-1">{PASSES.map((x, i) => <li key={i}>{x}</li>)}</ul>
      </div>
      <div>
        <h3 className="text-ink font-medium mb-1">What’s stored</h3>
        <ul className="list-disc pl-5 space-y-1">
          {STORED.map((x, i) => <li key={i}>{x}</li>)}
          {turnstile && <li><b>Bot check:</b> Cloudflare Turnstile checks your browser on the sign-in page.</li>}
        </ul>
      </div>
      <p className="text-ink">{NEVER}</p>
      <p>{TRUST}</p>
    </div>
  )
}

/** Short version for the sign-in page, expandable to the full text. */
export function PrivacySummary({ turnstile }: { turnstile?: boolean }) {
  return (
    <details className="group text-xs text-faint leading-relaxed">
      <summary className="cursor-pointer list-none flex gap-1.5 [&::-webkit-details-marker]:hidden">
        <ShieldCheck className="size-3.5 shrink-0 mt-0.5" />
        <span>
          Your password goes to filester.me once and is never stored. Your files never touch this site’s storage.{' '}
          <span className="underline group-open:hidden">What’s stored?</span>
        </span>
      </summary>
      <div className="mt-3 pt-3 border-t border-line text-xs"><Body turnstile={turnstile} /></div>
    </details>
  )
}
