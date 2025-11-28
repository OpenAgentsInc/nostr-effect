# nostr-effect Build Order

This document outlines the parallel development strategy for nostr-effect's client and relay libraries.

## Architecture Overview

```
src/
├── core/           # Shared types and utilities
│   ├── Schema.ts   # NIP-01 event types, filters, messages
│   ├── Errors.ts   # Typed error classes
│   └── Nip19.ts    # bech32 encoding (npub/nsec/note/nprofile/nevent/naddr)
├── services/       # Shared Effect services
│   ├── CryptoService.ts   # Schnorr signing, key derivation
│   └── EventService.ts    # Event creation, verification
├── relay/          # Relay implementation
│   ├── EventStore.ts
│   ├── SubscriptionManager.ts
│   ├── MessageHandler.ts
│   ├── RelayServer.ts
│   └── policy/
└── client/         # Client library
    ├── RelayService.ts
    ├── RelayPool.ts
    └── ...
```

## Current State

### Completed
- **Core**: Schema.ts (NIP-01 types), Errors.ts, Nip19.ts (bech32 encoding)
- **Services**: CryptoService, EventService
- **Relay**: EventStore, SubscriptionManager, MessageHandler, RelayServer, PolicyPipeline

### Open Issues

**Relay (#5-13)**
| Issue | Description |
|-------|-------------|
| #5 | NIP Module system |
| #6 | ConnectionManager |
| #7 | NIP-09 Deletion |
| #8 | NIP-11 Relay Info |
| #9 | NIP-16/33 Replaceable Events |
| #10 | NIP-22 Timestamp Limits |
| #11 | NIP-40 Expiration |
| #12 | NIP-42 Authentication |
| #13 | Rate Limiting |

**Client (#14-24)**
| Issue | Description |
|-------|-------------|
| #14 | RelayService (WebSocket management) |
| ~~#17~~ | ~~NIP-19 bech32 encoding (Core)~~ ✅ |
| #18 | NIP-05 identifier verification |
| #19 | NIP-44 versioned encryption |
| #20 | NIP-02 follow list management |
| #21 | NIP-65 relay list metadata |
| #22 | NIP-04 legacy DM encryption |
| #23 | RelayPool multi-relay connections |
| #24 | NIP-46 remote signing |

## Build Order

### Phase 1: Foundation
**Goal**: Client can connect to relay and exchange events

| Order | Relay | Client | Notes |
|-------|-------|--------|-------|
| 1.1 | Done | ✅ #17: NIP-19 bech32 | User-facing key display |
| 1.2 | Done | #14: RelayService | WebSocket + reconnection |
| 1.3 | - | E2E test | Validates client-relay integration |

### Phase 2: Core NIPs
**Goal**: Essential NIP support for both sides

| Order | Relay | Client | Notes |
|-------|-------|--------|-------|
| 2.1 | #9: Replaceable | #18: NIP-02 Follow Lists | Client needs relay for kind 3 |
| 2.2 | #9: Replaceable | #19: NIP-65 Relay Lists | Client needs relay for kind 10002 |
| 2.3 | #8: NIP-11 Info | - | Client reads relay capabilities |
| 2.4 | #10: NIP-22 | - | Timestamp bounds (policy exists) |
| 2.5 | - | #16: NIP-05 | Independent (HTTP only) |

### Phase 3: Encryption & Auth
**Goal**: Secure messaging and authentication

| Order | Relay | Client | Notes |
|-------|-------|--------|-------|
| 3.1 | - | #17: NIP-44 | Modern encryption for DMs |
| 3.2 | - | #20: NIP-04 | Legacy DM support |
| 3.3 | #6: ConnectionManager | - | Per-connection state |
| 3.4 | #12: NIP-42 Auth | - | Requires ConnectionManager |

### Phase 4: Advanced
**Goal**: Production-ready features

| Order | Relay | Client | Notes |
|-------|-------|--------|-------|
| 4.1 | #7: NIP-09 Deletion | - | Soft delete |
| 4.2 | #11: NIP-40 Expiration | - | Event TTL |
| 4.3 | #13: Rate Limiting | - | Security |
| 4.4 | #5: NIP Module System | - | Pluggable NIPs |
| 4.5 | - | #21: RelayPool | Multi-relay |
| 4.6 | - | #22: NIP-46 | Remote signing |

## Parallel Development Strategy

### Shared Code
Code in `src/core/` and `src/services/` is used by both client and relay:
- Event creation and verification
- Cryptographic operations
- Type definitions and validation

### E2E Testing
Each client feature should have integration tests against the relay:

| Feature | Test Scenario |
|---------|---------------|
| RelayService | Connect, publish, receive OK |
| RelayService | Subscribe, receive events, EOSE |
| NIP-02 | Publish kind 3, verify replacement |
| NIP-65 | Publish kind 10002, query back |
| NIP-42 | AUTH challenge/response flow |

### Dependencies

```
Phase 1: Foundation
  └─ NIP-19, RelayService → E2E test

Phase 2: Core NIPs
  ├─ Relay: NIP-16/33 (replaceable events)
  ├─ Client: NIP-02, NIP-65 (use replaceable)
  ├─ Relay: NIP-11 (relay info)
  └─ Client: NIP-05 (DNS verification)

Phase 3: Encryption & Auth
  ├─ Client: NIP-44 (modern encryption)
  ├─ Client: NIP-04 (legacy compat)
  ├─ Relay: ConnectionManager
  └─ Relay: NIP-42 (auth)

Phase 4: Advanced
  ├─ Relay: NIP-09, NIP-40, Rate Limiting, Module System
  └─ Client: RelayPool, NIP-46
```

## Client Directory Structure

```
src/client/
├── RelayService.ts        # Single relay WebSocket connection
├── RelayPool.ts           # Multi-relay orchestration
├── Nip05Service.ts        # DNS identifier resolution
├── Nip44Encryption.ts     # Versioned encryption (NIP-44)
├── Nip04Encryption.ts     # Legacy DM encryption (NIP-04)
├── FollowListService.ts   # Follow list management (NIP-02)
├── RelayListService.ts    # Relay preferences (NIP-65)
└── RemoteSignerService.ts # Nostr Connect (NIP-46)
```

## Notes

- NIP-19 bech32 encoding is in `src/core/` since it's useful for both client display and relay admin
- FilterMatcher (currently in relay/) should be extracted to shared code for client-side filtering
- Each phase builds on the previous - don't skip ahead
- Client and relay can be worked on in parallel within the same phase
