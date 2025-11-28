# nostr-effect

Nostr relay & client library built with [Effect](https://effect.website/).

Building both sides of the protocol in tandem - using each to test the other.

## Documentation

- **[ARCHITECTURE.md](docs/ARCHITECTURE.md)** - Technical overview, Effect patterns, backend abstraction
- **[BUILDOUT.md](docs/BUILDOUT.md)** - Development roadmap and parallel build plan
- **[CLOUDFLARE.md](docs/CLOUDFLARE.md)** - Cloudflare Workers + Durable Objects deployment guide

## Status

### Core
- [x] Schema.ts (NIP-01 event types, filters, messages)
- [x] Errors.ts (typed error classes)
- [x] Nip19.ts (bech32 encoding: npub/nsec/note/nprofile/nevent/naddr)

### Services
- [x] CryptoService (keys, signing, verification)
- [x] EventService (create, verify)
- [x] Nip44Service (NIP-44 versioned encryption)

### Relay
- [x] EventStore (SQLite via bun:sqlite)
- [x] SubscriptionManager
- [x] MessageHandler (EVENT, REQ, CLOSE → OK, EOSE)
- [x] RelayServer (Bun.serve WebSocket)
- [x] PolicyPipeline (composable event validation)
- [x] NIP-16/33 Replaceable Events
- [x] NIP-11 Relay Information Document
- [ ] NIP module system
- [ ] ConnectionManager
- [ ] NIP-42 Authentication

### Client
- [x] RelayService (WebSocket connection management)
- [x] FollowListService (NIP-02 follow lists)
- [x] RelayListService (NIP-65 relay list metadata)
- [x] HandlerService (NIP-89 application handlers)
- [x] DVMService (NIP-90 Data Vending Machines)
- [ ] RelayPool (multi-relay)
- [ ] NIP-46 remote signing

### Future
- NIP-05 identifier verification
- NIP-09 event deletion
- NIP-40 event expiration

## Quick Start

```bash
# Install dependencies
bun install

# Run tests
bun test

# Start relay
bun run src/relay/main.ts
```

## Architecture

Built with Effect TypeScript for type-safe, composable services:

- **Branded types** for compile-time safety (EventId, PublicKey, etc.)
- **Effect services** with Layer-based dependency injection
- **@noble libraries** for audited cryptography
- **Bun runtime** for native TypeScript, SQLite, WebSocket

See [ARCHITECTURE.md](docs/ARCHITECTURE.md) for full details.
