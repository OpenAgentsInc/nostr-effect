# nostr-effect Public API Design

## Overview

nostr-effect provides a **dual API**:

1. **Promise API** - nostr-tools-compatible, no Effect knowledge required
2. **Effect API** - Full Effect-based services for advanced use cases

Both APIs work on **Bun and Cloudflare Workers** (Tier 1 support).

---

## Design Principles

- **No Effect knowledge required** for Promise API users
- **nostr-tools drop-in compatible** for easy migration
- **Effect available** for advanced composition and error handling
- **Tree-shakeable** - bundle only what you import
- **Client-focused** - relay code is a separate export

---

## Target Runtimes

| Runtime | Support Level | Notes |
|---------|---------------|-------|
| Bun | Tier 1 (full) | Primary development target |
| Cloudflare Workers | Tier 1 (full) | Native WebSocket, Durable Objects |
| Modern Browsers | Tier 2 (should work) | Standard WebSocket API |
| Deno | Tier 2 (should work) | Standard WebSocket API |
| Node.js 18+ | Tier 3 (best effort) | May need `setWebSocket(ws)` |

---

## Package Exports

### Promise API (No Effect Required)

```typescript
// Core functions
import {
  generateSecretKey,   // () => Uint8Array
  getPublicKey,        // (sk: Uint8Array) => string (hex)
  finalizeEvent,       // (template, sk) => SignedEvent
  verifyEvent          // (event) => boolean
} from 'nostr-effect/pure'

// Multi-relay pool
import { SimplePool } from 'nostr-effect/pool'

// NIP modules
import * as nip05 from 'nostr-effect/nip05'
import * as nip06 from 'nostr-effect/nip06'
import * as nip10 from 'nostr-effect/nip10'
import * as nip13 from 'nostr-effect/nip13'
import * as nip17 from 'nostr-effect/nip17'
import * as nip18 from 'nostr-effect/nip18'
import * as nip19 from 'nostr-effect/nip19'
import * as nip21 from 'nostr-effect/nip21'
import * as nip25 from 'nostr-effect/nip25'
import * as nip27 from 'nostr-effect/nip27'
import * as nip46 from 'nostr-effect/nip46'
```

### Effect API (Advanced)

```typescript
// Client services
import {
  RelayPool, makeRelayPool,
  RelayService, makeRelayServiceScoped,
  Nip17Service, Nip17ServiceLive,
  Nip46Service, Nip46ServiceLive,
  MintDiscoverabilityService, MintDiscoverabilityServiceLive,
  AppDataService, AppDataServiceLive,
  RelayDiscoveryService, RelayDiscoveryServiceLive,
  Nip23Service, Nip23ServiceLive,
  // ... all services
} from 'nostr-effect/client'

// Core services
import {
  CryptoService, CryptoServiceLive,
  EventService, EventServiceLive,
} from 'nostr-effect/services'

// Types and schemas
import {
  EventKind, Filter, NostrEvent,
  PublicKey, PrivateKey,
} from 'nostr-effect/core'
```

### Relay (Separate)

```typescript
import { RelayServer, EventStore } from 'nostr-effect/relay'
```

---

## API Reference

### `nostr-effect/pure`

```typescript
// Generate 32-byte secret key
function generateSecretKey(): Uint8Array

// Derive public key (hex string) from secret key
function getPublicKey(secretKey: Uint8Array): string

// Sign event template, returns complete signed event
function finalizeEvent(template: EventTemplate, secretKey: Uint8Array): NostrEvent

// Verify event signature
function verifyEvent(event: NostrEvent): boolean
```

### `nostr-effect/pool`

```typescript
class SimplePool {
  constructor(options?: SimplePoolOptions)

  // Get single event
  get(relays: string[], filter: Filter): Promise<NostrEvent | null>

  // Query multiple events
  querySync(relays: string[], filter: Filter): Promise<NostrEvent[]>

  // Subscribe with callbacks (nostr-tools style)
  subscribe(
    relays: string[],
    filters: Filter | Filter[],
    callbacks: {
      onevent?: (event: NostrEvent) => void
      oneose?: () => void
      onclose?: (reason: string) => void
    }
  ): { close: () => void }

  // Subscribe with async iterator (modern style)
  subscribeIterator(
    relays: string[],
    filters: Filter | Filter[]
  ): AsyncIterable<NostrEvent>

  // Publish to relays
  publish(relays: string[], event: NostrEvent): Promise<void>

  // Close all connections
  close(): void
}

interface SimplePoolOptions {
  enableReconnect?: boolean  // Auto-reconnect on disconnect (default: false)
  verifyEvent?: boolean      // Verify signatures (default: true)
  timeout?: number           // Default timeout in ms (default: 10000)
}
```

### `nostr-effect/nip19`

```typescript
function npubEncode(pubkey: string): string
function nsecEncode(seckey: Uint8Array): string
function noteEncode(eventId: string): string
function nprofileEncode(profile: ProfilePointer): string
function neventEncode(event: EventPointer): string
function naddrEncode(addr: AddressPointer): string

function decode(bech32: string): { type: string; data: any }
```

### `nostr-effect/nip05`

```typescript
function queryProfile(identifier: string): Promise<{
  pubkey: string
  relays?: string[]
} | null>
```

### `nostr-effect/nip17`

```typescript
function createChatMessage(
  content: string,
  recipients: string[],
  options?: { subject?: string; replyTo?: string }
): UnsignedEvent

function wrapEvent(
  event: UnsignedEvent,
  senderSk: Uint8Array,
  recipientPk: string
): NostrEvent

function unwrapEvent(
  wrapped: NostrEvent,
  recipientSk: Uint8Array
): { pubkey: string; content: string; kind: number; tags: string[][] }
```

### `nostr-effect/nip46`

```typescript
class BunkerSigner {
  static fromBunker(
    localSk: Uint8Array,
    bunkerPointer: BunkerPointer,
    options?: { pool?: SimplePool }
  ): BunkerSigner

  static fromURI(
    localSk: Uint8Array,
    nostrConnectURI: string,
    options?: { pool?: SimplePool }
  ): Promise<BunkerSigner>

  connect(): Promise<void>
  getPublicKey(): Promise<string>
  signEvent(template: EventTemplate): Promise<NostrEvent>
  close(): Promise<void>
}

function parseBunkerInput(input: string): Promise<BunkerPointer | null>
function createNostrConnectURI(options: NostrConnectOptions): string
```

---

## Design Decisions (Final)

### 1. Error Handling

**Decision**: Typed error classes that extend `Error`.

```typescript
// Defined in nostr-effect/core
export class ConnectionError extends Error {
  readonly name = 'ConnectionError'
  readonly url: string
  constructor(options: { message: string; url: string }) { ... }
}

export class SubscriptionError extends Error {
  readonly name = 'SubscriptionError'
  readonly subscriptionId: string
  constructor(options: { message: string; subscriptionId: string }) { ... }
}
```

Promise API throws these directly:
```typescript
try {
  await pool.publish(relays, event)
} catch (error) {
  if (error.name === 'ConnectionError') {
    console.error('Connection failed to:', error.url)
  }
}
```

Effect API uses them as tagged errors:
```typescript
yield* pool.publish(event).pipe(
  Effect.catchTag('ConnectionError', (err) => ...)
)
```

**Rationale**: Standard Error compatibility + type safety + machine-readable properties.

---

### 2. WebSocket / Runtime Support

**Decision**: Use standard WebSocket API. No special setup for Tier 1 runtimes.

- Bun: Native WebSocket ✓
- Cloudflare Workers: Native WebSocket ✓
- Browsers: Native WebSocket ✓
- Node.js: Provide `setWebSocket(ws)` escape hatch

```typescript
// Only needed for Node.js
import { setWebSocket } from 'nostr-effect/pool'
import WebSocket from 'ws'
setWebSocket(WebSocket)
```

**Rationale**: Standard APIs work everywhere we care about. Node.js is Tier 3.

---

### 3. SimplePool Options

**Decision**: Match nostr-tools options exactly for v0.x.

```typescript
interface SimplePoolOptions {
  enableReconnect?: boolean  // default: false
  verifyEvent?: boolean      // default: true
  timeout?: number           // default: 10000 (10s)
}
```

Future additions (v1.x):
- `enablePing` - heartbeat for connection health
- `maxConnections` - limit concurrent connections
- `batchSize` - batch publish operations

**Rationale**: Drop-in replacement priority. Extend later.

---

### 4. Subscription Patterns

**Decision**: Support BOTH patterns from day 1.

**Callbacks (nostr-tools compatible):**
```typescript
const sub = pool.subscribe(relays, { kinds: [1] }, {
  onevent(event) { console.log(event) },
  oneose() { console.log('caught up') },
  onclose(reason) { console.log('closed:', reason) }
})
sub.close()
```

**Async iterator (modern):**
```typescript
for await (const event of pool.subscribeIterator(relays, { kinds: [1] })) {
  console.log(event)
}
```

**Rationale**: Callbacks for nostr-tools compat, iterators for modern ergonomics. Both are trivial to implement from underlying Effect Stream.

---

### 5. Dependencies / Bundling

**Decision**: Effect is a regular dependency (not peer), bundled with package.

```json
{
  "dependencies": {
    "effect": "3.19.8",
    "@effect/schema": "0.75.5",
    "@noble/curves": "1.8.1",
    "@noble/hashes": "1.7.1",
    "@noble/ciphers": "1.2.1",
    "@scure/base": "1.2.4",
    "@scure/bip32": "1.6.2",
    "@scure/bip39": "1.5.4"
  }
}
```

- Promise API users: never import Effect themselves
- Effect API users: Effect is already installed via nostr-effect
- Tree-shaking: unused code eliminated by bundlers

**Rationale**: Simpler than peer deps. Promise API is zero-config.

---

### 6. Module Format

**Decision**: ESM only, ES2022 target.

```json
{
  "type": "module",
  "target": "ES2022",
  "module": "ESNext"
}
```

No CommonJS support. Works on all Tier 1/2 runtimes.

**Rationale**: Modern standards. CJS is legacy.

---

### 7. nostr-tools Compatibility

**Decision**: Match exactly for v0.x. Improvements in v1.x.

Same:
- Function names
- Function signatures
- Return types
- Option names

```typescript
// nostr-tools
import { generateSecretKey, getPublicKey } from 'nostr-tools/pure'

// nostr-effect (identical)
import { generateSecretKey, getPublicKey } from 'nostr-effect/pure'
```

**Rationale**: Migration should be find-and-replace.

---

### 8. @nostrify/types Compatibility

**Decision**: Not for v0.x. Keep branded Effect Schema types.

We use:
```typescript
type PublicKey = string & Brand<"PublicKey">
type EventKind = number & Brand<"EventKind">
```

May add @nostrify adapters in v1.x if demand exists.

**Rationale**: Adding adapters now adds complexity without clear benefit.

---

### 9. Backpressure / Resource Limits

**Decision**: Bounded queues with sensible defaults for v0.x.

- Subscription queue: 1000 events max (drop oldest)
- Dedup set: TTL of 5 minutes for long-lived subscriptions
- Configurable in SimplePoolOptions (v1.x)

**Rationale**: Prevent unbounded memory growth. Sane defaults now, tunables later.

---

### 10. Release Strategy

**Decision**:

| Version | Scope |
|---------|-------|
| v0.0.1 | Core wrappers: `pure`, `pool`, `nip19` |
| v0.1.0 | Add: `nip05`, `nip17`, `nip46` |
| v0.2.0 | Full NIP coverage, docs complete |
| v1.0.0 | Stable API, Tier 1 runtime guarantee |

Publish with:
```bash
npm publish --access public
```

---

## File Structure

```
src/
├── wrappers/                # Promise API (new)
│   ├── pure.ts              # generateSecretKey, getPublicKey, etc.
│   ├── pool.ts              # SimplePool class
│   ├── nip05.ts             # queryProfile
│   ├── nip17.ts             # createChatMessage, wrapEvent, etc.
│   ├── nip19.ts             # encode/decode
│   ├── nip46.ts             # BunkerSigner
│   └── index.ts             # Re-exports
├── client/                  # Effect services (existing)
├── core/                    # Types, schemas, errors (existing)
├── services/                # CryptoService, EventService (existing)
└── relay/                   # Relay server (existing, separate export)
```

---

## Package.json Exports

```json
{
  "name": "nostr-effect",
  "version": "0.0.1",
  "type": "module",
  "exports": {
    "./pure": "./dist/wrappers/pure.js",
    "./pool": "./dist/wrappers/pool.js",
    "./nip05": "./dist/wrappers/nip05.js",
    "./nip06": "./dist/wrappers/nip06.js",
    "./nip10": "./dist/wrappers/nip10.js",
    "./nip13": "./dist/wrappers/nip13.js",
    "./nip17": "./dist/wrappers/nip17.js",
    "./nip18": "./dist/wrappers/nip18.js",
    "./nip19": "./dist/wrappers/nip19.js",
    "./nip21": "./dist/wrappers/nip21.js",
    "./nip25": "./dist/wrappers/nip25.js",
    "./nip27": "./dist/wrappers/nip27.js",
    "./nip46": "./dist/wrappers/nip46.js",
    "./client": "./dist/client/index.js",
    "./services": "./dist/services/index.js",
    "./core": "./dist/core/index.js",
    "./relay": "./dist/relay/index.js"
  },
  "files": ["dist", "README.md", "LICENSE"]
}
```

---

## Implementation Checklist

### Phase 1: Core Wrappers (v0.0.1)
- [ ] `src/wrappers/pure.ts` - generateSecretKey, getPublicKey, finalizeEvent, verifyEvent
- [ ] `src/wrappers/pool.ts` - SimplePool with subscribe, subscribeIterator, publish, get, querySync
- [ ] `src/wrappers/nip19.ts` - All encode/decode functions
- [ ] Tests for all wrappers
- [ ] Build configuration (tsconfig, package.json exports)

### Phase 2: NIP Wrappers (v0.1.0)
- [ ] `src/wrappers/nip05.ts` - queryProfile
- [ ] `src/wrappers/nip17.ts` - createChatMessage, wrapEvent, unwrapEvent
- [ ] `src/wrappers/nip46.ts` - BunkerSigner, parseBunkerInput, createNostrConnectURI
- [ ] Additional NIP wrappers as needed
- [ ] Integration tests

### Phase 3: Polish (v0.2.0)
- [ ] All NIP wrappers complete
- [ ] PROMISE-API.md guide
- [ ] EFFECT-API.md guide
- [ ] MIGRATION.md from nostr-tools
- [ ] Example code in examples/

### Phase 4: Stable (v1.0.0)
- [ ] API freeze
- [ ] Performance optimization
- [ ] Full test coverage
- [ ] Tier 1 runtime CI testing

---

## Example: Full Client App

```typescript
import { generateSecretKey, getPublicKey, finalizeEvent } from 'nostr-effect/pure'
import { SimplePool } from 'nostr-effect/pool'
import * as nip19 from 'nostr-effect/nip19'
import * as nip17 from 'nostr-effect/nip17'

// Setup
const sk = generateSecretKey()
const pk = getPublicKey(sk)
console.log('Your npub:', nip19.npubEncode(pk))

const pool = new SimplePool({ enableReconnect: true })
const relays = ['wss://relay.damus.io', 'wss://relay.primal.net']

// Publish a note
const note = finalizeEvent({
  kind: 1,
  created_at: Math.floor(Date.now() / 1000),
  tags: [],
  content: 'Hello from nostr-effect!'
}, sk)

await pool.publish(relays, note)
console.log('Published:', nip19.noteEncode(note.id))

// Subscribe to mentions
for await (const event of pool.subscribeIterator(relays, {
  kinds: [1],
  '#p': [pk],
  since: Math.floor(Date.now() / 1000)
})) {
  console.log('Mentioned by:', event.pubkey)
  console.log('Content:', event.content)
}
```

---

## Migration from nostr-tools

```diff
- import { generateSecretKey, getPublicKey } from 'nostr-tools/pure'
- import { SimplePool } from 'nostr-tools/pool'
- import * as nip19 from 'nostr-tools/nip19'
+ import { generateSecretKey, getPublicKey } from 'nostr-effect/pure'
+ import { SimplePool } from 'nostr-effect/pool'
+ import * as nip19 from 'nostr-effect/nip19'

// All code stays the same!
```

---

## When to Use Effect API

Use the Promise API for most applications. Use the Effect API when you need:

- **Composable error handling** with typed errors
- **Resource management** (scoped connections, cleanup)
- **Concurrent operations** with structured concurrency
- **Custom service layers** (testing, mocking)
- **Building your own Nostr tools** on top of primitives

```typescript
import { Effect, Layer } from 'effect'
import { RelayPool, makeRelayPool } from 'nostr-effect/client'
import { CryptoService, CryptoServiceLive } from 'nostr-effect/services'

const program = Effect.gen(function* () {
  const pool = yield* RelayPool
  const crypto = yield* CryptoService

  yield* pool.addRelay('wss://relay.damus.io')

  const sk = yield* crypto.generatePrivateKey()
  // ... type-safe, composable operations
})

const layer = Layer.merge(makeRelayPool(), CryptoServiceLive)
await Effect.runPromise(program.pipe(Effect.provide(layer)))
```
### Selected Client Services

Below are concise examples for three client services recently added.

NIP-78: AppDataService (addressable app data via kind 30078)

```typescript
import { Effect, Layer } from 'effect'
import { AppDataService, AppDataServiceLive, RelayService, makeRelayServiceScoped } from 'nostr-effect/client'
import { CryptoService, CryptoServiceLive, EventService, EventServiceLive } from 'nostr-effect/services'

const RelayLayer = makeRelayServiceScoped({ url: 'wss://relay.example', reconnect: false })
const ServiceLayer = Layer.merge(CryptoServiceLive, EventServiceLive.pipe(Layer.provide(CryptoServiceLive)))
const LayerAll = Layer.merge(RelayLayer, AppDataServiceLive.pipe(Layer.provide(RelayLayer), Layer.provide(ServiceLayer)))

await Effect.runPromise(Effect.gen(function* () {
  const relay = yield* RelayService
  const app = yield* AppDataService
  const crypto = yield* CryptoService
  yield* relay.connect()
  const sk = yield* crypto.generatePrivateKey()
  const pk = yield* crypto.getPublicKey(sk)
  // Store JSON
  yield* app.putJSON({ key: 'settings.theme', value: { theme: 'dark' } }, sk)
  // Read back by d-tag
  const evt = yield* app.get({ pubkey: pk, key: 'settings.theme' })
  console.log('content:', evt?.content)
  yield* relay.disconnect()
}).pipe(Effect.provide(LayerAll)))
```

NIP-87: MintDiscoverabilityService (discover ecash mints)

```typescript
import { MintDiscoverabilityService, MintDiscoverabilityServiceLive } from 'nostr-effect/client'

const LayerAll2 = Layer.merge(RelayLayer, MintDiscoverabilityServiceLive.pipe(Layer.provide(RelayLayer), Layer.provide(ServiceLayer)))

await Effect.runPromise(Effect.gen(function* () {
  const relay = yield* RelayService
  const svc = yield* MintDiscoverabilityService
  const crypto = yield* CryptoService
  yield* relay.connect()
  const sk = yield* crypto.generatePrivateKey()
  // Publish a cashu mint info event (38172)
  yield* svc.publishCashuMintInfo({ d: 'mint-pubkey', url: 'https://cashu.example', nuts: [1,2], network: 'mainnet' }, sk)
  // Recommend that mint (38000)
  yield* svc.recommendMint({ kind: 38172, d: 'mint-pubkey', u: ['https://cashu.example'] }, sk)
  // Query recommendations
  const recs = yield* svc.findRecommendations({ filterByKind: 38172, limit: 2 })
  console.log('recs:', recs.length)
  yield* relay.disconnect()
}).pipe(Effect.provide(LayerAll2)))
```

NIP-66: RelayDiscoveryService (discovery & monitors)

```typescript
import { RelayDiscoveryService, RelayDiscoveryServiceLive } from 'nostr-effect/client'

const LayerAll3 = Layer.merge(RelayLayer, RelayDiscoveryServiceLive.pipe(Layer.provide(RelayLayer), Layer.provide(ServiceLayer)))

await Effect.runPromise(Effect.gen(function* () {
  const relay = yield* RelayService
  const svc = yield* RelayDiscoveryService
  const crypto = yield* CryptoService
  yield* relay.connect()
  const sk = yield* crypto.generatePrivateKey()
  // Publish discovery (30166)
  yield* svc.publishDiscovery({ relayId: 'wss://relay.example', metrics: { rtt_open: 200 }, tags: { network: 'clearnet', topics: ['nostr'] } }, sk)
  // Get latest by d-tag
  const latest = yield* svc.getLatestForRelay('wss://relay.example')
  console.log('latest kind:', latest?.kind)
  yield* relay.disconnect()
}).pipe(Effect.provide(LayerAll3)))
```
NIP-23: Nip23Service (long-form content)

```typescript
import { Nip23Service, Nip23ServiceLive } from 'nostr-effect/client'

const LayerAll4 = Layer.merge(RelayLayer, Nip23ServiceLive.pipe(Layer.provide(RelayLayer), Layer.provide(ServiceLayer)))

await Effect.runPromise(Effect.gen(function* () {
  const relay = yield* RelayService
  const svc = yield* Nip23Service
  const crypto = yield* CryptoService
  yield* relay.connect()
  const sk = yield* crypto.generatePrivateKey()
  const pk = yield* crypto.getPublicKey(sk)
  // Publish article
  yield* svc.publishArticle({ d: 'hello-world', content: '# Hello\nThis is a post', title: 'Hello' }, sk)
  // Get by d-tag
  const article = yield* svc.getArticle({ author: pk, d: 'hello-world' })
  console.log('article length:', article?.content.length)
  yield* relay.disconnect()
}).pipe(Effect.provide(LayerAll4)))
```
