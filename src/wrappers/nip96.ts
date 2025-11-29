/**
 * NIP-96: HTTP File Storage Integration
 * Spec: ~/code/nips/96.md
 */
import { getToken, type SignerFunction } from "./nip98.js"
import { finalizeEvent } from "./pure.js"

export interface Nip96Plans {
  readonly free?: {
    readonly name?: string
    readonly is_nip98_required?: boolean
    readonly url?: string
    readonly max_byte_size?: number
    readonly file_expiration?: readonly [number, number]
    readonly media_transformations?: Record<string, readonly string[]>
  }
  readonly [k: string]: any
}

export interface Nip96Info {
  readonly api_url: string
  readonly download_url?: string
  readonly delegated_to_url?: string
  readonly supported_nips?: readonly number[]
  readonly tos_url?: string
  readonly content_types?: readonly string[]
  readonly plans?: Nip96Plans
}

export interface Nip96UploadOptions {
  readonly caption?: string
  readonly expiration?: string | number
  readonly size?: number
  readonly alt?: string
  readonly media_type?: "avatar" | "banner"
  readonly content_type?: string
  readonly no_transform?: boolean
  readonly extra?: Record<string, string | number | boolean>
}

export interface Nip94LikeEvent {
  readonly kind: number
  readonly tags: string[][]
  readonly content: string
}

export interface Nip96UploadResponse {
  readonly status: "success" | "processing" | "error" | string
  readonly url?: string
  readonly nip94_event?: Nip94LikeEvent
  readonly processing_url?: string
  readonly message?: string
  readonly headers?: Record<string, string>
  readonly blurhash?: string
  readonly size?: number
  readonly originalOriginalSha256?: string
}

export interface ProcessingStatus {
  readonly status: "processing" | "error"
  readonly message?: string
  readonly percentage?: number
}

const toURL = (base: string, path: string): string => {
  if (path.startsWith("http://") || path.startsWith("https://")) return path
  const u = new URL(base)
  if (path.startsWith("/")) {
    u.pathname = path
    return u.toString()
  }
  if (!u.pathname.endsWith("/")) u.pathname += "/"
  u.pathname += path
  return u.toString()
}

/** Fetch `/.well-known/nostr/nip96.json` from a host or full origin URL */
export async function fetchNip96Info(origin: string): Promise<Nip96Info> {
  // Accept bare hosts like https://server.foo or https://server.foo/.well-known...
  const infoUrl = origin.includes("/.well-known/nostr/nip96.json")
    ? origin
    : toURL(origin, "/.well-known/nostr/nip96.json")
  const res = await fetch(infoUrl, { method: "GET" })
  if (!res.ok) throw new Error(`nip96 info fetch failed: ${res.status}`)
  const json = (await res.json()) as Nip96Info
  return json
}

/**
 * Build Authorization header value (NIP-98) for a request
 */
export async function buildAuthorizationHeader(url: string, method: string, sign: SignerFunction): Promise<string> {
  return await getToken(url, method, sign, true)
}

/**
 * Create a SignerFunction from a secret key using the `pure` finalizeEvent
 */
export function signerFromSecretKey(secretKey: Uint8Array): SignerFunction {
  return async (tmpl) => finalizeEvent(tmpl as any, secretKey) as any
}

/**
 * Upload a file (Uint8Array/Blob) to the server api_url using NIP-98 Authorization.
 * Returns the server JSON response.
 */
export async function uploadFile(
  apiUrl: string,
  file: Blob | Uint8Array,
  filename: string,
  sign: SignerFunction,
  options: Nip96UploadOptions = {}
): Promise<Nip96UploadResponse> {
  const auth = await buildAuthorizationHeader(apiUrl, "POST", sign)
  const form = new FormData()
  const blob = file instanceof Blob ? file : new Blob([file])
  // Prefer File if available to set filename explicitly
  form.append("file", blob, filename)

  if (options.caption) form.append("caption", String(options.caption))
  if (options.expiration !== undefined) form.append("expiration", String(options.expiration))
  if (options.size !== undefined) form.append("size", String(options.size))
  if (options.alt) form.append("alt", options.alt)
  if (options.media_type) form.append("media_type", options.media_type)
  if (options.content_type) form.append("content_type", options.content_type)
  if (options.no_transform) form.append("no_transform", "true")
  if (options.extra) for (const [k, v] of Object.entries(options.extra)) form.append(k, String(v))

  const res = await fetch(apiUrl, {
    method: "POST",
    headers: { Authorization: auth },
    body: form,
  })
  if (!res.ok && res.status !== 201) {
    throw new Error(`upload failed: ${res.status}`)
  }
  return (await res.json()) as Nip96UploadResponse
}

/**
 * Poll processing_url until it returns 201 Created with the final JSON or times out
 */
export async function pollProcessing(processingUrl: string, { intervalMs = 500, timeoutMs = 10000 } = {}): Promise<Nip96UploadResponse> {
  const start = Date.now()
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const res = await fetch(processingUrl, { method: "GET" })
    if (res.status === 201) return (await res.json()) as Nip96UploadResponse
    if (!res.ok) throw new Error(`processing poll failed: ${res.status}`)
    const st = (await res.json()) as ProcessingStatus
    if (st.status === "error") throw new Error(st.message ?? "processing error")
    if (Date.now() - start > timeoutMs) throw new Error("processing timeout")
    await new Promise((r) => setTimeout(r, intervalMs))
  }
}

/**
 * DELETE a file by original sha256 hash (optionally with extension)
 */
export async function deleteFile(apiUrl: string, sha256WithOptExt: string, sign: SignerFunction): Promise<boolean> {
  const url = apiUrl.replace(/\/$/, "") + "/" + sha256WithOptExt
  const auth = await buildAuthorizationHeader(url, "DELETE", sign)
  const res = await fetch(url, { method: "DELETE", headers: { Authorization: auth } })
  return res.ok
}
