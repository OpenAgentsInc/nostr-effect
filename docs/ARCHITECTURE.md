# nostr-effect Architecture

This document provides a comprehensive technical overview of nostr-effect's architecture, runtime dependencies, and deployment considerations.

## Table of Contents

1. [Overview](#overview)
2. [Directory Structure](#directory-structure)
3. [Core Modules](#core-modules)
4. [Services Layer](#services-layer)
5. [Client Library](#client-library)
6. [Relay Implementation](#relay-implementation)
7. [Backend Abstraction](#backend-abstraction)
8. [Effect Patterns](#effect-patterns)
9. [Dependencies](#dependencies)
10. [Bun Runtime APIs](#bun-runtime-apis)
11. [Build & Configuration](#build--configuration)
12. [Deployment Targets](#deployment-targets)

---

## Overview

**nostr-effect** is a type-safe, composable Nostr protocol implementation built with [Effect TypeScript](https://effect.website/). It provides both a client library and a relay implementation, sharing core cryptographic and validation logic.

### Key Characteristics

| Aspect | Choice | Rationale |
|--------|--------|-----------|
| **Runtime** | Node 24 | pnpm + Vite Plus; matches openagents monorepo |
| **Type System** | Effect Schema + Branded Types | Compile-time safety, runtime validation |
| **Architecture** | Effect Services + Layers | Dependency injection, testability, composition |
| **Crypto** | @noble/* libraries | Audited, pure JS, no native bindings |
| **Database** | node:sqlite (dev) / Cloud SQL Postgres (prod) | Platform SQLite + Cloud SQL |
| **Protocol** | NIP-01 + extensions | Full Nostr compatibility |

### Codebase Statistics

- **~10,000 lines** of TypeScript across 38 files
- **188 tests** with comprehensive coverage
- **13 test files** covering all major components

---

## Directory Structure

```
nostr-effect/
├── src/
│   ├── core/                    # Shared types and validation
│   │   ├── Schema.ts            # NIP-01 types, branded primitives
│   │   ├── Errors.ts            # Typed error classes
│   │   └── Nip19.ts             # Bech32 encoding (npub/nsec/note/etc)
│   │
│   ├── services/                # Shared Effect services
│   │   ├── CryptoService.ts     # Schnorr signing, key derivation
│   │   ├── EventService.ts      # Event creation and verification
│   │   └── Nip44Service.ts      # NIP-44 versioned encryption
│   │
│   ├── client/                  # Client-side services
│   │   ├── RelayService.ts      # WebSocket connection management
│   │   ├── FollowListService.ts # NIP-02 follow lists
│   │   ├── RelayListService.ts  # NIP-65 relay metadata
│   │   ├── HandlerService.ts    # NIP-89 app handlers
│   │   ├── DVMService.ts        # NIP-90 Data Vending Machines
│   │   └── index.ts             # Client exports
│   │
│   ├── relay/                   # Relay implementation
│   │   ├── RelayServer.ts       # Bun.serve WebSocket server
│   │   ├── EventStore.ts        # SQLite/memory event storage
│   │   ├── FilterMatcher.ts     # Event-filter matching logic
│   │   ├── SubscriptionManager.ts # Subscription tracking
│   │   ├── MessageHandler.ts    # NIP-01 message routing
│   │   ├── RelayInfo.ts         # NIP-11 relay metadata
│   │   ├── policy/              # Event validation policies
│   │   │   ├── Policy.ts        # Policy interface & combinators
│   │   │   ├── PolicyPipeline.ts
│   │   │   └── BuiltInPolicies.ts
│   │   ├── main.ts              # Standalone relay entry point
│   │   └── index.ts             # Relay exports
│   │
│   └── index.ts                 # Main library exports
│
├── docs/
│   ├── ARCHITECTURE.md          # This document
│   └── BUILDOUT.md              # Development roadmap
│
├── package.json                 # Dependencies and scripts
├── tsconfig.json                # TypeScript configuration
└── scripts/
    └── pre-push                 # Git hook for verification
```

---

## Core Modules

### Schema.ts - Type System Foundation

The schema module defines all Nostr protocol types using Effect Schema with branded types for compile-time safety.

#### Branded Primitive Types

```typescript
// 64-char lowercase hex strings with semantic meaning
type EventId = string & Brand<"EventId">       // SHA256 hash
type PublicKey = string & Brand<"PublicKey">   // secp256k1 x-only pubkey
type PrivateKey = string & Brand<"PrivateKey"> // secp256k1 scalar
type Signature = string & Brand<"Signature">   // 128-char schnorr sig

// Numeric types with constraints
type UnixTimestamp = number & Brand<"UnixTimestamp">  // >= 0
type EventKind = number & Brand<"EventKind">          // 0-65535

// Structural types
type Tag = readonly string[] & Brand<"Tag">           // Non-empty array
type SubscriptionId = string & Brand<"SubscriptionId"> // 1-64 chars
```

#### Event Types

```typescript
interface NostrEvent {
  id: EventId
  pubkey: PublicKey
  created_at: UnixTimestamp
  kind: EventKind
  tags: readonly Tag[]
  content: string
  sig: Signature
}

interface UnsignedEvent {
  pubkey: PublicKey
  created_at: UnixTimestamp
  kind: EventKind
  tags: readonly Tag[]
  content: string
}
```

#### Filter Type

```typescript
interface Filter {
  ids?: string[]           // Event ID prefix match
  authors?: string[]       // Author pubkey prefix match
  kinds?: EventKind[]      // Exact kind match
  since?: UnixTimestamp    // Events after timestamp
  until?: UnixTimestamp    // Events before timestamp
  limit?: number           // Max events to return
  "#e"?: string[]          // e-tag values
  "#p"?: string[]          // p-tag values
  "#a"?: string[]          // a-tag values (NIP-33)
  "#d"?: string[]          // d-tag values (NIP-33)
  "#t"?: string[]          // t-tag values (hashtags)
}
```

**Filter Logic:**
- Within a filter: AND (all conditions must match)
- Between filters in an array: OR (any filter match succeeds)
- IDs and authors use prefix matching, not exact matching

#### Utility Functions

```typescript
// Kind classification (NIP-16/33)
isReplaceableKind(kind: number): boolean
  // true for: 0, 3, 10000-19999

isParameterizedReplaceableKind(kind: number): boolean
  // true for: 30000-39999

getDTagValue(event: NostrEvent): string | undefined
  // Extracts d-tag value for parameterized replaceable events
```

### Errors.ts - Typed Error Classes

All errors extend Effect Schema's `TaggedError` for serialization and pattern matching.

```typescript
// Validation Errors
class InvalidEventId extends TaggedError { message: string }
class InvalidSignature extends TaggedError { message: string }
class InvalidEventFormat extends TaggedError { message: string }
class EventValidationError extends TaggedError { message: string }

// Crypto Errors
class CryptoError extends TaggedError {
  message: string
  operation: "sign" | "verify" | "hash" | "generateKey" |
             "encrypt" | "decrypt" | "getConversationKey"
}
class InvalidPrivateKey extends TaggedError { message: string }
class InvalidPublicKey extends TaggedError { message: string }

// Encoding Errors
class EncodingError extends TaggedError { message: string }
class DecodingError extends TaggedError { message: string }

// Connection Errors
class ConnectionError extends TaggedError { message: string, url: string }
class ConnectionClosed extends TaggedError { message: string, code?: number }
class TimeoutError extends TaggedError { message: string, durationMs: number }

// Relay Errors
class RelayError extends TaggedError { message: string, relay: string }
class SubscriptionError extends TaggedError { message: string, subscriptionId: string }

// Storage Errors
class StorageError extends TaggedError {
  message: string
  operation: "insert" | "query" | "delete" | "init" | "upsert"
}
class DuplicateEvent extends TaggedError { eventId: string }
```

### Nip19.ts - Bech32 Encoding

Implements NIP-19 bech32-encoded entities for human-readable key/event representation.

#### Bare Encodings (32-byte values)

```typescript
encodeNpub(pubkey: PublicKey): Effect<string, EncodingError>
  // → "npub1..."

encodeNsec(privkey: PrivateKey): Effect<string, EncodingError>
  // → "nsec1..."

encodeNote(eventId: EventId): Effect<string, EncodingError>
  // → "note1..."
```

#### TLV Encodings (with metadata)

```typescript
encodeNprofile(data: {
  pubkey: PublicKey
  relays?: string[]
}): Effect<string, EncodingError>
  // → "nprofile1..." with relay hints

encodeNevent(data: {
  id: EventId
  relays?: string[]
  author?: PublicKey
  kind?: number
}): Effect<string, EncodingError>
  // → "nevent1..." with full context

encodeNaddr(data: {
  identifier: string
  pubkey: PublicKey
  kind: number
  relays?: string[]
}): Effect<string, EncodingError>
  // → "naddr1..." for addressable events
```

#### Universal Decoder

```typescript
decode(bech32String: string): Effect<Nip19Data, DecodingError>

type Nip19Data =
  | { type: "npub"; data: PublicKey }
  | { type: "nsec"; data: PrivateKey }
  | { type: "note"; data: EventId }
  | { type: "nprofile"; data: { pubkey: PublicKey; relays: string[] } }
  | { type: "nevent"; data: { id: EventId; relays: string[]; author?: PublicKey; kind?: number } }
  | { type: "naddr"; data: { identifier: string; pubkey: PublicKey; kind: number; relays: string[] } }
```

---

## Services Layer

Services use the Effect Context/Layer pattern for dependency injection and composition.

### Service Pattern

```typescript
// 1. Define interface
export interface MyService {
  readonly _tag: "MyService"
  doSomething(input: A): Effect<B, E>
}

// 2. Create context tag
export const MyService = Context.GenericTag<MyService>("MyService")

// 3. Implement
const make: MyService = {
  _tag: "MyService",
  doSomething: (input) => Effect.try({ ... })
}

// 4. Create layer
export const MyServiceLive = Layer.succeed(MyService, make)

// With dependencies:
export const MyServiceLive = Layer.effect(MyService,
  Effect.gen(function* () {
    const dep = yield* DependencyService
    return { _tag: "MyService", ... }
  })
)
```

### CryptoService

Provides all cryptographic operations using @noble libraries.

```typescript
interface CryptoService {
  generatePrivateKey(): Effect<PrivateKey, CryptoError>

  getPublicKey(privateKey: PrivateKey): Effect<PublicKey, CryptoError | InvalidPrivateKey>

  sign(message: string, privateKey: PrivateKey): Effect<Signature, CryptoError | InvalidPrivateKey>

  verify(sig: Signature, message: string, pubkey: PublicKey): Effect<boolean, CryptoError | InvalidPublicKey>

  hash(message: string): Effect<EventId, CryptoError>
}
```

**Implementation Details:**
- Uses `@noble/curves/secp256k1` for Schnorr signatures
- Uses `@noble/hashes/sha256` for hashing
- All operations convert between hex strings and byte arrays
- Stateless - no dependencies on other services

### EventService

Creates and verifies Nostr events according to NIP-01.

```typescript
interface EventService {
  createEvent(
    params: EventParams,
    privateKey: PrivateKey
  ): Effect<NostrEvent, CryptoError | InvalidPrivateKey>

  computeEventId(
    pubkey: PublicKey,
    created_at: UnixTimestamp,
    kind: EventKind,
    tags: readonly Tag[],
    content: string
  ): Effect<EventId, CryptoError>

  verifyEvent(event: NostrEvent): Effect<boolean, CryptoError | InvalidPublicKey>
}
```

**Event ID Computation (NIP-01):**
```typescript
sha256(JSON.stringify([
  0,           // Reserved
  pubkey,      // 64-char hex
  created_at,  // Unix timestamp
  kind,        // Integer
  tags,        // Array of arrays
  content      // String
]))
```

**Dependencies:** CryptoService

### Nip44Service

Implements NIP-44 versioned encryption for secure messaging.

```typescript
interface Nip44Service {
  getConversationKey(
    privateKey: PrivateKey,
    publicKey: PublicKey
  ): Effect<ConversationKey, CryptoError>

  encrypt(
    plaintext: string,
    conversationKey: ConversationKey
  ): Effect<EncryptedPayload, CryptoError>

  decrypt(
    payload: EncryptedPayload,
    conversationKey: ConversationKey
  ): Effect<string, CryptoError>
}
```

**Cryptographic Stack:**

1. **ECDH**: secp256k1 shared secret derivation
   - Converts x-only schnorr pubkeys to full curve points
   - Extracts x-coordinate of shared point

2. **HKDF-Extract**: Conversation key derivation
   - Salt: `"nip44-v2"` (UTF-8)
   - IKM: Shared x-coordinate
   - Output: 32-byte conversation key

3. **HKDF-Expand**: Per-message key derivation
   - PRK: Conversation key
   - Info: 32-byte random nonce
   - Output: 76 bytes → ChaCha key (32) + nonce (12) + HMAC key (32)

4. **Padding**: NIP-44 v2 scheme
   - Power-of-2 based with minimum 32 bytes
   - Length prefix (2 bytes, big-endian)

5. **ChaCha20**: Symmetric encryption
   - Key and nonce from HKDF-Expand

6. **HMAC-SHA256**: Authentication
   - AAD: nonce prepended to ciphertext

**Payload Format:**
```
[version:1][nonce:32][ciphertext:variable][mac:32] → base64
```

**Dependencies:** None (uses @noble libraries directly)

---

## Client Library

Client services interact with Nostr relays via WebSocket.

### RelayService

Single relay WebSocket connection with automatic reconnection.

```typescript
interface RelayService {
  readonly url: string

  connectionState(): Effect<ConnectionState>
  // "disconnected" | "connecting" | "connected"

  connect(): Effect<void, ConnectionError>

  disconnect(): Effect<void>

  publish(event: NostrEvent): Effect<PublishResult, ConnectionError | TimeoutError>
  // PublishResult: { accepted: boolean, message?: string }

  subscribe(filters: Filter[]): Effect<SubscriptionHandle, ConnectionError>
}

interface SubscriptionHandle {
  id: SubscriptionId
  events: Stream<NostrEvent, SubscriptionError>
  unsubscribe: () => Effect<void>
}
```

**Features:**
- Automatic reconnection with exponential backoff
- Queue-based event streaming via Effect Stream
- EOSE (End of Stored Events) handling
- OK message parsing for publish confirmation
- Connection state machine

**Factory Function:**
```typescript
makeRelayService(config: {
  url: string
  reconnect?: boolean
  reconnectDelayMs?: number
}): Layer<RelayService>
```

### FollowListService (NIP-02)

Follow list management using kind 3 replaceable events.

```typescript
interface FollowListService {
  getFollows(pubkey: PublicKey): Effect<FollowListResult, RelayError>

  setFollows(follows: Follow[], privateKey: PrivateKey): Effect<PublishResult, RelayError>

  addFollow(follow: Follow, privateKey: PrivateKey): Effect<PublishResult, RelayError>

  removeFollow(pubkey: PublicKey, privateKey: PrivateKey): Effect<PublishResult, RelayError>

  isFollowing(owner: PublicKey, target: PublicKey): Effect<boolean, RelayError>
}

interface Follow {
  pubkey: PublicKey
  relay?: string      // Recommended relay
  petname?: string    // Local nickname
}
```

**Dependencies:** RelayService, EventService, CryptoService

### RelayListService (NIP-65)

User relay preferences using kind 10002 events.

```typescript
interface RelayListService {
  getRelayList(pubkey: PublicKey): Effect<RelayListResult, RelayError>

  setRelayList(relays: RelayPreference[], privateKey: PrivateKey): Effect<PublishResult, RelayError>

  addRelay(relay: RelayPreference, privateKey: PrivateKey): Effect<PublishResult, RelayError>

  removeRelay(url: string, privateKey: PrivateKey): Effect<PublishResult, RelayError>

  getReadRelays(pubkey: PublicKey): Effect<string[], RelayError>

  getWriteRelays(pubkey: PublicKey): Effect<string[], RelayError>
}

interface RelayPreference {
  url: string
  read?: boolean
  write?: boolean
}
```

### HandlerService (NIP-89)

Application handler discovery and recommendations.

```typescript
interface HandlerService {
  publishHandlerInfo(info: HandlerInfo, privateKey: PrivateKey): Effect<PublishResult, RelayError>
  // Kind 31990 - app capabilities

  publishRecommendation(rec: HandlerRecommendation, privateKey: PrivateKey): Effect<PublishResult, RelayError>
  // Kind 31989 - user recommendations

  getHandlers(eventKind: number, authors?: PublicKey[]): Effect<HandlerQueryResult, RelayError>

  getRecommendations(eventKind: number, authors?: PublicKey[]): Effect<RecommendationQueryResult, RelayError>

  getHandlerByAddress(pubkey: PublicKey, identifier: string): Effect<NostrEvent | undefined, RelayError>
}
```

### DVMService (NIP-90)

Data Vending Machine job orchestration.

```typescript
interface DVMService {
  createJobRequest(config: JobRequestConfig, privateKey: PrivateKey): Effect<{ event: NostrEvent; result: PublishResult }, RelayError>
  // Kinds 5000-5999

  subscribeToJob(jobRequestId: string): Effect<JobSubscription, RelayError>
  // Receives kinds 6000-6999 (results) and 7000 (feedback)

  cancelJob(jobRequestId: string, privateKey: PrivateKey): Effect<PublishResult, RelayError>
  // Publishes kind 5 deletion
}

interface JobRequestConfig {
  kind: number              // 5000-5999
  inputs?: JobInput[]       // Data inputs
  params?: JobParam[]       // Job parameters
  output?: string           // Expected MIME type
  bid?: number              // Max payment (millisats)
  relays?: string[]         // Response relays
  preferredProviders?: string[]
}

type JobFeedbackStatus = "payment-required" | "processing" | "error" | "success" | "partial"
```

---

## Relay Implementation

The relay implements NIP-01 and supporting NIPs using Effect services and Bun.serve.

### Architecture Overview

```
                    ┌─────────────────┐
                    │   Bun.serve()   │
                    │   WebSocket     │
                    └────────┬────────┘
                             │
                    ┌────────▼────────┐
                    │ MessageHandler  │
                    │  (NIP-01 msgs)  │
                    └────────┬────────┘
                             │
        ┌────────────────────┼────────────────────┐
        │                    │                    │
┌───────▼───────┐   ┌────────▼────────┐   ┌──────▼──────┐
│ PolicyPipeline│   │   EventStore    │   │Subscription │
│ (validation)  │   │ (SQLite/Memory) │   │  Manager    │
└───────────────┘   └─────────────────┘   └─────────────┘
        │
┌───────▼───────┐
│ EventService  │
│ (verify sig)  │
└───────────────┘
```

### RelayServer

HTTP/WebSocket server using Bun's native APIs.

```typescript
interface RelayConfig {
  port: number
  host?: string
  dbPath?: string           // SQLite path (":memory:" for in-memory)
  relayInfo?: Partial<RelayInfo>  // NIP-11 metadata
}

interface RelayHandle {
  port: number
  stop: () => Effect<void>
}

function startRelay(config: RelayConfig): Effect<RelayHandle, ...>
```

**Request Handling:**
- **HTTP GET**: Returns NIP-11 relay information document
- **WebSocket Upgrade**: Establishes persistent connection

**WebSocket Events:**
- `open`: Register connection
- `message`: Parse and route to MessageHandler
- `close`: Cleanup subscriptions
- `drain`: Backpressure handling

### EventStore

Pluggable storage interface with two implementations.

```typescript
interface EventStore {
  storeEvent(event: NostrEvent): Effect<boolean, StorageError | DuplicateEvent>

  storeReplaceableEvent(event: NostrEvent): Effect<ReplaceableStoreResult, StorageError>
  // For kinds 0, 3, 10000-19999

  storeParameterizedReplaceableEvent(
    event: NostrEvent,
    dTagValue: string
  ): Effect<ReplaceableStoreResult, StorageError>
  // For kinds 30000-39999

  queryEvents(filters: Filter[]): Effect<NostrEvent[], StorageError>

  hasEvent(id: EventId): Effect<boolean, StorageError>

  deleteEvent(id: EventId): Effect<boolean, StorageError>

  count(): Effect<number, StorageError>
}

interface ReplaceableStoreResult {
  stored: boolean
  replacedId?: EventId
  reason?: string
}
```

#### SQLite Implementation

```typescript
SqliteEventStoreLive(dbPath: string): Layer<EventStore>
```

**Schema:**
```sql
CREATE TABLE events (
  id TEXT PRIMARY KEY,
  pubkey TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  kind INTEGER NOT NULL,
  tags TEXT NOT NULL,        -- JSON array
  content TEXT NOT NULL,
  sig TEXT NOT NULL,
  d_tag TEXT                 -- For parameterized replaceable
);

CREATE INDEX idx_pubkey ON events(pubkey);
CREATE INDEX idx_kind ON events(kind);
CREATE INDEX idx_created_at ON events(created_at);
CREATE INDEX idx_pubkey_kind ON events(pubkey, kind);
CREATE INDEX idx_pubkey_kind_dtag ON events(pubkey, kind, d_tag);
```

**Features:**
- WAL mode for concurrent access
- JSON serialization for tags array
- Efficient indexes for common query patterns

#### Memory Implementation

```typescript
MemoryEventStoreLive: Layer<EventStore>
```

Uses `Map<EventId, NostrEvent>` for testing and development.

### FilterMatcher

Event-filter matching logic per NIP-01.

```typescript
matchesFilter(event: NostrEvent, filter: Filter): boolean
matchesFilters(event: NostrEvent, filters: Filter[]): boolean
```

**Matching Rules:**
| Field | Logic |
|-------|-------|
| `ids` | Prefix match (not exact) |
| `authors` | Prefix match |
| `kinds` | Exact match |
| `since` | `created_at >= since` |
| `until` | `created_at <= until` |
| `#e`, `#p`, etc. | Tag value exists |

### SubscriptionManager

Tracks active subscriptions per connection.

```typescript
interface SubscriptionManager {
  subscribe(connectionId: string, subId: SubscriptionId, filters: Filter[]): Effect<void>

  unsubscribe(connectionId: string, subId: SubscriptionId): Effect<void>

  removeConnection(connectionId: string): Effect<void>

  getMatchingSubscriptions(event: NostrEvent): Effect<Subscription[]>

  getSubscriptions(connectionId: string): Effect<Subscription[]>
}
```

**Data Structure:**
```typescript
Map<connectionId, Map<subscriptionId, Subscription>>
```

Uses `Effect.Ref` for thread-safe atomic updates.

### MessageHandler

Routes NIP-01 messages and generates responses.

```typescript
interface MessageHandler {
  handleMessage(
    connectionId: string,
    message: string
  ): Effect<HandleResult, MessageParseError>
}

interface HandleResult {
  responses: RelayMessage[]        // To originating connection
  broadcasts: BroadcastMessage[]   // To matching subscriptions
}
```

**Message Flow:**

| Client Message | Handler Action | Response |
|----------------|----------------|----------|
| `["EVENT", event]` | Validate → Store → Broadcast | `["OK", id, success, msg]` |
| `["REQ", subId, ...filters]` | Subscribe → Query historical | `["EVENT", subId, event]...` `["EOSE", subId]` |
| `["CLOSE", subId]` | Unsubscribe | (none) |

### PolicyPipeline

Composable event validation framework.

```typescript
type Policy<E = never, R = never> =
  (ctx: PolicyContext) => Effect<PolicyDecision, E, R>

interface PolicyContext {
  event: NostrEvent
  connectionId: string
  remoteAddress?: string
}

type PolicyDecision =
  | { _tag: "Accept" }
  | { _tag: "Reject"; reason: string }
  | { _tag: "Shadow" }  // Silent drop
```

**Combinators:**
```typescript
// AND - reject on first non-accept
all(policy1, policy2, ...): Policy

// OR - accept on first accept
any(policy1, policy2, ...): Policy
```

**Built-in Policies:**
```typescript
verifySignature: Policy                    // Cryptographic verification
maxContentLength(bytes: number): Policy    // Content size limit
maxTags(count: number): Policy             // Tag count limit
maxTagValueLength(bytes: number): Policy   // Per-tag size limit
maxFutureSeconds(seconds: number): Policy  // NIP-22 timestamp bounds
```

**Default Pipeline:**
```typescript
all(
  verifySignature,
  maxContentLength(64 * 1024),  // 64KB
  maxTags(2000)
)
```

### RelayInfo (NIP-11)

Relay metadata served at the WebSocket endpoint via HTTP GET.

```typescript
interface RelayInfo {
  name?: string
  description?: string
  pubkey?: string
  contact?: string
  supported_nips?: number[]
  software?: string
  version?: string
  limitation?: RelayLimitation
  fees?: RelayFees
  retention?: RetentionSpec[]
  language_tags?: string[]
}

interface RelayLimitation {
  max_message_length?: number
  max_subscriptions?: number
  max_limit?: number
  max_subid_length?: number
  max_event_tags?: number
  max_content_length?: number
  created_at_lower_limit?: number
  created_at_upper_limit?: number
  auth_required?: boolean
  payment_required?: boolean
}
```

---

## Backend Abstraction

The relay is designed with pluggable backends to support multiple deployment targets. This section describes the abstraction layers and planned platform implementations.

### Architecture Layers

```
┌─────────────────────────────────────────────────────────────┐
│                     Application Layer                        │
│  MessageHandler, SubscriptionManager, PolicyPipeline,        │
│  FilterMatcher, RelayInfo                                    │
│  (Pure TypeScript/Effect - fully portable)                   │
├─────────────────────────────────────────────────────────────┤
│                     Service Interfaces                       │
│  EventStore, CryptoService, EventService                     │
│  (Effect Context tags - implementation swappable)            │
├─────────────────────────────────────────────────────────────┤
│                     Backend Layer                            │
│  Storage Backend │ Server Backend │ State Backend            │
│  (Platform-specific implementations)                         │
└─────────────────────────────────────────────────────────────┘
```

### Backend Types

#### 1. Storage Backend (EventStore)

Implements the `EventStore` interface for event persistence.

| Backend | Package/API | Status | Notes |
|---------|-------------|--------|-------|
| **Memory** | `Map<EventId, NostrEvent>` | ✅ Current | Testing only |
| **BunSqlite** | `bun:sqlite` | ⚠️ Retiring | Removed by the Node migration |
| **NodeSqlite** | `node:sqlite` | 📋 Planned | Local development and non-production proofs |
| **PostgreSQL** | Cloud SQL over Node | 📋 Planned | Production target |

All SQL-based backends share the same schema and query patterns. The `EventStore` interface abstracts the underlying database.

**Note:** Cloudflare Workers, Durable Objects, D1, and R2 are retired. They must not return as a storage or runtime option. The production store is Cloud SQL Postgres reached from Node. See [the Node and Google Cloud migration](2026-07-24-node-google-cloud-migration.md).

#### 2. Server Backend

Handles HTTP requests and WebSocket connections.

| Backend | APIs | Status | Notes |
|---------|------|--------|-------|
| **BunServer** | `Bun.serve()` | ⚠️ Retiring | Removed by the Node migration |
| **NodeServer** | `node:http` + `ws` | 📋 Planned | The only supported host |

#### 3. State Backend

Manages per-connection state (subscriptions, rate limits).

| Backend | Persistence | Status | Notes |
|---------|-------------|--------|-------|
| **InMemory** | Process lifetime | ✅ Current | Single Node process |
| **Postgres** | Cloud SQL | 📋 Planned | Multi-replica coordination |

### Deployment strategy

The relay runs on Node and deploys to Google Cloud. Cloud SQL Postgres is the
event store. Secrets live in Google Secret Manager.

See **[the Node and Google Cloud migration](2026-07-24-node-google-cloud-migration.md)** for the migration plan and its gates.

### Proposed Directory Structure

```
src/relay/
├── core/                    # Platform-agnostic (portable)
│   ├── MessageHandler.ts
│   ├── SubscriptionManager.ts
│   ├── PolicyPipeline.ts
│   ├── FilterMatcher.ts
│   ├── RelayInfo.ts
│   └── index.ts
│
├── storage/                 # EventStore implementations
│   ├── EventStore.ts        # Interface definition
│   ├── MemoryEventStore.ts
│   └── SqlQueries.ts        # Shared SQL query builders
│
├── backends/
│   └── node/
│       ├── NodeSqliteStore.ts  # node:sqlite EventStore (development)
│       ├── PostgresStore.ts    # Cloud SQL EventStore (production)
│       ├── NodeServer.ts       # node:http + ws WebSocket host
│       └── index.ts
│
├── index.ts                 # Default exports
└── main.ts                  # Node CLI entrypoint
```

### Implementation Plan

#### Phase 1: Refactor for Portability

1. Extract platform-agnostic code to `relay/core/`
2. Move `SqliteEventStore` logic to `relay/storage/`
3. Create `relay/backends/bun/` with current Bun implementations
4. Ensure all imports use the new structure

#### Phase 2: Node backend

1. Move `RelayServer`, `RelayConfig`, `RelayHandle`, and `MemoryEventStore` out
   of the Bun backend into platform-agnostic core
2. Implement `NodeServer` on `node:http` plus `ws`
3. Implement `NodeSqliteStore` on `node:sqlite` for development
4. Implement `PostgresStore` against Cloud SQL for production
5. Delete the Bun backend and the Bun test runner

#### Phase 3: Production hardening

1. Add connection-scoped rate limiting
2. Implement graceful WebSocket close handling
3. Add metrics and logging for Google Cloud observability
4. Document the Cloud Run deployment process
5. Consider a sharding strategy for high-traffic relays

### Backend Selection

The backend is selected at build/deploy time, not runtime:

```typescript
// Development entrypoint
const RelayLayers = RelayCoreLive.pipe(
  Layer.provide(NodeSqliteStoreLive(dbPath)),
  Layer.provide(NodeServerLive)
)

// Production entrypoint (Cloud Run + Cloud SQL)
const RelayLayers = RelayCoreLive.pipe(
  Layer.provide(PostgresStoreLive(connectionString)),
  Layer.provide(NodeServerLive)
)
```

### Portable Components

These modules work unchanged across all platforms:

| Component | Dependencies | Notes |
|-----------|--------------|-------|
| `MessageHandler` | Effect, Schema | Pure message routing |
| `SubscriptionManager` | Effect.Ref | In-memory state |
| `PolicyPipeline` | Effect, EventService | Validation logic |
| `FilterMatcher` | None | Pure functions |
| `RelayInfo` | None | NIP-11 metadata |
| `CryptoService` | @noble/* | Pure crypto |
| `EventService` | CryptoService | Event creation/verification |
| `Nip44Service` | @noble/* | Encryption |
| `Nip19` | @scure/base | Bech32 encoding |

---

## Effect Patterns

### Layer Composition

Services are composed using Effect's Layer system:

```typescript
// Build full relay stack
const RelayLayers = RelayServerLive.pipe(
  Layer.provide(MessageHandlerLive),
  Layer.provide(PolicyPipelineLive),
  Layer.provide(SubscriptionManagerLive),
  Layer.provide(SqliteEventStoreLive(dbPath)),
  Layer.provide(EventServiceLive),
  Layer.provide(CryptoServiceLive)
)

// Run with layers
Effect.runPromise(
  startRelay(config).pipe(
    Effect.provide(RelayLayers)
  )
)
```

### Error Handling

All errors flow through Effect's type system:

```typescript
Effect.gen(function* () {
  const crypto = yield* CryptoService
  const privKey = yield* crypto.generatePrivateKey()
  // If this fails, error propagates up
  const pubKey = yield* crypto.getPublicKey(privKey)
  return pubKey
}).pipe(
  Effect.catchTag("InvalidPrivateKey", (e) => ...),
  Effect.catchTag("CryptoError", (e) => ...)
)
```

### Stream Usage

RelayService uses Effect Streams for subscription events:

```typescript
const sub = yield* relay.subscribe([filter])

// Process events as they arrive
yield* sub.events.pipe(
  Stream.tap((event) => console.log(event)),
  Stream.takeUntil((event) => event.kind === 5),
  Stream.runDrain
)
```

### Ref for State

SubscriptionManager uses Effect.Ref for atomic state updates:

```typescript
const make = Effect.gen(function* () {
  const state = yield* Effect.Ref.make<Map<string, Subscription>>(new Map())

  return {
    add: (sub) => Effect.Ref.update(state, (m) => m.set(sub.id, sub)),
    remove: (id) => Effect.Ref.update(state, (m) => { m.delete(id); return m }),
    getAll: () => Effect.Ref.get(state)
  }
})
```

---

## Dependencies

### Runtime Dependencies

| Package | Version | Purpose |
|---------|---------|---------|
| `effect` | 3.19.8 | Core FP runtime |
| `@effect/schema` | 0.75.5 | Type validation, tagged errors |
| `@effect/platform` | 0.93.5 | Platform utilities |
| `@noble/curves` | 1.8.1 | secp256k1 Schnorr signatures |
| `@noble/hashes` | 1.7.1 | SHA256, HMAC, HKDF |
| `@noble/ciphers` | 1.2.1 | ChaCha20 encryption |
| `@scure/base` | 1.2.4 | Bech32 encoding |

### Dev Dependencies

| Package | Version | Purpose |
|---------|---------|---------|
| `typescript` | 5.7.2 | Type checking |
| `@types/bun` | 1.1.14 | Bun type definitions |
| `@effect/language-service` | 0.57.0 | IDE support |

### Bun Built-in APIs

| API | Usage |
|-----|-------|
| `bun:sqlite` | Event storage |
| `Bun.serve()` | HTTP/WebSocket server |
| `WebSocket` | Client connections |
| `TextEncoder/Decoder` | String encoding |
| `atob/btoa` | Base64 encoding |

---

## Bun Runtime APIs

### Server (Bun.serve)

```typescript
const server = Bun.serve({
  port: 3000,
  hostname: "0.0.0.0",

  // HTTP request handler
  fetch(request, server) {
    // Upgrade WebSocket or return HTTP response
    if (server.upgrade(request)) return
    return new Response(JSON.stringify(relayInfo), {
      headers: { "Content-Type": "application/nostr+json" }
    })
  },

  // WebSocket handlers
  websocket: {
    open(ws) { /* connection opened */ },
    message(ws, message) { /* received message */ },
    close(ws, code, reason) { /* connection closed */ },
    drain(ws) { /* ready for more data */ }
  }
})

// Graceful shutdown
server.stop()
```

### Database (bun:sqlite)

```typescript
import { Database } from "bun:sqlite"

const db = new Database(path)  // or ":memory:"

// Configure
db.exec("PRAGMA journal_mode = WAL")

// Queries
const stmt = db.prepare("SELECT * FROM events WHERE kind = ?")
const results = stmt.all(kind)

// Transactions
db.transaction(() => {
  db.exec("INSERT INTO events ...")
  db.exec("DELETE FROM events ...")
})()
```

### WebSocket (built-in)

```typescript
const ws = new WebSocket("wss://relay.example.com")

ws.onopen = () => { }
ws.onmessage = (event) => { }
ws.onclose = (event) => { }
ws.onerror = (event) => { }

ws.send(JSON.stringify(["EVENT", nostrEvent]))
ws.close()
```

---

## Build & Configuration

### Package Scripts

```bash
pnpm run prepare     # Setup language service and git hooks
pnpm run setup:hooks # Install pre-push hook
pnpm test            # Run all tests (vp test --run)
pnpm run typecheck   # Type check only (tsc --noEmit)
pnpm run verify      # Typecheck + tests (used by pre-push)
pnpm run build       # Bundle with vp pack
```

### TypeScript Configuration

**tsconfig.json:**
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "Preserve",
    "moduleResolution": "Bundler",
    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "exactOptionalPropertyTypes": true,
    "noUncheckedIndexedAccess": true,
    "plugins": [{ "name": "@effect/language-service" }]
  }
}
```

### Pre-push Hook

```bash
#!/bin/bash
pnpm run verify
```

Prevents pushing code that doesn't compile or pass tests.

---

## Deployment Targets

See [Backend Abstraction](#backend-abstraction) for the architectural approach to multi-platform support.

### Node on Google Cloud (target)

**Status:** 📋 Planned — see
[the Node and Google Cloud migration](2026-07-24-node-google-cloud-migration.md)

**Backend:** `backends/node/`

**Requirements:**
- Node 24
- Cloud SQL Postgres for production storage
- Network access (WebSocket)

**Components:**
| Component | Implementation |
|-----------|----------------|
| Storage (production) | `PostgresStore` → Cloud SQL |
| Storage (development) | `NodeSqliteStore` → `node:sqlite` |
| Server | `NodeServer` → `node:http` + `ws` |
| State | In-memory `SubscriptionManager` |
| Secrets | Google Secret Manager |

**Deployment:** Cloud Run in project `openagentsgemini`, with Cloud SQL
attached and secrets mounted from Secret Manager.

### Bun runtime (retiring)

**Status:** ⚠️ Removed by the Node migration

The Bun backend and the Bun test runner are the migration's targets. Do not
add Bun or Cloudflare code. Do not add a `Bun.*` API call, a `bun:` import, or `/bun`.

### Retired hosts

Cloudflare Workers, Durable Objects, D1, and R2 are retired. The Cloudflare
backend, its worker entrypoint, and `wrangler.toml` were deleted on
2026-07-24. Do not reintroduce them as a runtime, a store, a fallback, or a
compatibility lane. Deno is not a supported target.

### Portable Client Library

The client library (`src/client/`) works on all JavaScript runtimes:

| Runtime | WebSocket | Tested |
|---------|-----------|--------|
| Node 24 | native or `ws` | 📋 |
| Browser | Built-in | 📋 |

**No platform-specific code required** - the client uses standard WebSocket APIs.

---

## Architecture Principles

### 1. Type Safety First

- Branded types prevent mixing up IDs, keys, signatures
- Schema validation at boundaries
- Exhaustive pattern matching on errors
- No `any` in happy paths

### 2. Effect-Based Composition

- All I/O wrapped in Effects
- Services compose via Layers
- No global mutable state
- Testable through dependency injection

### 3. Protocol Fidelity

- Exact NIP-01 compliance
- Test vectors from specifications
- Interoperability with other implementations

### 4. Pluggable Architecture

- EventStore interface allows different backends
- PolicyPipeline accepts custom policies
- Client services can be composed independently

### 5. Production Readiness

- Proper error handling with typed errors
- Automatic reconnection in client
- WAL mode for database concurrency
- Rate limiting ready via policy framework
