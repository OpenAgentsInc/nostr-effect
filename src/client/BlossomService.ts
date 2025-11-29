/**
 * BlossomService
 *
 * NIP-B7: Blossom media server service.
 * Provides Effect-based methods for uploading, downloading, and managing blobs.
 *
 * @see https://github.com/hzrd149/blossom
 */
import { Context, Effect, Layer } from "effect"
import { sha256 } from "@noble/hashes/sha256"
import { bytesToHex } from "@noble/hashes/utils"
import { ConnectionError } from "../core/Errors.js"

// =============================================================================
// Types
// =============================================================================

/** Blob descriptor returned from Blossom operations */
export interface BlobDescriptor {
  url: string
  sha256: string
  size: number
  type: string
  uploaded: number
}

/** Event template for signing */
export interface EventTemplate {
  kind: number
  created_at: number
  content: string
  tags: string[][]
}

/** Signed event */
export interface SignedEvent extends EventTemplate {
  id: string
  pubkey: string
  sig: string
}

/** Signer interface for creating authorization */
export interface Signer {
  getPublicKey(): Promise<string>
  signEvent(event: EventTemplate): Promise<SignedEvent>
}

/** Blossom authorization event kind */
export const BLOSSOM_AUTH_KIND = 24242

// =============================================================================
// Service Interface
// =============================================================================

export interface BlossomService {
  readonly _tag: "BlossomService"

  /**
   * Check if a blob exists on the server
   */
  check(
    mediaserver: string,
    hash: string
  ): Effect.Effect<void, ConnectionError>

  /**
   * Upload a blob to the server
   */
  uploadBlob(
    mediaserver: string,
    signer: Signer,
    file: Blob,
    contentType?: string
  ): Effect.Effect<BlobDescriptor, ConnectionError>

  /**
   * Download a blob from the server
   */
  download(
    mediaserver: string,
    signer: Signer,
    hash: string
  ): Effect.Effect<ArrayBuffer, ConnectionError>

  /**
   * Download a blob as a Blob object
   */
  downloadAsBlob(
    mediaserver: string,
    signer: Signer,
    hash: string
  ): Effect.Effect<Blob, ConnectionError>

  /**
   * List all blobs for a user
   */
  list(
    mediaserver: string,
    signer: Signer
  ): Effect.Effect<BlobDescriptor[], ConnectionError>

  /**
   * Delete a blob from the server
   */
  delete(
    mediaserver: string,
    signer: Signer,
    hash: string
  ): Effect.Effect<void, ConnectionError>
}

// =============================================================================
// Service Tag
// =============================================================================

export const BlossomService = Context.GenericTag<BlossomService>("BlossomService")

// =============================================================================
// Helper Functions
// =============================================================================

function normalizeMediaserver(url: string): string {
  let normalized = url.trim()
  if (!normalized.startsWith("http")) {
    normalized = "https://" + normalized
  }
  normalized = normalized.replace(/\/$/, "") + "/"
  return normalized
}

function isValid32ByteHex(hash: string): boolean {
  return /^[a-f0-9]{64}$/i.test(hash)
}

async function createAuthorizationHeader(
  signer: Signer,
  tags: string[][]
): Promise<string> {
  const now = Math.floor(Date.now() / 1000)
  const event: EventTemplate = {
    created_at: now,
    kind: BLOSSOM_AUTH_KIND,
    content: "blossom stuff",
    tags: [["expiration", String(now + 60)], ...tags],
  }

  try {
    const signedEvent = await signer.signEvent(event)
    const eventJson = JSON.stringify(signedEvent)
    return "Nostr " + btoa(eventJson)
  } catch {
    return ""
  }
}

// =============================================================================
// Service Implementation
// =============================================================================

const make = Effect.gen(function* () {
  const check: BlossomService["check"] = (mediaserver, hash) =>
    Effect.gen(function* () {
      if (!isValid32ByteHex(hash)) {
        return yield* Effect.fail(
          new ConnectionError({
            message: `${hash} is not a valid 32-byte hex string`,
            url: mediaserver,
          })
        )
      }

      const url = normalizeMediaserver(mediaserver) + hash

      const response = yield* Effect.tryPromise({
        try: () => fetch(url, { method: "HEAD" }),
        catch: (error) =>
          new ConnectionError({
            message: `Failed to check blob: ${error}`,
            url: mediaserver,
          }),
      })

      if (response.status >= 300) {
        return yield* Effect.fail(
          new ConnectionError({
            message: `Blob not found: ${response.status}`,
            url: mediaserver,
          })
        )
      }
    })

  const uploadBlob: BlossomService["uploadBlob"] = (
    mediaserver,
    signer,
    file,
    contentType
  ) =>
    Effect.gen(function* () {
      const buffer = yield* Effect.tryPromise({
        try: async () => {
          const ab = await file.arrayBuffer()
          return ab as ArrayBuffer
        },
        catch: (error) =>
          new ConnectionError({
            message: `Failed to read file: ${error}`,
            url: mediaserver,
          }),
      })

      const hash = bytesToHex(sha256(new Uint8Array(buffer)))
      const actualContentType = contentType || file.type || "application/octet-stream"
      const url = normalizeMediaserver(mediaserver) + "upload"

      const authHeader = yield* Effect.tryPromise({
        try: () =>
          createAuthorizationHeader(signer, [
            ["t", "upload"],
            ["x", hash],
          ]),
        catch: (error) =>
          new ConnectionError({
            message: `Failed to create auth header: ${error}`,
            url: mediaserver,
          }),
      })

      const headers: Record<string, string> = {
        "Content-Type": actualContentType,
      }
      if (authHeader) {
        headers["Authorization"] = authHeader
      }

      const response = yield* Effect.tryPromise({
        try: () =>
          fetch(url, {
            method: "PUT",
            headers,
            body: file,
          }),
        catch: (error) =>
          new ConnectionError({
            message: `Failed to upload blob: ${error}`,
            url: mediaserver,
          }),
      })

      if (response.status >= 300) {
        const reason = response.headers.get("X-Reason") || response.statusText
        return yield* Effect.fail(
          new ConnectionError({
            message: `Upload failed (${response.status}): ${reason}`,
            url: mediaserver,
          })
        )
      }

      const bd = yield* Effect.tryPromise({
        try: () => response.json() as Promise<BlobDescriptor>,
        catch: (error) =>
          new ConnectionError({
            message: `Failed to parse response: ${error}`,
            url: mediaserver,
          }),
      })

      return bd
    })

  const download: BlossomService["download"] = (mediaserver, signer, hash) =>
    Effect.gen(function* () {
      if (!isValid32ByteHex(hash)) {
        return yield* Effect.fail(
          new ConnectionError({
            message: `${hash} is not a valid 32-byte hex string`,
            url: mediaserver,
          })
        )
      }

      const url = normalizeMediaserver(mediaserver) + hash

      const authHeader = yield* Effect.tryPromise({
        try: () =>
          createAuthorizationHeader(signer, [
            ["t", "get"],
            ["x", hash],
          ]),
        catch: (error) =>
          new ConnectionError({
            message: `Failed to create auth header: ${error}`,
            url: mediaserver,
          }),
      })

      const response = yield* Effect.tryPromise({
        try: () =>
          fetch(url, {
            method: "GET",
            headers: authHeader ? { Authorization: authHeader } : {},
          }),
        catch: (error) =>
          new ConnectionError({
            message: `Failed to download blob: ${error}`,
            url: mediaserver,
          }),
      })

      if (response.status >= 300) {
        return yield* Effect.fail(
          new ConnectionError({
            message: `Blob not found: ${response.status}`,
            url: mediaserver,
          })
        )
      }

      const buffer = yield* Effect.tryPromise({
        try: async () => {
          const ab = await response.arrayBuffer()
          return ab as ArrayBuffer
        },
        catch: (error) =>
          new ConnectionError({
            message: `Failed to read response: ${error}`,
            url: mediaserver,
          }),
      })

      return buffer
    })

  const downloadAsBlob: BlossomService["downloadAsBlob"] = (
    mediaserver,
    signer,
    hash
  ) =>
    Effect.gen(function* () {
      const buffer = yield* download(mediaserver, signer, hash)
      return new Blob([buffer])
    })

  const list: BlossomService["list"] = (mediaserver, signer) =>
    Effect.gen(function* () {
      const pubkey = yield* Effect.tryPromise({
        try: () => signer.getPublicKey(),
        catch: (error) =>
          new ConnectionError({
            message: `Failed to get pubkey: ${error}`,
            url: mediaserver,
          }),
      })

      if (!isValid32ByteHex(pubkey)) {
        return yield* Effect.fail(
          new ConnectionError({
            message: `Invalid pubkey: ${pubkey}`,
            url: mediaserver,
          })
        )
      }

      const url = normalizeMediaserver(mediaserver) + `list/${pubkey}`

      const authHeader = yield* Effect.tryPromise({
        try: () => createAuthorizationHeader(signer, [["t", "list"]]),
        catch: (error) =>
          new ConnectionError({
            message: `Failed to create auth header: ${error}`,
            url: mediaserver,
          }),
      })

      const response = yield* Effect.tryPromise({
        try: () =>
          fetch(url, {
            method: "GET",
            headers: authHeader ? { Authorization: authHeader } : {},
          }),
        catch: (error) =>
          new ConnectionError({
            message: `Failed to list blobs: ${error}`,
            url: mediaserver,
          }),
      })

      if (response.status >= 300) {
        return yield* Effect.fail(
          new ConnectionError({
            message: `List failed: ${response.status}`,
            url: mediaserver,
          })
        )
      }

      const bds = yield* Effect.tryPromise({
        try: () => response.json() as Promise<BlobDescriptor[]>,
        catch: (error) =>
          new ConnectionError({
            message: `Failed to parse response: ${error}`,
            url: mediaserver,
          }),
      })

      return bds
    })

  const deleteBlob: BlossomService["delete"] = (mediaserver, signer, hash) =>
    Effect.gen(function* () {
      if (!isValid32ByteHex(hash)) {
        return yield* Effect.fail(
          new ConnectionError({
            message: `${hash} is not a valid 32-byte hex string`,
            url: mediaserver,
          })
        )
      }

      const url = normalizeMediaserver(mediaserver) + hash

      const authHeader = yield* Effect.tryPromise({
        try: () =>
          createAuthorizationHeader(signer, [
            ["t", "delete"],
            ["x", hash],
          ]),
        catch: (error) =>
          new ConnectionError({
            message: `Failed to create auth header: ${error}`,
            url: mediaserver,
          }),
      })

      const response = yield* Effect.tryPromise({
        try: () =>
          fetch(url, {
            method: "DELETE",
            headers: authHeader ? { Authorization: authHeader } : {},
          }),
        catch: (error) =>
          new ConnectionError({
            message: `Failed to delete blob: ${error}`,
            url: mediaserver,
          }),
      })

      if (response.status >= 300) {
        const reason = response.headers.get("X-Reason") || response.statusText
        return yield* Effect.fail(
          new ConnectionError({
            message: `Delete failed (${response.status}): ${reason}`,
            url: mediaserver,
          })
        )
      }
    })

  return {
    _tag: "BlossomService" as const,
    check,
    uploadBlob,
    download,
    downloadAsBlob,
    list,
    delete: deleteBlob,
  }
})

// =============================================================================
// Service Layer
// =============================================================================

/**
 * Live layer for BlossomService
 */
export const BlossomServiceLive = Layer.effect(BlossomService, make)
