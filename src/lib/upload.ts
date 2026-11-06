/**
 * Upload a file through this app's /api/fs route using Filester's chunked v2 protocol
 * (the same one their web uploader uses):
 *
 *   POST /api/v2/upload/init    {filename,size,folder} -> {id,chunk_size,total_chunks,parallel}
 *   PUT  /api/v2/upload/chunk   X-Upload-Id, X-Chunk-Index, raw bytes
 *   POST /api/v2/upload/finish  X-Upload-Id -> 200 result | 202 processing
 *   POST /api/v2/upload/abort   X-Upload-Id
 *
 * Falls back to the single-request v1 upload if v2 is unavailable.
 */

export interface UploadResult {
  slug: string
  url: string
  file_id: number
}

export interface UploadHandle {
  promise: Promise<UploadResult>
  abort: () => void
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const RETRYABLE = new Set([0, 408, 429, 500, 502, 503, 504])

export function uploadFile(
  file: File,
  folder: string | null,
  onProgress: (loaded: number, total: number) => void,
): UploadHandle {
  let aborted = false
  const xhrs = new Set<XMLHttpRequest>()
  let uploadId = ''

  const abort = () => {
    aborted = true
    xhrs.forEach((x) => x.abort())
    if (uploadId) {
      fetch('/api/fs/v2/upload/abort', { method: 'POST', headers: { 'x-upload-id': uploadId } }).catch(() => {})
    }
  }

  const xhrSend = (method: string, url: string, headers: Record<string, string>, body: XMLHttpRequestBodyInit, onUp?: (n: number) => void) =>
    new Promise<{ status: number; json: Record<string, unknown> }>((resolve) => {
      const xhr = new XMLHttpRequest()
      xhrs.add(xhr)
      xhr.open(method, url)
      for (const [k, v] of Object.entries(headers)) xhr.setRequestHeader(k, v)
      if (onUp) xhr.upload.onprogress = (e) => e.lengthComputable && onUp(e.loaded)
      const done = () => {
        xhrs.delete(xhr)
        let json: Record<string, unknown> = {}
        try { json = JSON.parse(xhr.responseText) } catch { /* not json */ }
        resolve({ status: xhr.status, json })
      }
      xhr.onload = done
      xhr.onerror = done
      xhr.onabort = done
      xhr.send(body)
    })

  const v1 = async (): Promise<UploadResult> => {
    const fd = new FormData()
    fd.append('file', file)
    const headers: Record<string, string> = folder ? { 'x-folder-id': folder } : {}
    const r = await xhrSend('POST', '/api/fs/v1/upload', headers, fd, (n) => onProgress(n, file.size))
    if (aborted) throw new Error('Cancelled')
    if (r.status !== 200 || !r.json.success) throw new Error(String(r.json.message || `Upload failed (${r.status})`))
    return r.json as unknown as UploadResult
  }

  const v2 = async (): Promise<UploadResult> => {
    const initRes = await fetch('/api/fs/v2/upload/init', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ filename: file.name, size: file.size, folder: folder ?? '' }),
    })
    if (initRes.status === 404 || initRes.status === 405) return v1()
    const plan = (await initRes.json()) as { success?: boolean; message?: string; id: string; chunk_size: number; total_chunks: number; parallel?: number }
    if (!initRes.ok || !plan.success) throw new Error(plan.message || `Upload init failed (${initRes.status})`)
    uploadId = plan.id
    const chunkSize: number = plan.chunk_size
    const total: number = plan.total_chunks
    const streams = Math.max(1, Math.min(4, plan.parallel || 1))
    const loaded = new Array<number>(total).fill(0)
    const report = () => onProgress(loaded.reduce((a, b) => a + b, 0), file.size)

    const sendChunk = async (i: number) => {
      const start = i * chunkSize
      const end = Math.min(start + chunkSize, file.size)
      for (let attempt = 1; ; attempt++) {
        if (aborted) throw new Error('Cancelled')
        const r = await xhrSend('PUT', '/api/fs/v2/upload/chunk',
          { 'x-upload-id': uploadId, 'x-chunk-index': String(i), 'content-type': 'application/octet-stream' },
          file.slice(start, end), (n) => { loaded[i] = n; report() })
        if (r.status === 200 && r.json.success) { loaded[i] = end - start; report(); return }
        loaded[i] = 0
        if (aborted) throw new Error('Cancelled')
        if (!RETRYABLE.has(r.status) || attempt >= 6) throw new Error(String(r.json.message || `Chunk ${i} failed (${r.status})`))
        await sleep(Math.min(16000, 1000 * 2 ** attempt))
      }
    }

    let next = 0
    const worker = async () => { while (next < total) await sendChunk(next++) }
    await Promise.all(Array.from({ length: Math.min(streams, total) }, worker))

    const deadline = Date.now() + 30 * 60_000
    for (;;) {
      if (aborted) throw new Error('Cancelled')
      const r = await fetch('/api/fs/v2/upload/finish', { method: 'POST', headers: { 'x-upload-id': uploadId } })
      const j = (await r.json().catch(() => ({}))) as { success?: boolean; message?: string }
      if (r.status === 200 && j.success) return j as unknown as UploadResult
      if (r.status !== 202 && !RETRYABLE.has(r.status)) throw new Error(j.message || `Finish failed (${r.status})`)
      if (Date.now() > deadline) throw new Error('Timed out waiting for Filester to process the upload')
      await sleep(1500)
    }
  }

  return { promise: v2(), abort }
}
