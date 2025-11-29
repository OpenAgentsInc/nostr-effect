# nostr-effect

A type-safe Nostr library built with [Effect](https://effect.website/).

## Installation

```bash
bun add nostr-effect
# or
npm install nostr-effect
```

## Quick Start

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

## API

### `nostr-effect/pure`

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
  sortEvents,         // (events) => void (in-place sort)
} from "nostr-effect/pure"
```

### `nostr-effect/nip19`

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

### `nostr-effect/pool`

SimplePool for managing relay connections.

```typescript
import { SimplePool } from "nostr-effect/pool"

const pool = new SimplePool()

// Query with callback
pool.subscribe(relays, filters, {
  onevent: (event) => console.log(event),
  oneose: () => console.log("end of stored events"),
})

// Query as async iterator
for await (const event of pool.subscribeIterator(relays, filters)) {
  console.log(event)
}

// Query all at once
const events = await pool.querySync(relays, filters)

// Get single event
const event = await pool.get(relays, filters)

// Publish
await Promise.all(pool.publish(relays, signedEvent))

// Cleanup
pool.destroy()
```

## License

CC0-1.0
