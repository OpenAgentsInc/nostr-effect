# nostr-effect

A type-safe, composable Nostr library built with [Effect](https://effect.website/).

## Why Effect?

- **Typed errors** - No `catch (e: unknown)`
- **Resource safety** - WebSocket connections and subscriptions automatically cleaned up
- **Composability** - Services and layers that mix and match
- **Cross-runtime** - Works on Node, Bun, Deno, and browsers

## Implementation Status

### NIP-01: Basic Protocol
- [x] Event structure (id, pubkey, created_at, kind, tags, content, sig)
- [x] Event ID computation (SHA256 of serialized event)
- [x] Schnorr signatures (secp256k1)
- [x] Key generation and derivation
- [x] Filter schema with tag queries (#e, #p, #a, #d, #t)
- [x] Client messages (EVENT, REQ, CLOSE)
- [x] Relay messages (EVENT, OK, EOSE, CLOSED, NOTICE)
- [ ] Relay connection service
- [ ] Subscription management

### Services
- [x] **CryptoService** - Key generation, signing, verification, hashing
- [x] **EventService** - Create, sign, and verify events
- [ ] **RelayService** - WebSocket connections, message handling
- [ ] **PoolService** - Multi-relay coordination

### Future NIPs
- [ ] NIP-19: bech32-encoded entities (npub, nsec, note, nprofile, nevent)
- [ ] NIP-05: DNS-based verification
- [ ] NIP-44: Encrypted direct messages
- [ ] NIP-57: Zaps (Lightning payments)

## Roadmap

Implementing NIPs across phases: encoding/identity (NIP-19, NIP-05, NIP-06), encryption (NIP-44, NIP-17), social features (profiles, reactions, follows, threading, chat), payments (zaps, wallet connect), and AI/agent support (DVMs, app handlers).
