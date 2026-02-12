# NIP Effect Layer Test Coverage Audit (nostr-effect-997.3)

## Summary

Catalog of NIP services lacking full `Effect.runPromise(service.method)` test harness mirroring pure wrapper helpers.

**Methodology:**
- Check src/client/Nip*.Service.test.ts for Effect.gen / yield* service calls
- Compare to src/wrappers/nip*.test.ts pure functions
- Focus on fetch/parse/validate logic (create* tests common, not primary)

## Missing / Partial Coverage (Scheduled)

| Service | Missing Methods | Wrapper Parity | Bead |
|---------|-----------------|---------------|------|
| Nip17Service | fetchThread(eventId): success/404/parse error | nip17/nip10 pure | [997.4](.beads/nostr-effect-997.4) |
| Nip25Service | reaction parsing/aggregation/counts | nip25 pure | [997.5](.beads/nostr-effect-997.5) |
| Nip51Service | list parsing/filtering | nip84/nip51 pure | [997.6](.beads/nostr-effect-997.6) |
| Nip58Service | badge fetch/parse/validate | NIP-58 JSON mock | [997.7](.beads/nostr-effect-997.7) |

## Complete Coverage

| Service | Tests |
|---------|-------|
| Nip05Service | fetch .well-known/nostr.json (mock fetch, errors) [997.1] |
| Nip10Service | reply threading |
| Nip18Service | reposts |
| Nip23Service | long-form |
| Nip32Service | labeling |
| Nip38Service | statuses |
| Nip39Service | identities |
| Nip45Service | counts |
| Nip46Service | Nostr Connect |
| Nip50Service | search |
| Nip52Service | calendar |
| Nip53Service | live activities |
| Nip71Service | video |
| Nip77Service | negentropy |
| Nip88Service | polls |
| ... (non-NIP or create-only) | AppData, Cashu, Chat, etc. |

## Relay Modules

Added unit tests for:
- Nip09Module (deletion)
- Nip15Module 
- Nip20Module (commands)
- Nip40Module (expiry policy)
- Nip45Module (counts? )
- Nip57Module (zaps)
- Nip62Module (vanish)

All pass config/policy validation.

## Recommendations

1. Implement scheduled beads 997.4-7
2. Audit remaining Nip*Services for fetch/parse gaps
3. 100% wrapper-service test parity for core NIPs

🤖 Audit by MechaCoder