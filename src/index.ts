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

// NIP modules with namespaces to avoid conflicts
export * as Nip13 from "./core/Nip13.js"
export * as Nip21 from "./core/Nip21.js"
export * as Nip27 from "./core/Nip27.js"
export * as Nip30 from "./core/Nip30.js"
export * as Nip59 from "./core/Nip59.js"

// Services
export * from "./services/CryptoService.js"
export * from "./services/EventService.js"

// Client
export * from "./client/index.js"

// Relay
export * from "./relay/index.js"
