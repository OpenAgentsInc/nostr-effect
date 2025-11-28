# nostr-effect

Nostr relay & client library in Effect (wip)

## Quick Start

```typescript
// Start a relay
import { startRelay } from "nostr-effect"
const relay = await startRelay({ port: 8080, dbPath: "./relay.db" })

// Create events
import { Effect } from "effect"
import { CryptoService, CryptoServiceLive, EventService, EventServiceLive } from "nostr-effect"

const event = await Effect.runPromise(
  Effect.gen(function* () {
    const crypto = yield* CryptoService
    const events = yield* EventService
    const privateKey = yield* crypto.generatePrivateKey()
    return yield* events.createEvent({ kind: 1, content: "Hello!" }, privateKey)
  }).pipe(Effect.provide(EventServiceLive), Effect.provide(CryptoServiceLive))
)
```

## Status

### Relay (NIP-01)
- [x] EventStore (SQLite via bun:sqlite)
- [x] SubscriptionManager
- [x] MessageHandler (EVENT, REQ, CLOSE → OK, EOSE)
- [x] RelayServer (Bun.serve WebSocket)
- [ ] PolicyPipeline
- [ ] NIP module system

### Client
- [x] CryptoService (keys, signing, verification)
- [x] EventService (create, verify)
- [ ] RelayService (WebSocket client)
- [ ] PoolService (multi-relay)

### Future
NIP-19, NIP-05, NIP-44, NIP-57, DVMs
