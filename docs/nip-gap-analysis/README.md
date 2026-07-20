# NIP Gap Analysis

**Last updated:** 2026-07-20  
**Status:** **100% of tracked parity backlog complete** (upstream NIPs + OpenAgents draft kind surfaces).

Canonical support table: [`docs/SUPPORTED_NIPS.md`](../SUPPORTED_NIPS.md).

## Method

Compare upstream NIP text (`~/work/projects/repos/nips`) and OpenAgents drafts (`~/work/openagents/docs/nips`) to code under `src/`.

## Completion summary

### Phases A–E (earlier)

- Identity floor (NIP-06/98) + IdentityKeys façade  
- Open single-letter `#` filters, ephemeral no-store, NIP-09 `a` delete  
- NIP-58 10008/30008, NIP-67 EOSE, NIP-85, NIP-47 NIP-44/hold  
- NIP-57 F/G, NIP-25 a/k/17, NIP-50 extensions, lettered A4/5A/F4/CC  

### Phase F — final polish (this completion)

| Item | Status |
| --- | --- |
| NIP-29 full moderation builders (9000–9010) + LiveKit endpoints + 39004/39005 parse + `Nip29Module` | **Done** |
| NIP-50 quality ranking (`scoreSearchResult` / `rankSearchResults`) | **Done** |
| NIP-11 client `RelayInformation` aligned with relay (`banner`/`self`/terms/…) | **Done** |
| NIP-18 `q` quote tags + addressable `a` on generic repost | **Done** |
| NIP-30 emoji set-address 4th tag param | **Done** |
| OpenAgents drafts SA/AC/SKL/TRN/LBR/DS kind surfaces (`OpenAgentsDrafts.ts`) | **Done** |

### Intentionally out of “protocol complete”

These are product/runtime concerns, not missing library primitives:

- Full relay-side enforcement of every NIP-29 admin policy / LiveKit JWT minting server  
- Paid-relay settlement integrations beyond NIP-11 fee document fields  
- OpenAgents marketplace runtime (only protocol kinds/templates in this repo)

## OpenAgents drafts

| Spec | Code |
| --- | --- |
| SA / AC / SKL / TRN | `src/core/OpenAgentsDrafts.ts` → `nostr-effect/openagents-drafts` |
| LBR / DS | `src/core/Nip90.ts` + re-exports in OpenAgentsDrafts |

## Preferred stacks

| Use case | Prefer |
| --- | --- |
| Private DM | NIP-17 |
| Groups | NIP-29 |
| Badges | NIP-58 (10008) |
| Reputation | NIP-85 |
| Marketplace | NIP-99 |
| Files | NIP-B7 |

---

Related: [IDR #9092 identity](../IDR_9092_NIP_PARITY_ROADMAP.md) · [IDENTITY.md](../IDENTITY.md)
