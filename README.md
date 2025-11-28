# nostr-effect

A type-safe, composable Nostr library built with [Effect](https://effect.website/).

## Why Effect?

- **Typed errors** - No `catch (e: unknown)`
- **Resource safety** - WebSocket connections and subscriptions automatically cleaned up
- **Composability** - Services and layers that mix and match
- **Cross-runtime** - Works on Node, Bun, Deno, and browsers

## Implementation Status

### NIP-01: Basic Protocol
- [x] Event structure (id, pubkey, created_at, kind, tags, content, sig)
- [x] Event ID computation (SHA256 of serialized event)
- [x] Schnorr signatures (secp256k1)
- [x] Key generation and derivation
- [x] Filter schema with tag queries (#e, #p, #a, #d, #t)
- [x] Client messages (EVENT, REQ, CLOSE)
- [x] Relay messages (EVENT, OK, EOSE, CLOSED, NOTICE)
- [x] Relay server (Bun.serve WebSocket)
- [x] Event storage (SQLite via bun:sqlite)
- [x] Subscription management
- [ ] Client relay service (coming soon)
- [ ] Multi-relay pool

### Services
- [x] **CryptoService** - Key generation, signing, verification, hashing
- [x] **EventService** - Create, sign, and verify events

### Relay Services
- [x] **EventStore** - SQLite event storage with pluggable interface
- [x] **SubscriptionManager** - Track subscriptions per connection
- [x] **MessageHandler** - NIP-01 message routing
- [x] **RelayServer** - Bun.serve WebSocket server

### Coming Soon
- [ ] **RelayService** (Client) - WebSocket connections, message handling
- [ ] **PoolService** - Multi-relay coordination

### Future NIPs
- [ ] NIP-19: bech32-encoded entities (npub, nsec, note, nprofile, nevent)
- [ ] NIP-05: DNS-based verification
- [ ] NIP-44: Encrypted direct messages
- [ ] NIP-57: Zaps (Lightning payments)

## Quick Start

### Start a Relay

```typescript
import { startRelay } from "nostr-effect"

const relay = await startRelay({ port: 8080, dbPath: "./relay.db" })
console.log(`Relay running on ws://localhost:${relay.port}`)
```

### Create and Sign Events

```typescript
import { Effect } from "effect"
import { CryptoService, CryptoServiceLive, EventService, EventServiceLive } from "nostr-effect"

const program = Effect.gen(function* () {
  const crypto = yield* CryptoService
  const events = yield* EventService

  const privateKey = yield* crypto.generatePrivateKey()
  const event = yield* events.createEvent(
    { kind: 1, content: "Hello Nostr!" },
    privateKey
  )

  return event
})

const event = await Effect.runPromise(
  program.pipe(
    Effect.provide(EventServiceLive),
    Effect.provide(CryptoServiceLive)
  )
)
```

## Roadmap

Implementing NIPs across phases: encoding/identity (NIP-19, NIP-05, NIP-06), encryption (NIP-44, NIP-17), social features (profiles, reactions, follows, threading, chat), payments (zaps, wallet connect), and AI/agent support (DVMs, app handlers).
