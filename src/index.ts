/**
 * nostr-effect
 *
 * A type-safe, composable Nostr library built with Effect.
 */

// Core schemas and types
export * from "./core/Schema.js"
export * from "./core/Errors.js"
export * from "./core/Nip19.js"
export * from "./core/Nip06.js"
// Explicit type re-exports for common primitives
export type {
  NostrEvent,
  UnsignedEvent,
  EventParams,
  Filter,
  EventId,
  PublicKey,
  PrivateKey,
  Signature,
  UnixTimestamp,
  EventKind,
  Tag,
} from "./core/Schema.js"

// NIP modules with namespaces to avoid conflicts
export * as Nip04 from "./core/Nip04.js"
export * as Nip11 from "./core/Nip11.js"
export * as Nip13 from "./core/Nip13.js"
export * as Nip17 from "./core/Nip17.js"
export * as Nip21 from "./core/Nip21.js"
export * as Nip27 from "./core/Nip27.js"
export * as Nip30 from "./core/Nip30.js"
export * as Nip34 from "./core/Nip34.js"
export * as Nip40 from "./core/Nip40.js"
export * as Nip42 from "./core/Nip42.js"
export * as Nip47 from "./core/Nip47.js"
export * as Nip49 from "./core/Nip49.js"
export * as Nip54 from "./core/Nip54.js"
export * as Nip59 from "./core/Nip59.js"
export * as Nip75 from "./core/Nip75.js"
export * as Nip94 from "./core/Nip94.js"
export * as Nip98 from "./core/Nip98.js"
export * as Nip99 from "./core/Nip99.js"

// Services
export * from "./services/CryptoService.js"
export * from "./services/EventService.js"

// Client
export * from "./client/index.js"

// Relay
export * from "./relay/index.js"
