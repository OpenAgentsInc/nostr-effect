/**
 * NIP-B7: Blossom Media Servers
 *
 * Support for Blossom media servers for uploading, downloading, and managing blobs.
 * This wrapper provides nostr-tools-compatible API using Effect services under the hood.
 *
 * @example
 * ```typescript
 * import { BlossomClient } from 'nostr-effect/nipb7'
 * import { PlainKeySigner } from 'nostr-effect/signer'
 *
 * const signer = new PlainKeySigner(secretKey)
 * const client = new BlossomClient('https://blossom.example.com', signer)
 *
 * // Upload a file
 * const descriptor = await client.uploadFile(file)
 * console.log('Uploaded:', descriptor.url)
 *
 * // Download a blob
 * const data = await client.download(descriptor.sha256)
 *
 * // List all blobs
 * const blobs = await client.list()
 *
 * // Delete a blob
 * await client.delete(descriptor.sha256)
 * ```
 */

import { Effect, Exit } from "effect"
import { sha256 } from "@noble/hashes/sha256"
import { bytesToHex } from "@noble/hashes/utils"
import {
  BlossomService,
  BlossomServiceLive,
  type BlobDescriptor,
  type Signer,
  BLOSSOM_AUTH_KIND,
} from "../client/BlossomService.js"

// Re-export types
export type { BlobDescriptor, Signer }
export { BLOSSOM_AUTH_KIND }

/**
 * BlossomClient - nostr-tools-compatible Blossom client.
 * Uses Effect-based BlossomService under the hood.
 */
export class BlossomClient {
  private mediaserver: string
  private signer: Signer

  constructor(mediaserver: string, signer: Signer) {
    if (!mediaserver.startsWith("http")) {
      mediaserver = "https://" + mediaserver
    }
    this.mediaserver = mediaserver.replace(/\/$/, "") + "/"
    this.signer = signer
  }

  /**
   * Check if a blob exists on the server.
   * @param hash - SHA-256 hash of the blob
   * @throws Error if blob doesn't exist or hash is invalid
   */
  async check(hash: string): Promise<void> {
    const program = Effect.gen(function* (this: BlossomClient) {
      const service = yield* BlossomService
      return yield* service.check(this.mediaserver, hash)
    }.bind(this)).pipe(Effect.provide(BlossomServiceLive))

    const exit = await Effect.runPromiseExit(program)

    if (Exit.isFailure(exit)) {
      throw new Error(`Failed to check blob ${hash}`)
    }
  }

  /**
   * Upload a blob to the server.
   * @param file - File or Blob to upload
   * @param contentType - Optional content type override
   * @returns Blob descriptor with URL and metadata
   */
  async uploadBlob(file: File | Blob, contentType?: string): Promise<BlobDescriptor> {
    const actualContentType = contentType || file.type || "application/octet-stream"

    const program = Effect.gen(function* (this: BlossomClient) {
      const service = yield* BlossomService
      return yield* service.uploadBlob(this.mediaserver, this.signer, file, actualContentType)
    }.bind(this)).pipe(Effect.provide(BlossomServiceLive))

    const exit = await Effect.runPromiseExit(program)

    if (Exit.isFailure(exit)) {
      throw new Error("Failed to upload blob")
    }

    return exit.value
  }

  /**
   * Upload a file to the server.
   * @param file - File to upload
   * @returns Blob descriptor with URL and metadata
   */
  async uploadFile(file: File): Promise<BlobDescriptor> {
    return this.uploadBlob(file, file.type)
  }

  /**
   * Download a blob from the server.
   * @param hash - SHA-256 hash of the blob
   * @returns ArrayBuffer containing the blob data
   */
  async download(hash: string): Promise<ArrayBuffer> {
    const program = Effect.gen(function* (this: BlossomClient) {
      const service = yield* BlossomService
      return yield* service.download(this.mediaserver, this.signer, hash)
    }.bind(this)).pipe(Effect.provide(BlossomServiceLive))

    const exit = await Effect.runPromiseExit(program)

    if (Exit.isFailure(exit)) {
      throw new Error(`Failed to download blob ${hash}`)
    }

    return exit.value
  }

  /**
   * Download a blob as a Blob object.
   * @param hash - SHA-256 hash of the blob
   * @returns Blob object containing the data
   */
  async downloadAsBlob(hash: string): Promise<Blob> {
    const arrayBuffer = await this.download(hash)
    return new Blob([arrayBuffer])
  }

  /**
   * List all blobs for the current user.
   * @returns Array of blob descriptors
   */
  async list(): Promise<BlobDescriptor[]> {
    const program = Effect.gen(function* (this: BlossomClient) {
      const service = yield* BlossomService
      return yield* service.list(this.mediaserver, this.signer)
    }.bind(this)).pipe(Effect.provide(BlossomServiceLive))

    const exit = await Effect.runPromiseExit(program)

    if (Exit.isFailure(exit)) {
      throw new Error("Failed to list blobs")
    }

    return exit.value
  }

  /**
   * Delete a blob from the server.
   * @param hash - SHA-256 hash of the blob to delete
   */
  async delete(hash: string): Promise<void> {
    const program = Effect.gen(function* (this: BlossomClient) {
      const service = yield* BlossomService
      return yield* service.delete(this.mediaserver, this.signer, hash)
    }.bind(this)).pipe(Effect.provide(BlossomServiceLive))

    const exit = await Effect.runPromiseExit(program)

    if (Exit.isFailure(exit)) {
      throw new Error(`Failed to delete blob ${hash}`)
    }
  }
}

// =============================================================================
// Utility Functions
// =============================================================================

/**
 * Compute SHA-256 hash of a file or blob.
 * @param file - File or Blob to hash
 * @returns Hex-encoded SHA-256 hash
 */
export async function computeHash(file: File | Blob): Promise<string> {
  const ab = await file.arrayBuffer()
  const buffer = ab as ArrayBuffer
  return bytesToHex(sha256(new Uint8Array(buffer)))
}

/**
 * Check if a string is a valid 32-byte hex hash.
 * @param hash - String to validate
 * @returns true if valid hex hash
 */
export function isValidHash(hash: string): boolean {
  return /^[a-f0-9]{64}$/i.test(hash)
}
