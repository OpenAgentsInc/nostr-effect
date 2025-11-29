/**
 * NIP-46 Remote Signing (Nostr Connect)
 *
 * Enables clients to request event signing from remote signers (bunkers).
 * Uses NIP-44 encryption for all communication over kind 24133 events.
 *
 * @see https://github.com/nostr-protocol/nips/blob/master/46.md
 */
import { Context, Effect, Layer, Deferred, Option } from "effect"
import { Schema } from "@effect/schema"
import { bytesToHex } from "@noble/hashes/utils"
import type { PublicKey, NostrEvent, EventKind } from "../core/Schema.js"
import { NostrEvent as NostrEventSchema } from "../core/Schema.js"
import { CryptoService } from "../services/CryptoService.js"
import { CryptoError, InvalidPrivateKey, TimeoutError } from "../core/Errors.js"
import { Nip44Service, type ConversationKey, type EncryptedPayload } from "../services/Nip44Service.js"

// =============================================================================
// Constants
// =============================================================================

/** Event kind for NIP-46 request/response messages */
export const NIP46_KIND = 24133 as EventKind

// =============================================================================
// Types
// =============================================================================

/** Parsed bunker:// URL */
export interface BunkerUrl {
  readonly type: "bunker"
  readonly remoteSignerPubkey: PublicKey
  readonly relays: readonly string[]
  readonly secret?: string
}

/** Parsed nostrconnect:// URL */
export interface NostrConnectUrl {
  readonly type: "nostrconnect"
  readonly clientPubkey: PublicKey
  readonly relays: readonly string[]
  readonly secret: string
  readonly name?: string
  readonly url?: string
  readonly image?: string
  readonly perms?: string
}

/** NIP-46 connection URL (either bunker:// or nostrconnect://) */
export type Nip46Url = BunkerUrl | NostrConnectUrl

/** NIP-46 RPC request */
export interface Nip46Request {
  readonly id: string
  readonly method: Nip46Method
  readonly params: readonly string[]
}

/** NIP-46 RPC response */
export interface Nip46Response {
  readonly id: string
  readonly result?: string
  readonly error?: string
}

/** NIP-46 method names */
export type Nip46Method =
  | "connect"
  | "sign_event"
  | "ping"
  | "get_public_key"
  | "nip04_encrypt"
  | "nip04_decrypt"
  | "nip44_encrypt"
  | "nip44_decrypt"

/** Unsigned event for signing (NIP-46 specific) */
export interface Nip46UnsignedEvent {
  readonly kind: number
  readonly content: string
  readonly tags: readonly (readonly string[])[]
  readonly created_at: number
}

/** Connection state */
export type Nip46ConnectionState =
  | "disconnected"
  | "connecting"
  | "connected"

/** Auth challenge info */
export interface AuthChallenge {
  readonly requestId: string
  readonly authUrl: string
}

/** Pending request tracker */
interface PendingRequest {
  readonly deferred: Deferred.Deferred<Nip46Response, TimeoutError>
  readonly timeoutId: ReturnType<typeof setTimeout>
}

// =============================================================================
// Errors
// =============================================================================

export class Nip46Error extends Schema.TaggedError<Nip46Error>()(
  "Nip46Error",
  { message: Schema.String }
) {}

export class Nip46ParseError extends Schema.TaggedError<Nip46ParseError>()(
  "Nip46ParseError",
  { message: Schema.String, input: Schema.String }
) {}

export class Nip46MethodError extends Schema.TaggedError<Nip46MethodError>()(
  "Nip46MethodError",
  { message: Schema.String, method: Schema.String }
) {}

// =============================================================================
// URL Parsing
// =============================================================================

/**
 * Parse a bunker:// URL
 *
 * Format: bunker://<remote-signer-pubkey>?relay=<wss://...>&relay=...&secret=<optional>
 */
export const parseBunkerUrl = (
  input: string
): Effect.Effect<BunkerUrl, Nip46ParseError> =>
  Effect.try({
    try: () => {
      if (!input.startsWith("bunker://")) {
        throw new Error("URL must start with bunker://")
      }

      const url = new URL(input)
      const remoteSignerPubkey = url.hostname || url.pathname.replace(/^\/\//, "")

      if (!remoteSignerPubkey || !/^[0-9a-f]{64}$/i.test(remoteSignerPubkey)) {
        throw new Error("Invalid remote signer pubkey")
      }

      const relays = url.searchParams.getAll("relay")
      if (relays.length === 0) {
        throw new Error("At least one relay is required")
      }

      const secretValue = url.searchParams.get("secret")

      const result: BunkerUrl = {
        type: "bunker" as const,
        remoteSignerPubkey: remoteSignerPubkey.toLowerCase() as PublicKey,
        relays,
      }
      if (secretValue) {
        (result as { secret: string }).secret = secretValue
      }
      return result
    },
    catch: (error) =>
      new Nip46ParseError({
        message: error instanceof Error ? error.message : "Failed to parse bunker URL",
        input,
      }),
  })

/**
 * Parse a nostrconnect:// URL
 *
 * Format: nostrconnect://<client-pubkey>?relay=<wss://...>&secret=<required>&name=...&perms=...
 */
export const parseNostrConnectUrl = (
  input: string
): Effect.Effect<NostrConnectUrl, Nip46ParseError> =>
  Effect.try({
    try: () => {
      if (!input.startsWith("nostrconnect://")) {
        throw new Error("URL must start with nostrconnect://")
      }

      const url = new URL(input)
      const clientPubkey = url.hostname || url.pathname.replace(/^\/\//, "")

      if (!clientPubkey || !/^[0-9a-f]{64}$/i.test(clientPubkey)) {
        throw new Error("Invalid client pubkey")
      }

      const relays = url.searchParams.getAll("relay")
      if (relays.length === 0) {
        throw new Error("At least one relay is required")
      }

      const secret = url.searchParams.get("secret")
      if (!secret) {
        throw new Error("Secret is required for nostrconnect:// URLs")
      }

      const result: NostrConnectUrl = {
        type: "nostrconnect" as const,
        clientPubkey: clientPubkey.toLowerCase() as PublicKey,
        relays,
        secret,
      }
      const nameValue = url.searchParams.get("name")
      const urlValue = url.searchParams.get("url")
      const imageValue = url.searchParams.get("image")
      const permsValue = url.searchParams.get("perms")
      if (nameValue) (result as { name: string }).name = nameValue
      if (urlValue) (result as { url: string }).url = urlValue
      if (imageValue) (result as { image: string }).image = imageValue
      if (permsValue) (result as { perms: string }).perms = permsValue
      return result
    },
    catch: (error) =>
      new Nip46ParseError({
        message: error instanceof Error ? error.message : "Failed to parse nostrconnect URL",
        input,
      }),
  })

/**
 * Parse either a bunker:// or nostrconnect:// URL
 */
export const parseNip46Url = (
  input: string
): Effect.Effect<Nip46Url, Nip46ParseError> => {
  if (input.startsWith("bunker://")) {
    return parseBunkerUrl(input)
  } else if (input.startsWith("nostrconnect://")) {
    return parseNostrConnectUrl(input)
  } else {
    return Effect.fail(
      new Nip46ParseError({
        message: "URL must start with bunker:// or nostrconnect://",
        input,
      })
    )
  }
}

/**
 * Create a bunker:// URL string
 */
export const createBunkerUrl = (
  remoteSignerPubkey: PublicKey,
  relays: readonly string[],
  secret?: string
): string => {
  const params = new URLSearchParams()
  for (const relay of relays) {
    params.append("relay", relay)
  }
  if (secret) {
    params.set("secret", secret)
  }
  return `bunker://${remoteSignerPubkey}?${params.toString()}`
}

/**
 * Create a nostrconnect:// URL string
 */
export const createNostrConnectUrl = (options: {
  clientPubkey: PublicKey
  relays: readonly string[]
  secret: string
  name?: string
  url?: string
  image?: string
  perms?: string
}): string => {
  const params = new URLSearchParams()
  for (const relay of options.relays) {
    params.append("relay", relay)
  }
  params.set("secret", options.secret)
  if (options.name) params.set("name", options.name)
  if (options.url) params.set("url", options.url)
  if (options.image) params.set("image", options.image)
  if (options.perms) params.set("perms", options.perms)
  return `nostrconnect://${options.clientPubkey}?${params.toString()}`
}

// =============================================================================
// Request/Response Encoding
// =============================================================================

/**
 * Generate a random request ID
 */
export const generateRequestId = (): string => {
  return bytesToHex(crypto.getRandomValues(new Uint8Array(16)))
}

/**
 * Encode a NIP-46 request to JSON string
 */
export const encodeRequest = (request: Nip46Request): string => {
  return JSON.stringify({
    id: request.id,
    method: request.method,
    params: request.params,
  })
}

/**
 * Decode a NIP-46 response from JSON string
 */
export const decodeResponse = (
  json: string
): Effect.Effect<Nip46Response, Nip46ParseError> =>
  Effect.try({
    try: () => {
      const parsed = JSON.parse(json) as Record<string, unknown>
      if (typeof parsed.id !== "string") {
        throw new Error("Invalid response: missing id")
      }
      const response: Nip46Response = {
        id: parsed.id,
      }
      if (typeof parsed.result === "string") {
        (response as { result: string }).result = parsed.result
      }
      if (typeof parsed.error === "string") {
        (response as { error: string }).error = parsed.error
      }
      return response
    },
    catch: (error) =>
      new Nip46ParseError({
        message: error instanceof Error ? error.message : "Failed to decode response",
        input: json,
      }),
  })

// =============================================================================
// Service Interface
// =============================================================================

export interface Nip46Service {
  readonly _tag: "Nip46Service"

  /**
   * Get the client's ephemeral public key
   */
  readonly clientPubkey: PublicKey

  /**
   * Get current connection state
   */
  connectionState(): Effect.Effect<Nip46ConnectionState>

  /**
   * Connect to a remote signer using a bunker:// URL
   * Returns the user's public key after successful connection
   */
  connect(
    bunkerUrl: string,
    options?: { permissions?: string }
  ): Effect.Effect<PublicKey, Nip46Error | Nip46ParseError | Nip46MethodError | CryptoError | InvalidPrivateKey | TimeoutError>

  /**
   * Disconnect from the remote signer
   */
  disconnect(): Effect.Effect<void>

  /**
   * Get the user's public key from the remote signer
   */
  getPublicKey(): Effect.Effect<PublicKey, Nip46Error | Nip46MethodError | TimeoutError | CryptoError | InvalidPrivateKey>

  /**
   * Request the remote signer to sign an event
   */
  signEvent(
    event: Nip46UnsignedEvent
  ): Effect.Effect<NostrEvent, Nip46Error | Nip46MethodError | TimeoutError | CryptoError | InvalidPrivateKey>

  /**
   * Encrypt using NIP-44 (delegated to remote signer)
   */
  nip44Encrypt(
    recipientPubkey: PublicKey,
    plaintext: string
  ): Effect.Effect<string, Nip46Error | Nip46MethodError | TimeoutError | CryptoError | InvalidPrivateKey>

  /**
   * Decrypt using NIP-44 (delegated to remote signer)
   */
  nip44Decrypt(
    senderPubkey: PublicKey,
    ciphertext: string
  ): Effect.Effect<string, Nip46Error | Nip46MethodError | TimeoutError | CryptoError | InvalidPrivateKey>

  /**
   * Encrypt using NIP-04 (delegated to remote signer)
   */
  nip04Encrypt(
    recipientPubkey: PublicKey,
    plaintext: string
  ): Effect.Effect<string, Nip46Error | Nip46MethodError | TimeoutError | CryptoError | InvalidPrivateKey>

  /**
   * Decrypt using NIP-04 (delegated to remote signer)
   */
  nip04Decrypt(
    senderPubkey: PublicKey,
    ciphertext: string
  ): Effect.Effect<string, Nip46Error | Nip46MethodError | TimeoutError | CryptoError | InvalidPrivateKey>

  /**
   * Ping the remote signer
   */
  ping(): Effect.Effect<void, Nip46Error | Nip46MethodError | TimeoutError | CryptoError | InvalidPrivateKey>

  /**
   * Handle incoming NIP-46 response event
   * Call this when receiving a kind 24133 event tagged to the client
   */
  handleResponse(
    event: NostrEvent
  ): Effect.Effect<void, Nip46Error | Nip46ParseError | CryptoError>

  /**
   * Get pending auth challenges (if any)
   */
  getAuthChallenge(): Effect.Effect<Option.Option<AuthChallenge>>

  /**
   * Create a kind 24133 request event ready to publish
   */
  createRequestEvent(
    method: Nip46Method,
    params: readonly string[]
  ): Effect.Effect<{ event: NostrEvent; requestId: string }, Nip46Error | CryptoError | InvalidPrivateKey>
}

// =============================================================================
// Service Tag
// =============================================================================

export const Nip46Service = Context.GenericTag<Nip46Service>("Nip46Service")

// =============================================================================
// Service Implementation
// =============================================================================

const make = Effect.gen(function* () {
  const crypto = yield* CryptoService
  const nip44 = yield* Nip44Service

  // Generate ephemeral client keypair
  const clientPrivateKey = yield* crypto.generatePrivateKey()
  const clientPubkey = yield* crypto.getPublicKey(clientPrivateKey)

  // State
  let state: Nip46ConnectionState = "disconnected"
  let remoteSignerPubkey: PublicKey | null = null
  let userPubkey: PublicKey | null = null
  let conversationKey: ConversationKey | null = null
  let secret: string | undefined
  let authChallenge: AuthChallenge | null = null
  const pendingRequests = new Map<string, PendingRequest>()

  // Timeout for requests (30 seconds)
  const REQUEST_TIMEOUT_MS = 30000

  /**
   * Send a request to the remote signer
   */
  const sendRequest = (
    method: Nip46Method,
    params: readonly string[]
  ): Effect.Effect<Nip46Response, Nip46Error | TimeoutError | CryptoError | InvalidPrivateKey> =>
    Effect.gen(function* () {
      if (state !== "connected" || !remoteSignerPubkey || !conversationKey) {
        return yield* Effect.fail(
          new Nip46Error({ message: "Not connected to remote signer" })
        )
      }

      const requestId = generateRequestId()
      const request: Nip46Request = {
        id: requestId,
        method,
        params,
      }

      // Encrypt the request
      const plaintext = encodeRequest(request)
      const encrypted = yield* nip44.encrypt(plaintext, conversationKey)

      // Create the event
      const eventContent = encrypted
      const eventTags = [["p", remoteSignerPubkey]]
      const createdAt = Math.floor(Date.now() / 1000)

      // Hash for event ID
      const serialized = JSON.stringify([
        0,
        clientPubkey,
        createdAt,
        NIP46_KIND,
        eventTags,
        eventContent,
      ])
      const eventId = yield* crypto.hash(serialized)

      // Sign the event
      const signature = yield* crypto.sign(eventId, clientPrivateKey)

      // Note: In a real implementation, this event would be published to relays
      // For now, we just create it and wait for the response
      const _requestEvent: NostrEvent = Schema.decodeUnknownSync(NostrEventSchema)({
        id: eventId,
        pubkey: clientPubkey,
        created_at: createdAt,
        kind: NIP46_KIND as number,
        tags: eventTags,
        content: eventContent,
        sig: signature,
      })
      void _requestEvent // Suppress unused warning - event needs to be published externally

      // Create deferred for response
      const deferred = yield* Deferred.make<Nip46Response, TimeoutError>()

      // Set up timeout
      const timeoutId = setTimeout(() => {
        pendingRequests.delete(requestId)
        Effect.runSync(
          Deferred.fail(
            deferred,
            new TimeoutError({
              message: `Request ${method} timed out`,
              durationMs: REQUEST_TIMEOUT_MS,
            })
          )
        )
      }, REQUEST_TIMEOUT_MS)

      pendingRequests.set(requestId, { deferred, timeoutId })

      // The caller needs to actually publish this event to relays
      // For now, we'll store it and wait for the response
      // In a real implementation, this would integrate with RelayService

      // Wait for response
      const response = yield* Deferred.await(deferred)

      // Check for auth challenge
      if (response.result === "auth_url" && response.error) {
        authChallenge = {
          requestId,
          authUrl: response.error,
        }
        return yield* Effect.fail(
          new Nip46Error({
            message: `Auth required: ${response.error}`,
          })
        )
      }

      return response
    })

  /**
   * Handle a response by request ID
   */
  const handleResponseById = (
    requestId: string,
    response: Nip46Response
  ): Effect.Effect<void> =>
    Effect.sync(() => {
      const pending = pendingRequests.get(requestId)
      if (pending) {
        clearTimeout(pending.timeoutId)
        pendingRequests.delete(requestId)
        Effect.runSync(Deferred.succeed(pending.deferred, response))
      }
    })

  const service: Nip46Service = {
    _tag: "Nip46Service",
    clientPubkey,

    connectionState: () => Effect.sync(() => state),

    connect: (bunkerUrl, options) =>
      Effect.gen(function* () {
        const parsed = yield* parseBunkerUrl(bunkerUrl)

        state = "connecting"
        remoteSignerPubkey = parsed.remoteSignerPubkey
        secret = parsed.secret

        // Derive conversation key
        conversationKey = yield* nip44.getConversationKey(
          clientPrivateKey,
          remoteSignerPubkey
        )

        // Build connect params
        const connectParams: string[] = [remoteSignerPubkey]
        if (secret) connectParams.push(secret)
        if (options?.permissions) connectParams.push(options.permissions)

        // Send connect request
        const response = yield* sendRequest("connect", connectParams)

        if (response.error) {
          state = "disconnected"
          return yield* Effect.fail(
            new Nip46Error({ message: `Connect failed: ${response.error}` })
          )
        }

        // Verify secret if provided
        if (secret && response.result !== "ack" && response.result !== secret) {
          state = "disconnected"
          return yield* Effect.fail(
            new Nip46Error({ message: "Invalid secret in connect response" })
          )
        }

        state = "connected"

        // Get the user's public key
        userPubkey = yield* service.getPublicKey()

        return userPubkey
      }),

    disconnect: () =>
      Effect.sync(() => {
        state = "disconnected"
        remoteSignerPubkey = null
        userPubkey = null
        conversationKey = null
        secret = undefined
        authChallenge = null

        // Cancel all pending requests
        for (const [, pending] of pendingRequests) {
          clearTimeout(pending.timeoutId)
        }
        pendingRequests.clear()
      }),

    getPublicKey: () =>
      Effect.gen(function* () {
        const response = yield* sendRequest("get_public_key", [])

        if (response.error) {
          return yield* Effect.fail(
            new Nip46MethodError({
              message: response.error,
              method: "get_public_key",
            })
          )
        }

        const pubkey = response.result
        if (!pubkey || !/^[0-9a-f]{64}$/i.test(pubkey)) {
          return yield* Effect.fail(
            new Nip46MethodError({
              message: "Invalid public key in response",
              method: "get_public_key",
            })
          )
        }

        return pubkey.toLowerCase() as PublicKey
      }),

    signEvent: (event) =>
      Effect.gen(function* () {
        const eventJson = JSON.stringify({
          kind: event.kind,
          content: event.content,
          tags: event.tags,
          created_at: event.created_at,
        })

        const response = yield* sendRequest("sign_event", [eventJson])

        if (response.error) {
          return yield* Effect.fail(
            new Nip46MethodError({
              message: response.error,
              method: "sign_event",
            })
          )
        }

        if (!response.result) {
          return yield* Effect.fail(
            new Nip46MethodError({
              message: "No signed event in response",
              method: "sign_event",
            })
          )
        }

        try {
          const signedEvent = JSON.parse(response.result)
          return Schema.decodeUnknownSync(NostrEventSchema)(signedEvent)
        } catch (e) {
          return yield* Effect.fail(
            new Nip46MethodError({
              message: `Failed to parse signed event: ${e}`,
              method: "sign_event",
            })
          )
        }
      }),

    nip44Encrypt: (recipientPubkey, plaintext) =>
      Effect.gen(function* () {
        const response = yield* sendRequest("nip44_encrypt", [
          recipientPubkey,
          plaintext,
        ])

        if (response.error) {
          return yield* Effect.fail(
            new Nip46MethodError({
              message: response.error,
              method: "nip44_encrypt",
            })
          )
        }

        if (!response.result) {
          return yield* Effect.fail(
            new Nip46MethodError({
              message: "No ciphertext in response",
              method: "nip44_encrypt",
            })
          )
        }

        return response.result
      }),

    nip44Decrypt: (senderPubkey, ciphertext) =>
      Effect.gen(function* () {
        const response = yield* sendRequest("nip44_decrypt", [
          senderPubkey,
          ciphertext,
        ])

        if (response.error) {
          return yield* Effect.fail(
            new Nip46MethodError({
              message: response.error,
              method: "nip44_decrypt",
            })
          )
        }

        if (!response.result) {
          return yield* Effect.fail(
            new Nip46MethodError({
              message: "No plaintext in response",
              method: "nip44_decrypt",
            })
          )
        }

        return response.result
      }),

    nip04Encrypt: (recipientPubkey, plaintext) =>
      Effect.gen(function* () {
        const response = yield* sendRequest("nip04_encrypt", [
          recipientPubkey,
          plaintext,
        ])

        if (response.error) {
          return yield* Effect.fail(
            new Nip46MethodError({
              message: response.error,
              method: "nip04_encrypt",
            })
          )
        }

        if (!response.result) {
          return yield* Effect.fail(
            new Nip46MethodError({
              message: "No ciphertext in response",
              method: "nip04_encrypt",
            })
          )
        }

        return response.result
      }),

    nip04Decrypt: (senderPubkey, ciphertext) =>
      Effect.gen(function* () {
        const response = yield* sendRequest("nip04_decrypt", [
          senderPubkey,
          ciphertext,
        ])

        if (response.error) {
          return yield* Effect.fail(
            new Nip46MethodError({
              message: response.error,
              method: "nip04_decrypt",
            })
          )
        }

        if (!response.result) {
          return yield* Effect.fail(
            new Nip46MethodError({
              message: "No plaintext in response",
              method: "nip04_decrypt",
            })
          )
        }

        return response.result
      }),

    ping: () =>
      Effect.gen(function* () {
        const response = yield* sendRequest("ping", [])

        if (response.error) {
          return yield* Effect.fail(
            new Nip46MethodError({
              message: response.error,
              method: "ping",
            })
          )
        }

        if (response.result !== "pong") {
          return yield* Effect.fail(
            new Nip46MethodError({
              message: `Expected 'pong', got '${response.result}'`,
              method: "ping",
            })
          )
        }
      }),

    handleResponse: (event) =>
      Effect.gen(function* () {
        if (event.kind !== (NIP46_KIND as number)) {
          return
        }

        // Check if event is tagged to our client pubkey
        const pTag = event.tags.find((t) => t[0] === "p" && t[1] === clientPubkey)
        if (!pTag) {
          return
        }

        if (!conversationKey) {
          return yield* Effect.fail(
            new Nip46Error({ message: "No conversation key established" })
          )
        }

        // Decrypt the content
        const plaintext = yield* nip44.decrypt(
          event.content as EncryptedPayload,
          conversationKey
        )

        // Parse the response
        const response = yield* decodeResponse(plaintext)

        // Handle the response
        yield* handleResponseById(response.id, response)
      }),

    getAuthChallenge: () =>
      Effect.sync(() =>
        authChallenge ? Option.some(authChallenge) : Option.none()
      ),

    createRequestEvent: (method, params) =>
      Effect.gen(function* () {
        if (!remoteSignerPubkey || !conversationKey) {
          return yield* Effect.fail(
            new Nip46Error({ message: "Not connected to remote signer" })
          )
        }

        const requestId = generateRequestId()
        const request: Nip46Request = {
          id: requestId,
          method,
          params,
        }

        // Encrypt the request
        const plaintext = encodeRequest(request)
        const encrypted = yield* nip44.encrypt(plaintext, conversationKey)

        // Create the event
        const eventTags = [["p", remoteSignerPubkey]]
        const createdAt = Math.floor(Date.now() / 1000)

        // Hash for event ID
        const serialized = JSON.stringify([
          0,
          clientPubkey,
          createdAt,
          NIP46_KIND,
          eventTags,
          encrypted,
        ])
        const eventId = yield* crypto.hash(serialized)

        // Sign the event
        const signature = yield* crypto.sign(eventId, clientPrivateKey)

        const event: NostrEvent = Schema.decodeUnknownSync(NostrEventSchema)({
          id: eventId,
          pubkey: clientPubkey,
          created_at: createdAt,
          kind: NIP46_KIND as number,
          tags: eventTags,
          content: encrypted,
          sig: signature,
        })

        return { event, requestId }
      }),
  }

  return service
})

// =============================================================================
// Service Layer
// =============================================================================

export const Nip46ServiceLive = Layer.effect(
  Nip46Service,
  make
)

export const Nip46ServiceLayer = Nip46ServiceLive
