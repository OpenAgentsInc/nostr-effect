# nostr-effect Public API Design

## Overview

nostr-effect provides a **dual API** to serve both casual Nostr developers and advanced Effect users:

1. **Promise API** - Simple, nostr-tools-compatible interface (no Effect knowledge required)
2. **Effect API** - Full Effect-based services for advanced use cases

## Design Principles

- **No Effect required for basic use** - Promise API works without installing Effect
- **Effect optional for advanced use** - Effect API available when you need it
- **nostr-tools compatibility** - Promise API matches nostr-tools patterns
- **Tree-shakeable** - Only bundle what you use
- **Client-focused** - Relay code is separate, optional export

---

## Package Exports

### Promise API (No Effect Knowledge Required)

```typescript
// Core functions
import {
  generateSecretKey,   // Uint8Array
  getPublicKey,        // hex string
  finalizeEvent,       // sign event
  verifyEvent          // verify signature
} from 'nostr-effect/pure'

// Multi-relay pool
import { SimplePool } from 'nostr-effect/pool'

// NIP modules (namespaced)
import * as nip05 from 'nostr-effect/nip05'  // DNS verification
import * as nip06 from 'nostr-effect/nip06'  // Key derivation
import * as nip10 from 'nostr-effect/nip10'  // Thread parsing
import * as nip13 from 'nostr-effect/nip13'  // Proof of Work
import * as nip17 from 'nostr-effect/nip17'  // Private DMs
import * as nip18 from 'nostr-effect/nip18'  // Reposts
import * as nip19 from 'nostr-effect/nip19'  // bech32 encoding
import * as nip21 from 'nostr-effect/nip21'  // nostr: URIs
import * as nip25 from 'nostr-effect/nip25'  // Reactions
import * as nip27 from 'nostr-effect/nip27'  // Content parsing
import * as nip46 from 'nostr-effect/nip46'  // Remote signing (Bunker)
```

### Effect API (Advanced)

```typescript
// Client services (Effect-based)
import {
  RelayPool,           // Multi-relay orchestration
  RelayService,        // Single relay connection
  Nip17Service,        // Private DMs
  Nip46Service,        // Remote signing
  // ... all other client services
} from 'nostr-effect/client'

// Core Effect services
import {
  CryptoService,       // Crypto operations
  EventService,        // Event creation/verification
} from 'nostr-effect/services'

// Core types and schemas
import {
  EventKind,
  Filter,
  NostrEvent,
  PublicKey,
  PrivateKey,
  // ... all schemas
} from 'nostr-effect/core'
```

### Relay (Separate, Optional)

```typescript
// Relay server (requires Effect)
import {
  RelayServer,
  EventStore,
  // ... relay infrastructure
} from 'nostr-effect/relay'
```

---

## Usage Examples

### Promise API - Basic Client

**Publishing a note:**
```typescript
import { generateSecretKey, getPublicKey, finalizeEvent } from 'nostr-effect/pure'
import { SimplePool } from 'nostr-effect/pool'

// Generate keys
const sk = generateSecretKey()
const pk = getPublicKey(sk)

// Create pool
const pool = new SimplePool()
const relays = ['wss://relay.damus.io', 'wss://relay.primal.net']

// Create and publish event
const event = finalizeEvent({
  kind: 1,
  created_at: Math.floor(Date.now() / 1000),
  tags: [],
  content: 'Hello Nostr from nostr-effect!'
}, sk)

await pool.publish(relays, event)
console.log('Published:', event.id)
```

**Subscribing to events:**
```typescript
import { SimplePool } from 'nostr-effect/pool'

const pool = new SimplePool()
const relays = ['wss://relay.damus.io']

// Subscribe with callbacks
const sub = pool.subscribe(
  relays,
  { kinds: [1], limit: 10 },
  {
    onevent(event) {
      console.log('Event:', event.content)
    },
    oneose() {
      console.log('End of stored events')
    }
  }
)

// Close subscription later
sub.close()
```

**Querying events:**
```typescript
import { SimplePool } from 'nostr-effect/pool'

const pool = new SimplePool()
const relays = ['wss://relay.damus.io']

// Get single event
const event = await pool.get(relays, {
  ids: ['abc123...']
})

// Query multiple events (with timeout)
const events = await pool.querySync(relays, {
  kinds: [1],
  authors: [pubkey],
  limit: 20
})
```

**Using NIP modules:**
```typescript
import * as nip19 from 'nostr-effect/nip19'
import * as nip05 from 'nostr-effect/nip05'
import * as nip17 from 'nostr-effect/nip17'

// NIP-19: bech32 encoding
const npub = nip19.npubEncode(pubkey)
const { type, data } = nip19.decode(npub)

// NIP-05: DNS verification
const profile = await nip05.queryProfile('user@domain.com')
console.log(profile.pubkey, profile.relays)

// NIP-17: Private DMs
const message = nip17.createChatMessage('Secret!', [recipientPubkey])
const wrapped = nip17.wrapEvent(message, senderSk, recipientPubkey)
await pool.publish(relays, wrapped)
```

**NIP-46: Remote signing (Bunker):**
```typescript
import { BunkerSigner, parseBunkerInput } from 'nostr-effect/nip46'
import { SimplePool } from 'nostr-effect/pool'

const pool = new SimplePool()
const localSk = generateSecretKey()

// Parse bunker URL
const bunkerPointer = await parseBunkerInput('bunker://...')

// Create signer
const signer = BunkerSigner.fromBunker(localSk, bunkerPointer, { pool })
await signer.connect()

// Sign remotely
const event = await signer.signEvent({
  kind: 1,
  created_at: Math.floor(Date.now() / 1000),
  tags: [],
  content: 'Signed by bunker!'
})

await pool.publish(relays, event)
```

### Effect API - Advanced Usage

**Using Effect services directly:**
```typescript
import { Effect, Layer } from 'effect'
import {
  RelayPool,
  makeRelayPool,
  Nip17Service,
  Nip17ServiceLive
} from 'nostr-effect/client'
import {
  CryptoService,
  CryptoServiceLive,
  EventService,
  EventServiceLive
} from 'nostr-effect/services'

const program = Effect.gen(function* () {
  // Get services
  const pool = yield* RelayPool
  const crypto = yield* CryptoService
  const events = yield* EventService
  const nip17 = yield* Nip17Service

  // Add relays
  yield* pool.addRelay('wss://relay.damus.io')

  // Generate keys
  const privateKey = yield* crypto.generatePrivateKey()
  const publicKey = yield* crypto.getPublicKey(privateKey)

  // Create and publish event
  const event = yield* events.createEvent({
    kind: 1,
    content: 'Hello from Effect!'
  }, privateKey)

  yield* pool.publish(event)

  // Send private DM
  const dm = yield* nip17.createChatMessage('Secret!', [recipientPubkey])
  yield* nip17.sendEncryptedDM(dm, privateKey, [recipientPubkey])
})

// Provide layers
const layer = Layer.mergeAll(
  CryptoServiceLive,
  EventServiceLive,
  makeRelayPool(),
  Nip17ServiceLive
)

await Effect.runPromise(program.pipe(Effect.provide(layer)))
```

---

## Open Questions & Design Decisions

### 1. Error Handling

**Promise API:**
```typescript
try {
  await pool.publish(relays, event)
} catch (error) {
  console.error('Failed to publish:', error.message)
}
```

**Effect API:**
```typescript
const result = yield* pool.publish(event).pipe(
  Effect.catchTag('ConnectionError', (err) =>
    Effect.log(`Connection failed: ${err.message}`)
  )
)
```

**Question**: Should Promise API errors be:
- [ ] Simple `Error` objects with message
- [ ] Typed error classes (ConnectionError, SubscriptionError, etc.)
- [ ] Both (typed classes that extend Error)

**Recommendation**: Typed classes that extend Error for better DX

---

### 2. WebSocket Implementation (Runtime Support)

nostr-tools pattern:
```typescript
import { useWebSocketImplementation } from 'nostr-effect/pool'
import WebSocket from 'ws'
useWebSocketImplementation(WebSocket)
```

**Questions:**
- [ ] Do we need this for Node.js? (Bun has native WebSocket)
- [ ] Should we auto-detect runtime and use appropriate WS?
- [ ] Or require explicit setup like nostr-tools?

**Recommendation**: Auto-detect runtime, but allow override for edge cases

---

### 3. SimplePool Options

What options should SimplePool support?

```typescript
const pool = new SimplePool({
  enablePing?: boolean          // Heartbeat to detect disconnects
  enableReconnect?: boolean     // Auto-reconnect on disconnect
  verifyEvent?: boolean          // Verify signatures (default: true)
  timeout?: number              // Default timeout for queries
})
```

**Questions:**
- [ ] Should we match nostr-tools options exactly?
- [ ] Add additional options (batch size, max connections, etc.)?

**Recommendation**: Start with nostr-tools parity, add more as needed

---

### 4. Subscription API

nostr-tools has two patterns:

**Pattern 1: Callbacks**
```typescript
pool.subscribe(relays, filters, {
  onevent(event) { },
  oneose() { },
  onclose() { }
})
```

**Pattern 2: Async iterator** (would be nice!)
```typescript
for await (const event of pool.subscribeIterator(relays, filters)) {
  console.log(event)
}
```

**Question**: Should we support both patterns?

**Recommendation**: Start with callbacks (nostr-tools compat), add iterator later

---

### 5. Bundle Size & Dependencies

**Current dependencies (all needed):**
```json
{
  "@noble/ciphers": "1.2.1",
  "@noble/curves": "1.8.1",
  "@noble/hashes": "1.7.1",
  "@scure/base": "1.2.4",
  "@scure/bip32": "1.6.2",
  "@scure/bip39": "1.5.4"
}
```

**Effect is peer dependency:**
```json
{
  "peerDependencies": {
    "effect": "^3.0.0"
  },
  "peerDependenciesMeta": {
    "effect": {
      "optional": true  // Only needed for Effect API or relay
    }
  }
}
```

**Questions:**
- [ ] Should we bundle Effect with the package for Promise API users?
- [ ] Or always require it as peer dependency?
- [ ] Should relay be a separate package entirely?

**Recommendation**:
- Effect is bundled internally for Promise API (users don't install it)
- Effect is peer dependency for Effect API users
- Relay stays in same package but separate export

---

### 6. TypeScript Configuration

**Build targets:**
- ES2022 (modern browsers, Node 18+, Bun, Deno)
- ESM only (no CJS)
- Full type declarations

**Questions:**
- [ ] Should we support CJS for older Node versions?
- [ ] Provide separate bundles for browser vs Node?

**Recommendation**: ESM only, single bundle works everywhere

---

### 7. Testing Strategy

**Promise API tests:**
```typescript
import { test, expect } from 'bun:test'
import { generateSecretKey, finalizeEvent } from 'nostr-effect/pure'

test('generates valid key pair', () => {
  const sk = generateSecretKey()
  expect(sk).toBeInstanceOf(Uint8Array)
  expect(sk.length).toBe(32)
})
```

**Effect API tests:**
```typescript
import { Effect, Layer } from 'effect'
import { CryptoService, CryptoServiceLive } from 'nostr-effect/services'

test('CryptoService generates keys', async () => {
  const program = Effect.gen(function* () {
    const crypto = yield* CryptoService
    const sk = yield* crypto.generatePrivateKey()
    return sk
  })

  const result = await Effect.runPromise(
    program.pipe(Effect.provide(CryptoServiceLive))
  )

  expect(result.length).toBe(64) // hex string
})
```

**Question**: Should we test both APIs comprehensively?

**Recommendation**: Yes - test wrappers separately from underlying Effect services

---

### 8. Documentation Structure

```
docs/
├── API.md              # This file - API design
├── PROMISE-API.md      # Promise API guide (nostr-tools users)
├── EFFECT-API.md       # Effect API guide (Effect users)
├── MIGRATION.md        # Migrating from nostr-tools
├── RELAY.md            # Running a relay
└── examples/
    ├── basic-client.ts
    ├── private-dms.ts
    ├── remote-signing.ts
    └── effect-advanced.ts
```

---

### 9. Migration from nostr-tools

**Almost 1:1 compatible:**

```typescript
// nostr-tools
import { generateSecretKey, getPublicKey } from 'nostr-tools/pure'
import { SimplePool } from 'nostr-tools/pool'

// nostr-effect (same!)
import { generateSecretKey, getPublicKey } from 'nostr-effect/pure'
import { SimplePool } from 'nostr-effect/pool'
```

**Differences:**
- [ ] Do we match nostr-tools signatures exactly?
- [ ] Or make small improvements where it makes sense?

**Recommendation**: Match exactly for easy migration, improvements come later

---

### 10. Release Strategy

**Initial release:**
- [ ] Publish `nostr-effect@0.0.1` with Promise API
- [ ] Mark as `alpha` or `beta`?
- [ ] What needs to be complete for 0.1.0?

**Minimum viable API for 0.1.0:**
- ✅ pure (core functions)
- ✅ pool (SimplePool)
- ✅ nip19 (bech32)
- ✅ nip05 (DNS)
- ✅ nip17 (Private DMs)
- ✅ nip46 (Bunker)
- [ ] nip10, nip25, nip27 (thread parsing, reactions, content parsing)

---

## Implementation Checklist

### Phase 1: Core Wrappers
- [ ] `src/wrappers/pure.ts` - generateSecretKey, getPublicKey, finalizeEvent, verifyEvent
- [ ] `src/wrappers/pool.ts` - SimplePool class
- [ ] Tests for core wrappers

### Phase 2: NIP Wrappers
- [ ] `src/wrappers/nip19.ts` - encode/decode functions
- [ ] `src/wrappers/nip05.ts` - queryProfile
- [ ] `src/wrappers/nip17.ts` - createChatMessage, wrapEvent, etc.
- [ ] `src/wrappers/nip46.ts` - BunkerSigner class
- [ ] Tests for NIP wrappers

### Phase 3: Build Configuration
- [ ] Update `package.json` with exports
- [ ] Setup TypeScript build for dual exports
- [ ] Create type declaration files
- [ ] Bundle configuration

### Phase 4: Documentation
- [ ] PROMISE-API.md - Complete guide
- [ ] EFFECT-API.md - Effect usage
- [ ] MIGRATION.md - From nostr-tools
- [ ] Code examples

### Phase 5: Testing & Polish
- [ ] Integration tests (Promise API + real relays)
- [ ] Test in example app
- [ ] README updates
- [ ] Publish preparation

---

## Package.json (Full Configuration)

```json
{
  "name": "nostr-effect",
  "version": "0.0.1",
  "description": "A type-safe, composable Nostr library with Promise and Effect APIs",
  "type": "module",
  "main": "./dist/wrappers/pure.js",
  "types": "./dist/wrappers/pure.d.ts",
  "exports": {
    "./pure": {
      "import": "./dist/wrappers/pure.js",
      "types": "./dist/wrappers/pure.d.ts"
    },
    "./pool": {
      "import": "./dist/wrappers/pool.js",
      "types": "./dist/wrappers/pool.d.ts"
    },
    "./nip05": {
      "import": "./dist/wrappers/nip05.js",
      "types": "./dist/wrappers/nip05.d.ts"
    },
    "./nip06": {
      "import": "./dist/wrappers/nip06.js",
      "types": "./dist/wrappers/nip06.d.ts"
    },
    "./nip10": {
      "import": "./dist/wrappers/nip10.js",
      "types": "./dist/wrappers/nip10.d.ts"
    },
    "./nip13": {
      "import": "./dist/wrappers/nip13.js",
      "types": "./dist/wrappers/nip13.d.ts"
    },
    "./nip17": {
      "import": "./dist/wrappers/nip17.js",
      "types": "./dist/wrappers/nip17.d.ts"
    },
    "./nip18": {
      "import": "./dist/wrappers/nip18.js",
      "types": "./dist/wrappers/nip18.d.ts"
    },
    "./nip19": {
      "import": "./dist/wrappers/nip19.js",
      "types": "./dist/wrappers/nip19.d.ts"
    },
    "./nip21": {
      "import": "./dist/wrappers/nip21.js",
      "types": "./dist/wrappers/nip21.d.ts"
    },
    "./nip25": {
      "import": "./dist/wrappers/nip25.js",
      "types": "./dist/wrappers/nip25.d.ts"
    },
    "./nip27": {
      "import": "./dist/wrappers/nip27.js",
      "types": "./dist/wrappers/nip27.d.ts"
    },
    "./nip46": {
      "import": "./dist/wrappers/nip46.js",
      "types": "./dist/wrappers/nip46.d.ts"
    },
    "./client": {
      "import": "./dist/client/index.js",
      "types": "./dist/client/index.d.ts"
    },
    "./services": {
      "import": "./dist/services/index.js",
      "types": "./dist/services/index.d.ts"
    },
    "./core": {
      "import": "./dist/core/index.js",
      "types": "./dist/core/index.d.ts"
    },
    "./relay": {
      "import": "./dist/relay/index.js",
      "types": "./dist/relay/index.d.ts"
    }
  },
  "files": [
    "dist",
    "README.md",
    "LICENSE"
  ],
  "keywords": [
    "nostr",
    "effect",
    "typescript",
    "protocol",
    "decentralized",
    "social"
  ],
  "license": "MIT",
  "repository": {
    "type": "git",
    "url": "https://github.com/OpenAgentsInc/nostr-effect.git"
  },
  "peerDependencies": {
    "effect": "^3.0.0"
  },
  "peerDependenciesMeta": {
    "effect": {
      "optional": true
    }
  },
  "dependencies": {
    "@noble/ciphers": "1.2.1",
    "@noble/curves": "1.8.1",
    "@noble/hashes": "1.7.1",
    "@scure/base": "1.2.4",
    "@scure/bip32": "1.6.2",
    "@scure/bip39": "1.5.4"
  },
  "devDependencies": {
    "@types/bun": "^1.1.0",
    "typescript": "^5.7.0"
  },
  "scripts": {
    "build": "tsc && bun build",
    "test": "bun test",
    "prepublishOnly": "bun run build && bun test"
  }
}
```

---

## Next Steps

1. **Review this document** - Answer open questions
2. **Finalize API decisions** - Lock in the design
3. **Create implementation plan** - Break into tasks
4. **Start coding** - Begin with `pure.ts` and `pool.ts`
5. **Iterate** - Test, refine, document
