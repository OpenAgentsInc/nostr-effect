# nostr-effect

Nostr relay & client library built with [Effect](https://effect.website/). Work in progress.

Building both sides of the protocol in tandem - using each to test the other.

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
