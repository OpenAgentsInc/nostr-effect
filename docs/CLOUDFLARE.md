# Cloudflare Deployment Guide

This document covers deploying nostr-effect relay to Cloudflare Workers using Durable Objects with built-in SQLite storage.

## Why Durable Objects?

Durable Objects (DOs) are a perfect fit for Nostr relays:

| Nostr Relay Need | Durable Object Solution |
|------------------|------------------------|
| Persistent WebSocket connections | DO handles WebSocket lifecycle |
| Subscription state across messages | In-memory state persists in DO |
| Event storage | DO SQLite (`storage.sql`) |
| Broadcast to subscribers | DO tracks all connections |
| Global availability | DOs auto-provision near users |

### Key DO Characteristics

- **Globally unique name** - Route all relay traffic to one DO instance (or shard by pubkey/kind)
- **Colocated compute + storage** - SQLite lives with the DO, no network round-trips
- **Single-writer consistency** - No race conditions on event storage
- **Automatic lifecycle** - Starts on first request, hibernates when idle
- **WebSocket Hibernation** - Handle thousands of idle connections efficiently

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     Cloudflare Edge                          │
│                                                              │
│   Request → Worker (routing) → Durable Object               │
│                                     │                        │
│                          ┌──────────┴──────────┐             │
│                          │   NostrRelayDO      │             │
│                          │                     │             │
│                          │  ┌───────────────┐  │             │
│                          │  │ WebSocket     │  │             │
│                          │  │ Connections   │  │             │
│                          │  └───────────────┘  │             │
│                          │  ┌───────────────┐  │             │
│                          │  │ Subscription  │  │             │
│                          │  │ Manager       │  │             │
│                          │  └───────────────┘  │             │
│                          │  ┌───────────────┐  │             │
│                          │  │ storage.sql   │  │             │
│                          │  │ (SQLite)      │  │             │
│                          │  └───────────────┘  │             │
│                          └─────────────────────┘             │
└─────────────────────────────────────────────────────────────┘
```

## DO SQLite vs D1

We use DO SQLite, NOT D1:

| Aspect | DO SQLite | D1 |
|--------|-----------|-----|
| Location | Colocated with DO | Separate service |
| Latency | <1ms (local) | 5-50ms (network) |
| Consistency | Single-writer, strong | Eventually consistent |
| State coordination | Built-in (same DO) | Requires separate DO |
| Billing | Included in DO | Separate charges |
| Use case | Stateful apps | Shared databases |

## Implementation

### File Structure

```
src/relay/backends/cloudflare/
├── DoSqliteStore.ts    # EventStore using storage.sql
├── NostrRelayDO.ts     # Durable Object class
├── worker.ts           # Worker routing entrypoint
└── wrangler.toml       # Deployment config
```

### DoSqliteStore

Implements `EventStore` interface using DO's `storage.sql`:

```typescript
// Same schema as Bun SQLite - queries are portable
export const DoSqliteStoreLive = (sql: SqlStorage) =>
  Layer.scoped(EventStore, Effect.gen(function* () {
    // Initialize schema
    yield* Effect.promise(() => sql.exec(`
      CREATE TABLE IF NOT EXISTS events (
        id TEXT PRIMARY KEY,
        pubkey TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        kind INTEGER NOT NULL,
        tags TEXT NOT NULL,
        content TEXT NOT NULL,
        sig TEXT NOT NULL,
        d_tag TEXT
      )
    `))

    // Return EventStore implementation
    return {
      storeEvent: (event) => Effect.tryPromise(() =>
        sql.exec("INSERT INTO events ...", [event.id, ...])
      ),
      queryEvents: (filters) => Effect.tryPromise(() =>
        sql.exec("SELECT * FROM events WHERE ...", params)
      ),
      // ... same interface as Bun SQLite
    }
  }))
```

### NostrRelayDO

The Durable Object class:

```typescript
export class NostrRelayDO implements DurableObject {
  private connections = new Map<string, WebSocket>()
  private layers: Layer<MessageHandler | SubscriptionManager | EventStore>

  constructor(state: DurableObjectState, env: Env) {
    // Build Effect layers with DO SQLite
    this.layers = pipe(
      MessageHandlerLive,
      Layer.provide(SubscriptionManagerLive),
      Layer.provide(PolicyPipelineLive),
      Layer.provide(DoSqliteStoreLive(state.storage.sql)),
      Layer.provide(EventServiceLive),
      Layer.provide(CryptoServiceLive)
    )
  }

  async fetch(request: Request): Promise<Response> {
    // HTTP GET → NIP-11 relay info
    if (request.headers.get("Upgrade") !== "websocket") {
      return new Response(JSON.stringify(buildRelayInfo()), {
        headers: { "Content-Type": "application/nostr+json" }
      })
    }

    // WebSocket upgrade
    const pair = new WebSocketPair()
    const [client, server] = Object.values(pair)

    const connectionId = crypto.randomUUID()
    server.accept()
    this.connections.set(connectionId, server)

    server.addEventListener("message", (event) => {
      this.handleMessage(connectionId, event.data)
    })

    server.addEventListener("close", () => {
      this.connections.delete(connectionId)
      // Clean up subscriptions
    })

    return new Response(null, { status: 101, webSocket: client })
  }

  private async handleMessage(connectionId: string, raw: string) {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const handler = yield* MessageHandler
        return yield* handler.handleMessage(connectionId, raw)
      }).pipe(Effect.provide(this.layers))
    )

    // Send responses to originating connection
    for (const msg of result.responses) {
      this.connections.get(msg.connectionId)?.send(JSON.stringify(msg.payload))
    }

    // Broadcast to matching subscriptions
    for (const msg of result.broadcasts) {
      this.connections.get(msg.connectionId)?.send(JSON.stringify(msg.payload))
    }
  }
}
```

### Worker Entrypoint

Routes all requests to a single DO instance:

```typescript
// worker.ts
export { NostrRelayDO } from "./NostrRelayDO"

export interface Env {
  NOSTR_RELAY: DurableObjectNamespace
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    // Single global relay instance
    const id = env.NOSTR_RELAY.idFromName("global")
    const stub = env.NOSTR_RELAY.get(id)
    return stub.fetch(request)
  }
}
```

### Wrangler Configuration

```toml
# wrangler.toml
name = "nostr-relay"
main = "dist/backends/cloudflare/worker.js"
compatibility_date = "2024-01-01"

[durable_objects]
bindings = [
  { name = "NOSTR_RELAY", class_name = "NostrRelayDO" }
]

[[migrations]]
tag = "v1"
new_sqlite_classes = ["NostrRelayDO"]
```

The `new_sqlite_classes` migration enables SQLite storage for the DO.

## Deployment

```bash
# Install wrangler
bun add -D wrangler

# Build for Cloudflare
bun run build:cloudflare

# Deploy
wrangler deploy

# View logs
wrangler tail
```

## WebSocket Hibernation

For production with many idle connections, use WebSocket Hibernation:

```typescript
export class NostrRelayDO implements DurableObject {
  // Instead of tracking WebSockets in memory,
  // use the Hibernation API

  async webSocketMessage(ws: WebSocket, message: string) {
    // Called when hibernated WebSocket receives message
  }

  async webSocketClose(ws: WebSocket, code: number, reason: string) {
    // Called when hibernated WebSocket closes
  }
}
```

This allows the DO to "hibernate" while maintaining WebSocket connections, reducing costs for idle relays.

## Limits & Pricing

### Free Plan (SQLite DOs)

- 100,000 requests/day
- 1GB storage
- 1ms CPU time per request (after first 30ms free)

### Paid Plan

- $0.15/million requests
- $0.20/GB-month storage
- $12.50/million GB-seconds duration
- No daily request limits

See [Cloudflare Durable Objects Pricing](https://developers.cloudflare.com/durable-objects/platform/pricing/) for current rates.

## Scaling Considerations

### Single DO (Simple)

Route all traffic to one DO instance:

```typescript
const id = env.NOSTR_RELAY.idFromName("global")
```

Good for: Personal relays, low-medium traffic.

### Sharded DOs (High Traffic)

Route by pubkey prefix or event kind:

```typescript
// Shard by first 2 chars of author pubkey
const shard = request.headers.get("X-Nostr-Pubkey")?.slice(0, 2) ?? "default"
const id = env.NOSTR_RELAY.idFromName(`relay-${shard}`)
```

Trade-off: Cross-shard subscriptions require coordination.

### Geo-Sharded DOs

Route by region for latency optimization:

```typescript
const colo = request.cf?.colo ?? "default"
const id = env.NOSTR_RELAY.idFromName(`relay-${colo}`)
```

Trade-off: Events stored in one region may not be visible from another without replication.

## References

- [Durable Objects Overview](https://developers.cloudflare.com/durable-objects/)
- [DO SQLite Storage API](https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/)
- [WebSocket Hibernation](https://developers.cloudflare.com/durable-objects/best-practices/websockets/#websocket-hibernation-api)
- [DO Limits](https://developers.cloudflare.com/durable-objects/platform/limits/)
- [DO Pricing](https://developers.cloudflare.com/durable-objects/platform/pricing/)
