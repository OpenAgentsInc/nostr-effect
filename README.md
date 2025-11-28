# nostr-effect

Nostr relay & client library built with [Effect](https://effect.website/). Work in progress.

Building both sides of the protocol in tandem - using each to test the other.

## Status

### Core
- [x] Schema.ts (NIP-01 event types, filters, messages)
- [x] Errors.ts (typed error classes)
- [x] Nip19.ts (bech32 encoding: npub/nsec/note/nprofile/nevent/naddr)

### Relay (NIP-01)
- [x] EventStore (SQLite via bun:sqlite)
- [x] SubscriptionManager
- [x] MessageHandler (EVENT, REQ, CLOSE → OK, EOSE)
- [x] RelayServer (Bun.serve WebSocket)
- [x] PolicyPipeline (composable event validation)
- [x] NIP-16/33 Replaceable Events
- [x] NIP-11 Relay Information Document
- [ ] NIP module system

### Client
- [x] CryptoService (keys, signing, verification)
- [x] EventService (create, verify)
- [x] RelayService (WebSocket connection management)
- [x] FollowListService (NIP-02 follow lists)
- [x] RelayListService (NIP-65 relay list metadata)
- [ ] RelayPool (multi-relay)

### Future
NIP-05, NIP-44, NIP-46, DVMs
