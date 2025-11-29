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
- **Services**: CryptoService, EventService, Nip44Service (NIP-44 versioned encryption)
- **Relay**: EventStore, SubscriptionManager, MessageHandler, RelayServer, PolicyPipeline, NIP-16/33 Replaceable Events, NIP-11 Relay Info, NIP Module System, Timestamp Limits, ConnectionManager, NIP-42 Authentication (AuthService)
- **Relay Backends**: Bun (SQLite), Cloudflare Durable Objects (DO SQLite)
- **Client**: RelayService (WebSocket connection management), RelayPool (multi-relay orchestration), FollowListService (NIP-02), RelayListService (NIP-65), HandlerService (NIP-89), DVMService (NIP-90), ChatService (NIP-28), ZapService (NIP-57), Nip05Service (NIP-05 verification), MintDiscoverabilityService (NIP-87), AppDataService (NIP-78)

### Open Issues

**Relay (#5-13)**
| Issue | Description |
|-------|-------------|
| ~~#5~~ | ~~NIP Module system~~ ✅ |
| ~~#6~~ | ~~ConnectionManager~~ ✅ |
| #7 | NIP-09 Deletion |
| ~~#8~~ | ~~NIP-11 Relay Info~~ ✅ |
| ~~#9~~ | ~~NIP-16/33 Replaceable Events~~ ✅ |
| ~~#10~~ | ~~Timestamp Limits (NIP-11 limitation)~~ ✅ |
| #11 | NIP-40 Expiration |
| ~~#12~~ | ~~NIP-42 Authentication~~ ✅ |
| #13 | Rate Limiting |

**Client (#14-24)**
| Issue | Description |
|-------|-------------|
| ~~#14~~ | ~~RelayService (WebSocket management)~~ ✅ |
| ~~#17~~ | ~~NIP-19 bech32 encoding (Core)~~ ✅ |
| ~~#18~~ | ~~NIP-05 identifier verification~~ ✅ |
| ~~#19~~ | ~~NIP-44 versioned encryption~~ ✅ |
| ~~#20~~ | ~~NIP-02 follow list management~~ ✅ |
| ~~#21~~ | ~~NIP-65 relay list metadata~~ ✅ |
| ~~#22~~ | ~~NIP-04 legacy DM encryption~~ (not planned) |
| ~~#23~~ | ~~RelayPool multi-relay connections~~ ✅ |
| #24 | NIP-46 remote signing |
| ~~#31~~ | ~~NIP-89 application handlers~~ ✅ |
| ~~#32~~ | ~~NIP-90 DVM support~~ ✅ |

## Build Order

### Phase 1: Foundation
**Goal**: Client can connect to relay and exchange events

| Order | Relay | Client | Notes |
|-------|-------|--------|-------|
| 1.1 | Done | ✅ #17: NIP-19 bech32 | User-facing key display |
| 1.2 | Done | ✅ #14: RelayService | WebSocket + reconnection |
| 1.3 | - | E2E test | Validates client-relay integration |

### Phase 2: Core NIPs
**Goal**: Essential NIP support for both sides

| Order | Relay | Client | Notes |
|-------|-------|--------|-------|
| 2.1 | ✅ #9: Replaceable | ✅ #20: NIP-02 Follow Lists | Client needs relay for kind 3 |
| 2.2 | ✅ #9: Replaceable | ✅ #21: NIP-65 Relay Lists | Client needs relay for kind 10002 |
| 2.3 | ✅ #8: NIP-11 Info | - | Client reads relay capabilities |
| 2.4 | ✅ #10: Timestamp Limits | - | created_at bounds (NIP-11 limitation) |
| 2.5 | - | ✅ #18: NIP-05 | Independent (HTTP only) |

### Phase 3: DVM & Discovery
**Goal**: Data Vending Machine and application discovery

| Order | Relay | Client | Notes |
|-------|-------|--------|-------|
| 3.1 | Done (NIP-33) | ✅ #31: NIP-89 Handlers | App discovery via kind 31989/31990 |
| 3.2 | Done | ✅ #32: NIP-90 DVM | Job requests/results (kinds 5000-7000) |

### Phase 4: Encryption & Auth
**Goal**: Secure messaging and authentication

| Order | Relay | Client | Notes |
|-------|-------|--------|-------|
| 4.1 | - | ✅ #19: NIP-44 | Modern encryption for DMs |
| 4.2 | ✅ #6: ConnectionManager | - | Per-connection state |
| 4.3 | ✅ #12: NIP-42 Auth | - | Requires ConnectionManager |

### Phase 5: Advanced
**Goal**: Production-ready features

| Order | Relay | Client | Notes |
|-------|-------|--------|-------|
| 5.1 | #7: NIP-09 Deletion | - | Soft delete |
| 5.2 | #11: NIP-40 Expiration | - | Event TTL |
| 5.3 | #13: Rate Limiting | - | Security |
| 5.4 | ✅ #5: NIP Module System | - | Pluggable NIPs |
| 5.5 | - | #23: RelayPool | Multi-relay |
| 5.6 | - | #24: NIP-46 | Remote signing |

### Phase 6: Remaining NIPs
**Goal**: Implement the remaining NIPs to reach broad protocol coverage.

Completed in this phase:
- NIP-87 Ecash Mint Discoverability (MintDiscoverabilityService, tests) — PR #68
- NIP-78 Arbitrary Custom App Data (AppDataService, tests) — PR #69
- NIP-66 Relay Discovery & Liveness (RelayDiscoveryService, tests) — PR #70
- NIP-23 Long-form Content (Nip23Service, tests) — PR #71
- NIP-52 Calendar Events (Nip52Service, tests) — PR #72
- NIP-53 Live Activities (Nip53Service, tests) — PR #73
- NIP-32 Labeling (Nip32Service, tests) — PR #74
- NIP-71 Video Events (Nip71Service, tests) — PR #75
- NIP-88 Polls (Nip88Service, tests) — PR #76
- NIP-51 Lists (Nip51Service, tests) — PR #77
- NIP-45 Event Counts (Nip45Service + relay COUNT, tests) — PR #78
- NIP-50 Search Capability (filter.search + tests) — PR #79
- NIP-09 Event Deletion (relay support + test) — PR #80
- NIP-61 Nutzaps (NutzapService, tests) — PR #105

Priority now (do these before any other backlog):
- NIP-86 Relay Management API — admin/management events + relay limitations

Backlog (to be scheduled; implement with tests and update docs/SUPPORTED_NIPS.md):
| NIP | Title | Area |
|-----|-------|------|
| 03 | OpenTimestamps Attestations for Events | Integrity
| 07 | `window.nostr` capability for web browsers | Client API
| 08 | Handling Mentions | Core
| 09 | Event Deletion Request | Relay
| 12 | Generic Tag Queries | Core/Query
| 14 | Subject tag in Text events | Content
| 20 | Command Results | Relay
| 22 | Comment | Content
| 23 | Long-form Content | Content
| 24 | Extra metadata fields and tags | Content
| 26 | Delegated Event Signing | Auth
| 31 | Dealing with unknown event kinds | Core
| 32 | Labeling | Moderation
| 35 | Torrents | Media
| 36 | Sensitive Content / Content Warning | Moderation
| 37 | Draft Wraps | Content
| 38 | NIP-38 | Core
| 43 | Relay Access Metadata and Requests | Relay/Admin
| 45 | Event Counts | Aggregation
| 48 | Proxy Tags | Core
| 50 | Search Capability | Discovery
| 51 | Lists | Content
| 52 | Calendar Events | Content
| 53 | Live Activities | Realtime
| 55 | Android Signer Application | Mobile/Auth
| 56 | Reporting | Moderation
| 60 | Cashu Wallets | Payments |
| 61 | Nutzaps | Payments |
| 62 | Request to Vanish | Privacy
| 64 | Chess (Portable Game Notation) | Apps
| 66 | Relay Discovery and Liveness Monitoring | Discovery
| 68 | Picture-first feeds | Content
| 69 | Peer-to-peer Order events | Commerce
| 70 | Protected Events | Encryption
| 71 | Video Events | Media
| 72 | Moderated Communities (Reddit Style) | Governance
| 73 | External Content IDs | Linking
| 77 | Negentropy Syncing | Sync
| 84 | Highlights | Content
| 86 | Relay Management API | Relay/Admin |
| 88 | Polls | Content
| 92 | Media Attachments | Media
| 96 | NIP-96 | Media

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

Phase 3: DVM & Discovery
  ├─ Client: NIP-89 (app handlers, uses NIP-33)
  └─ Client: NIP-90 (DVM jobs, uses NIP-89 for discovery)

Phase 4: Encryption & Auth
  ├─ Client: NIP-44 (modern encryption)
  ├─ Relay: ConnectionManager
  └─ Relay: NIP-42 (auth)

Phase 5: Advanced
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
├── FollowListService.ts   # Follow list management (NIP-02)
├── RelayListService.ts    # Relay preferences (NIP-65)
├── HandlerService.ts      # App handler discovery (NIP-89)
├── DVMService.ts          # Data Vending Machine (NIP-90)
├── ZapService.ts          # Lightning Zaps (NIP-57)
└── RemoteSignerService.ts # Nostr Connect (NIP-46)
```

## Notes

- NIP-19 bech32 encoding is in `src/core/` since it's useful for both client display and relay admin
- FilterMatcher (currently in relay/) should be extracted to shared code for client-side filtering
- Each phase builds on the previous - don't skip ahead
- Client and relay can be worked on in parallel within the same phase
- Relay NIP registry: if a NIP is enforced by the relay (message handling, storage rules, policies, or NIP‑11 info), add a module under `src/relay/core/nip/modules/**` and register it in `src/relay/core/nip/modules/index.ts` so `supported_nips` is accurate via NipRegistry.
- Wrappers vs Services: wrappers in `src/wrappers/**` are convenience Promise APIs; core logic MUST live in Effect services/modules under `src/client/**`, `src/relay/core/**`, or `src/core/**`.

## Test Parity Policy

**All NIP implementations MUST maintain test parity with nostr-tools.**

### Reference

- nostr-tools repo: `~/code/nostr-tools`
- Test vectors: Copy any `.vectors.json` files to corresponding `src/` directories

### Requirements for Each NIP

1. **Review nostr-tools tests** before implementing or after completing a NIP
2. **Port all test cases** from nostr-tools, adapted for Effect patterns
3. **Use official test vectors** when available (e.g., `nip44.vectors.json`)
4. **Include cross-implementation tests** (e.g., decode values from go-nostr, habla.news)
5. **Test error cases** and invalid inputs thoroughly

### Test Checklist for NIPs

| NIP | nostr-tools Test File | Our Test File | Status |
|-----|----------------------|---------------|--------|
| NIP-01 Filters | `filter.test.ts` | `src/relay/FilterMatcher.test.ts` | ✅ Done |
| NIP-19 | `nip19.test.ts` | `src/core/Nip19.test.ts` | ✅ Done |
| NIP-42 | `nip42.test.ts` | `src/relay/core/nip/modules/Nip42Module.test.ts` | ✅ Done |
| NIP-44 | `nip44.test.ts` + vectors | `src/services/Nip44Service.test.ts` | ✅ Done |
| NIP-04 | `nip04.test.ts` | - | ⬜ Not planned |
| NIP-05 | `nip05.test.ts` | `src/client/Nip05Service.test.ts` | ⬜ Not started |
| NIP-28 | `nip28.test.ts` | `src/client/ChatService.test.ts` | ✅ Done |
| NIP-57 | `nip57.test.ts` | `src/client/ZapService.test.ts` | ✅ Done |

### Adding a New NIP

1. Check if nostr-tools has tests: `ls ~/code/nostr-tools/nip*.test.ts`
2. Copy any test vector files
3. Port all test cases before marking the NIP complete
4. Update this checklist

See issue #36 for the initial test parity work.
