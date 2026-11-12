// Minimal client for a user's own R2 bucket over R2's S3-compatible API (SigV4 via aws4fetch).
//
// The host is always https://<accountId>.r2.cloudflarestorage.com with a validated
// account id and bucket name, so user input can never point the server elsewhere.
import { env } from 'cloudflare:workers'
import { AwsClient } from 'aws4fetch'
import { ACCOUNT_ID_RE, BUCKET_RE, type R2Config } from './r2config.server'

export class S3Error extends Error {
  status: number
  code: string
  constructor(message: string, status: number, code: string) { super(message); this.status = status; this.code = code }
}

export interface ObjectInfo { key: string; size: number; lastModified: string }
export interface UploadInfo { key: string; uploadId: string; initiated: string }

const xmlText = (xml: string, tag: string) => {
  const m = new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`).exec(xml)
  return m ? decodeXml(m[1]) : ''
}
const xmlBlocks = (xml: string, tag: string) => [...xml.matchAll(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, 'g'))].map((m) => m[1])
const decodeXml = (s: string) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&')
const escXml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
// S3 SigV4 needs RFC 3986 encoding: encodeURIComponent leaves !'()* alone, which would
// make the signed path differ from the sent one for names like "photo (1).jpg".
export const rfc3986 = (s: string) => encodeURIComponent(s).replace(/[!'()*]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase())
export const encKey = (key: string) => key.split('/').map(rfc3986).join('/')

export function s3(cfg: R2Config) {
  if (!ACCOUNT_ID_RE.test(cfg.accountId) || !BUCKET_RE.test(cfg.bucket)) throw new S3Error('Invalid bucket settings', 400, 'BadConfig')
  const client = new AwsClient({ accessKeyId: cfg.accessKeyId, secretAccessKey: cfg.secretAccessKey, service: 's3', region: 'auto' })
  // Dev/test only: point at a local S3-compatible server instead of R2.
  const override = (env as unknown as Record<string, string | undefined>).R2_ENDPOINT_OVERRIDE
  const base = `${override ? override.replace(/\/$/, '') : `https://${cfg.accountId}.r2.cloudflarestorage.com`}/${cfg.bucket}`

  async function send(method: string, path: string, init: { headers?: Record<string, string>; body?: BodyInit | null; query?: Record<string, string> } = {}) {
    const url = new URL(base + (path ? '/' + encKey(path) : ''))
    for (const [k, v] of Object.entries(init.query ?? {})) url.searchParams.set(k, v)
    // Streams aren't hashed: UNSIGNED-PAYLOAD (supported by R2) keeps big parts cheap.
    const headers = { ...(init.body && typeof init.body !== 'string' ? { 'x-amz-content-sha256': 'UNSIGNED-PAYLOAD' } : {}), ...init.headers }
    const res = await client.fetch(url.toString(), { method, headers, body: init.body ?? undefined })
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      const code = xmlText(text, 'Code') || `HTTP${res.status}`
      throw new S3Error(friendly(code, res.status, xmlText(text, 'Message')), res.status, code)
    }
    return res
  }

  return {
    bucket: cfg.bucket,

    async put(key: string, body: ReadableStream | string, length: number, headers: Record<string, string> = {}) {
      await send('PUT', key, { body, headers: { 'content-length': String(length), ...headers } })
    },

    async get(key: string) {
      return send('GET', key)
    },

    async head(key: string): Promise<{ size: number } | null> {
      try {
        const r = await send('HEAD', key)
        return { size: Number(r.headers.get('content-length')) || 0 }
      } catch (e) {
        if (e instanceof S3Error && e.status === 404) return null
        throw e
      }
    },

    async del(key: string) {
      await send('DELETE', key)
    },

    async list(prefix: string): Promise<ObjectInfo[]> {
      const out: ObjectInfo[] = []
      let token = ''
      for (;;) {
        const q: Record<string, string> = { 'list-type': '2', prefix, 'max-keys': '1000' }
        if (token) q['continuation-token'] = token
        const xml = await (await send('GET', '', { query: q })).text()
        for (const b of xmlBlocks(xml, 'Contents')) out.push({ key: xmlText(b, 'Key'), size: Number(xmlText(b, 'Size')) || 0, lastModified: xmlText(b, 'LastModified') })
        if (xmlText(xml, 'IsTruncated') !== 'true') break
        token = xmlText(xml, 'NextContinuationToken')
        if (!token) break
      }
      return out
    },

    async createMultipart(key: string, headers: Record<string, string> = {}) {
      const xml = await (await send('POST', key, { query: { uploads: '' }, headers })).text()
      const uploadId = xmlText(xml, 'UploadId')
      if (!uploadId) throw new S3Error('Bucket did not return an upload id', 502, 'NoUploadId')
      return uploadId
    },

    async uploadPart(key: string, uploadId: string, partNumber: number, body: ReadableStream, length: number) {
      const r = await send('PUT', key, { query: { partNumber: String(partNumber), uploadId }, body, headers: { 'content-length': String(length) } })
      return (r.headers.get('etag') ?? '').replace(/"/g, '')
    },

    async completeMultipart(key: string, uploadId: string, parts: { partNumber: number; etag: string }[]) {
      const body = `<CompleteMultipartUpload>${parts.map((p) => `<Part><PartNumber>${p.partNumber}</PartNumber><ETag>"${escXml(p.etag)}"</ETag></Part>`).join('')}</CompleteMultipartUpload>`
      const r = await send('POST', key, { query: { uploadId }, body, headers: { 'content-type': 'application/xml' } })
      const text = await r.text()
      // S3 can report a failure inside a 200 response.
      if (text.includes('<Error>')) throw new S3Error(xmlText(text, 'Message') || 'Could not finish the upload', 502, xmlText(text, 'Code') || 'CompleteFailed')
    },

    async abortMultipart(key: string, uploadId: string) {
      try { await send('DELETE', key, { query: { uploadId } }) } catch (e) { if (!(e instanceof S3Error && e.status === 404)) throw e }
    },

    async listMultipart(prefix: string): Promise<UploadInfo[]> {
      const xml = await (await send('GET', '', { query: { uploads: '', prefix } })).text()
      return xmlBlocks(xml, 'Upload').map((b) => ({ key: xmlText(b, 'Key'), uploadId: xmlText(b, 'UploadId'), initiated: xmlText(b, 'Initiated') }))
    },

    /** Bytes held by an unfinished upload's parts. */
    async partsSize(key: string, uploadId: string): Promise<number> {
      try {
        const xml = await (await send('GET', key, { query: { uploadId } })).text()
        return xmlBlocks(xml, 'Part').reduce((n, b) => n + (Number(xmlText(b, 'Size')) || 0), 0)
      } catch { return 0 }
    },
  }
}

export type Bucket = ReturnType<typeof s3>

/** Turn S3 error codes into messages a user can act on. */
function friendly(code: string, status: number, message: string) {
  switch (code) {
    case 'NoSuchBucket': return 'That bucket doesn’t exist in this account. Check the bucket name and account ID.'
    case 'InvalidAccessKeyId': return 'The Access Key ID wasn’t recognised. Copy it again from your R2 API token.'
    case 'SignatureDoesNotMatch': return 'The Secret Access Key doesn’t match the Access Key ID.'
    case 'AccessDenied': return 'The token doesn’t have permission for this bucket. Give it “Object Read & Write” on this bucket.'
    case 'NoSuchUpload': return 'This unfinished upload no longer exists.'
    default: return message || `Your bucket returned an error (${status} ${code})`
  }
}
