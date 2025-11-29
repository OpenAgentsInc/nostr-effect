# nostr-effect

A type-safe Nostr library built with [Effect](https://effect.website/).

## Why

We want the entire Nostr protocol—client library and relay—implemented in fully typed Effect TypeScript. This gives us composable error handling, dependency injection via layers, and structured concurrency out of the box.

## Installation

```bash
bun add nostr-effect
# or
npm install nostr-effect
```

## What's Included

**200+ exports** covering the full Nostr protocol:

- **NIP modules**: 01, 04, 05, 06, 10, 11, 13, 16, 17, 18, 19, 21, 25, 27, 28, 30, 34, 39, 40, 42, 44, 46, 47, 49, 54, 57, 58, 59, 75, 94, 98, 99 (32 NIPs)
- **Effect Services**: CryptoService, EventService, DVMService, Nip05Service, Nip17Service, Nip25Service, Nip39Service, Nip46Service, Nip58Service, RelayService, and more
- **Branded Types**: NostrEvent, Filter, PublicKey, SecretKey, EventId, Signature, SubscriptionId, UnixTimestamp
- **NIP-19 Encoding**: encode/decode for npub, nsec, note, nprofile, nevent, naddr
- **NIP-06 Keys**: Seed word/mnemonic key derivation
- **Relay Server**: RelayServer, PolicyPipeline, NipRegistry, EventStore, SubscriptionManager
- **Typed Errors**: CryptoError, InvalidSignature, ValidationError, ConnectionError, and more

## Quick Start

### Promise API

The Promise API provides a simple interface inspired by [nostr-tools](https://github.com/nbd-wtf/nostr-tools). Under the hood, it uses the full Effect-based implementation with type-safe services and NIP modules.

> **Note:** The Promise API covers the most common functionality. Full access to all NIPs and services is available via the Effect API.

```typescript
import { generateSecretKey, getPublicKey, finalizeEvent, verifyEvent } from "nostr-effect/pure"
import { npubEncode, nsecEncode, decode } from "nostr-effect/nip19"
import { SimplePool } from "nostr-effect/pool"

// Generate keys
const sk = generateSecretKey()
const pk = getPublicKey(sk)

// Encode to bech32
const npub = npubEncode(pk)
const nsec = nsecEncode(sk)

// Create and sign an event
const event = finalizeEvent({
  kind: 1,
  created_at: Math.floor(Date.now() / 1000),
  tags: [],
  content: "Hello, Nostr!"
}, sk)

// Verify signature
console.log(verifyEvent(event)) // true

// Query relays
const pool = new SimplePool()
const events = await pool.querySync(
  ["wss://relay.damus.io", "wss://nos.lol"],
  { kinds: [1], limit: 10 }
)
pool.destroy()
```

### Effect API

```typescript
import { Effect } from "effect"
import { CryptoService, EventService } from "nostr-effect"
import * as Nip19 from "nostr-effect"

const program = Effect.gen(function* () {
  const crypto = yield* CryptoService
  const events = yield* EventService

  // Generate keypair
  const keyPair = yield* crypto.generateKeyPair()

  // Encode to npub
  const npub = Nip19.npubEncode(keyPair.publicKey)

  // Create and sign event
  const event = yield* events.createSignedEvent({
    kind: 1,
    content: "Hello from Effect!",
    tags: []
  }, keyPair.secretKey)

  return { npub, event }
})
```

## API Reference

### Promise Wrappers

#### `nostr-effect/pure`

Key generation, event signing, and verification.

```typescript
import {
  generateSecretKey,  // () => Uint8Array
  getPublicKey,       // (sk: Uint8Array) => string
  finalizeEvent,      // (template, sk) => VerifiedEvent
  verifyEvent,        // (event) => boolean
  serializeEvent,     // (event) => string
  getEventHash,       // (event) => string
  validateEvent,      // (event) => boolean
  sortEvents,         // (events) => void
} from "nostr-effect/pure"
```

#### `nostr-effect/nip19`

Bech32 encoding/decoding for Nostr identifiers.

```typescript
import {
  npubEncode,      // (pubkey: string) => NPub
  nsecEncode,      // (seckey: Uint8Array) => NSec
  noteEncode,      // (eventId: string) => Note
  nprofileEncode,  // ({ pubkey, relays? }) => NProfile
  neventEncode,    // ({ id, relays?, author?, kind? }) => NEvent
  naddrEncode,     // ({ identifier, pubkey, kind, relays? }) => NAddr
  decode,          // (bech32: string) => { type, data }
  decodeNostrURI,  // (uri: string) => { type, data }
  NostrTypeGuard,  // { isNPub, isNSec, isNote, ... }
} from "nostr-effect/nip19"
```

#### `nostr-effect/pool`

SimplePool for managing relay connections.

```typescript
import { SimplePool } from "nostr-effect/pool"

const pool = new SimplePool()
pool.subscribe(relays, filters, { onevent, oneose })
pool.subscribeIterator(relays, filters)  // AsyncIterable
pool.querySync(relays, filters)          // Promise<Event[]>
pool.get(relays, filters)                // Promise<Event | null>
pool.publish(relays, event)              // Promise<string>[]
pool.destroy()
```

#### `nostr-effect/relay`

Single relay connection (simpler than SimplePool).

```typescript
import { Relay, connectRelay } from "nostr-effect/relay"

// Create and connect
const relay = new Relay('wss://relay.damus.io')
relay.on('connect', () => console.log('Connected!'))
relay.on('error', (err) => console.error(err))
await relay.connect()

// Or use convenience function
const relay = await connectRelay('wss://relay.damus.io')

// Subscribe to events
const sub = relay.subscribe([{ kinds: [1], limit: 10 }], {
  onevent: (event) => console.log(event),
  oneose: () => console.log('End of stored events'),
})

// Publish an event
await relay.publish(signedEvent)

// Clean up
sub.close()
relay.close()
```

#### `nostr-effect/nip04`

Legacy encrypted DMs (NIP-04).

```typescript
import { encrypt, decrypt } from "nostr-effect/nip04"

// Encrypt a message (uses shared secret from sender's privkey + receiver's pubkey)
const ciphertext = await encrypt(senderSecretKey, receiverPubkey, "Hello!")

// Decrypt a message
const plaintext = await decrypt(receiverSecretKey, senderPubkey, ciphertext)
```

#### `nostr-effect/nip05`

DNS-based identity verification (NIP-05).

```typescript
import { queryProfile, isValid, searchDomain, NIP05_REGEX } from "nostr-effect/nip05"

// Look up a user's profile
const profile = await queryProfile('bob@example.com')
if (profile) {
  console.log('Pubkey:', profile.pubkey)
  console.log('Relays:', profile.relays)
}

// Verify an identifier matches a pubkey
const valid = await isValid(pubkey, 'bob@example.com')

// Search for users on a domain
const users = await searchDomain('example.com', 'bob')
```

#### `nostr-effect/kinds`

Event kind constants for all NIPs.

```typescript
import { kinds } from "nostr-effect/kinds"

// Use kind constants
const event = { kind: kinds.ShortTextNote, ... }  // kind 1

// Check if event is a reaction
if (event.kind === kinds.Reaction) { ... }

// Helper functions
kinds.isReplaceable(kind)              // kind 0, 3, or 10000-19999
kinds.isEphemeral(kind)                // kind 20000-29999
kinds.isParameterizedReplaceable(kind) // kind 30000-39999
kinds.getDVMResultKind(requestKind)    // 5xxx -> 6xxx
```

#### `nostr-effect/utils`

Helper utilities for working with events.

```typescript
import {
  matchFilter, matchFilters,           // Check if event matches filter(s)
  sortEvents, sortEventsAsc,           // Sort events by timestamp
  normalizeURL,                        // Normalize relay URLs
  getTagValue, getTagValues, getTags,  // Extract tags from events
  deduplicateEvents,                   // Remove duplicate events by ID
  getLatestReplaceable,                // Get latest version of replaceable events
  now, timestampToDate, dateToTimestamp, // Timestamp helpers
} from "nostr-effect/utils"

// Check if an event matches a filter
const matches = matchFilter({ kinds: [1], authors: [pubkey] }, event)

// Sort events newest first
const sorted = sortEvents(events)

// Get tag values
const referencedPubkeys = getTagValues(event, "p")
```

### Effect Services

#### `nostr-effect` (main)

```typescript
import {
  // Services
  CryptoService,    // Key generation, signing, encryption
  EventService,     // Event creation and validation

  // Core types and schemas
  NostrEvent,       // Event schema
  Filter,           // Filter schema
  PublicKey,        // Branded type
  SecretKey,        // Branded type
  EventId,          // Branded type
  Signature,        // Branded type

  // NIP modules (namespaced)
  Nip04,            // Legacy encrypted DMs
  Nip06,            // Key derivation from mnemonic
  Nip11,            // Relay information
  Nip13,            // Proof of Work
  Nip17,            // Private direct messages
  Nip19,            // bech32 encoding (Effect version)
  Nip21,            // nostr: URI scheme
  Nip27,            // Content parsing
  Nip30,            // Custom emoji
  Nip34,            // Git collaboration
  Nip40,            // Expiration timestamp
  Nip42,            // Client authentication
  Nip47,            // Nostr Wallet Connect
  Nip49,            // Encrypted private keys
  Nip54,            // Wiki
  Nip59,            // Gift wrap
  Nip75,            // Zap goals
  Nip94,            // File metadata
  Nip98,            // HTTP auth
  Nip99,            // Classified listings
} from "nostr-effect"
```

#### `nostr-effect/services`

```typescript
import {
  CryptoService,    // Key generation, schnorr signing
  EventService,     // Event creation and validation
  Nip44Service,     // NIP-44 encryption
} from "nostr-effect/services"
```

#### `nostr-effect/client`

```typescript
import {
  Nip17Service,     // Private direct messages
  // ... other client services
} from "nostr-effect/client"
```

#### `nostr-effect/relay-server`

```typescript
import {
  // Relay server implementation
  RelayServer, PolicyPipeline, NipRegistry, EventStore, SubscriptionManager
} from "nostr-effect/relay-server"
```

## NIP Support

| NIP | Description |
|-----|-------------|
| [01](https://github.com/nostr-protocol/nips/blob/master/01.md) | Basic protocol flow |
| [02](https://github.com/nostr-protocol/nips/blob/master/02.md) | Follow list |
| [04](https://github.com/nostr-protocol/nips/blob/master/04.md) | Legacy encrypted DMs |
| [05](https://github.com/nostr-protocol/nips/blob/master/05.md) | DNS-based identifiers |
| [06](https://github.com/nostr-protocol/nips/blob/master/06.md) | Key derivation from mnemonic |
| [10](https://github.com/nostr-protocol/nips/blob/master/10.md) | Reply threading |
| [11](https://github.com/nostr-protocol/nips/blob/master/11.md) | Relay information |
| [13](https://github.com/nostr-protocol/nips/blob/master/13.md) | Proof of Work |
| [16](https://github.com/nostr-protocol/nips/blob/master/16.md) | Event treatment |
| [17](https://github.com/nostr-protocol/nips/blob/master/17.md) | Private direct messages |
| [18](https://github.com/nostr-protocol/nips/blob/master/18.md) | Reposts |
| [19](https://github.com/nostr-protocol/nips/blob/master/19.md) | bech32 encoding |
| [21](https://github.com/nostr-protocol/nips/blob/master/21.md) | nostr: URI scheme |
| [25](https://github.com/nostr-protocol/nips/blob/master/25.md) | Reactions |
| [27](https://github.com/nostr-protocol/nips/blob/master/27.md) | Content parsing |
| [28](https://github.com/nostr-protocol/nips/blob/master/28.md) | Public chat |
| [29](https://github.com/nostr-protocol/nips/blob/master/29.md) | Relay-based groups |
| [30](https://github.com/nostr-protocol/nips/blob/master/30.md) | Custom emoji |
| [33](https://github.com/nostr-protocol/nips/blob/master/33.md) | Parameterized replaceable events |
| [34](https://github.com/nostr-protocol/nips/blob/master/34.md) | Git collaboration |
| [39](https://github.com/nostr-protocol/nips/blob/master/39.md) | External identities |
| [40](https://github.com/nostr-protocol/nips/blob/master/40.md) | Expiration timestamp |
| [42](https://github.com/nostr-protocol/nips/blob/master/42.md) | Client authentication |
| [44](https://github.com/nostr-protocol/nips/blob/master/44.md) | Versioned encryption |
| [46](https://github.com/nostr-protocol/nips/blob/master/46.md) | Nostr Connect |
| [47](https://github.com/nostr-protocol/nips/blob/master/47.md) | Nostr Wallet Connect |
| [49](https://github.com/nostr-protocol/nips/blob/master/49.md) | Encrypted private keys |
| [65](https://github.com/nostr-protocol/nips/blob/master/65.md) | Relay list metadata |
| [54](https://github.com/nostr-protocol/nips/blob/master/54.md) | Wiki |
| [57](https://github.com/nostr-protocol/nips/blob/master/57.md) | Lightning zaps |
| [58](https://github.com/nostr-protocol/nips/blob/master/58.md) | Badges |
| [59](https://github.com/nostr-protocol/nips/blob/master/59.md) | Gift wrap |
| [87](https://github.com/nostr-protocol/nips/blob/master/87.md) | Ecash mint discoverability |
| [89](https://github.com/nostr-protocol/nips/blob/master/89.md) | Recommended application handlers |
| [90](https://github.com/nostr-protocol/nips/blob/master/90.md) | Data vending machine |
| [75](https://github.com/nostr-protocol/nips/blob/master/75.md) | Zap goals |
| [94](https://github.com/nostr-protocol/nips/blob/master/94.md) | File metadata |
| [98](https://github.com/nostr-protocol/nips/blob/master/98.md) | HTTP auth |
| [99](https://github.com/nostr-protocol/nips/blob/master/99.md) | Classified listings |

## License

CC0-1.0
