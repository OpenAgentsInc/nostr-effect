// Public TypeScript types for bare `nostr-effect` imports.
// Explicitly re-export core branded types to ensure stable availability.

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
  SubscriptionId,
} from "./core/Schema";
export * from "./core/Errors";
export * from "./core/Nip19";
export * from "./core/Nip06";

// Note: Server/Relay-specific modules are intentionally not re-exported
// here to keep the root type surface environment-agnostic for consumers.
// Import those via subpaths (e.g., 'nostr-effect/relay').
