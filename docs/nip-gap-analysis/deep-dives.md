# NIP Gap Analysis — Deep Dives

**Last updated:** 2026-07-20 (refreshed after parity 100% + depth batch G)

Historical thematic notes. **Authoritative status** is `docs/SUPPORTED_NIPS.md` + `docs/nip-gap-analysis/README.md`.

## Payments

| NIP | Grade | Notes |
| --- | --- | --- |
| 15 Marketplace | Legacy OK | Prefer NIP-99; stall/product remain for interop |
| 47 NWC | **Mostly OK** | Default **NIP-44**, hold invoices, encrypt negotiate |
| 57 Zaps | **Mostly OK** | Appendix F/G (`validateZapReceipt`, zap splits) |
| 60 Cashu | Mostly OK | NIP-44 encrypted wallet events |
| 61 Nutzaps | **Mostly OK** | `#u` filters work; redeem prefers NIP-44 history |
| 69 P2P | Mostly OK | Open tag filters unblocked |
| 99 Classifieds | Mostly OK | Preferred marketplace |

## Relay core

| NIP | Grade | Notes |
| --- | --- | --- |
| 01/12 Filters | **Strong** | Open single-letter `#` tags |
| 09 Deletion | **Mostly OK** | `e` + `a` multi-version delete |
| 11 Relay info | **Mostly OK** | Client aligned with relay (`banner`/`self`/terms) |
| 16/33 Treatment | **Mostly OK** | Ephemeral broadcast-only |
| 29 Groups | **Mostly OK** | Metadata flags, full moderation builders, LiveKit well-known + JWT mint on Bun |
| 67 EOSE | **Mostly OK** | `finish`/`more` hints |

## Social / reputation

| NIP | Grade | Notes |
| --- | --- | --- |
| 25 Reactions | **Mostly OK** | `a`/`k` + kind 17 external |
| 32 Labeling | Mostly OK | `#L`/`#l` filterable |
| 58 Badges | **Mostly OK** | Profile 10008 / sets 30008 |
| 85 Assertions | **Mostly OK** | Client service + wrappers |

## Media / lettered

| NIP | Grade | Notes |
| --- | --- | --- |
| B7 Blossom | **Mostly OK** | Upload/download + BUD-03 server list helpers |
| A4 / 5A / F4 / CC | **Mostly OK** | Client builders shipped |

## OpenAgents drafts

SA/AC/SKL/TRN/LBR/DS: kind surfaces + templates in `src/core/OpenAgentsDrafts.ts` (`nostr-effect/openagents-drafts`). Runtime marketplaces remain out of scope for this library.
