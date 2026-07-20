# NIP Gap Analysis

**Last updated:** 2026-07-20  
**Upstream NIPs clone:** `/Users/christopherdavid/work/projects/repos/nips`  
**Repo reviewed against:** `docs/SUPPORTED_NIPS.md` + implementation entry points  
**Status:** Major parity backlog closed. Remaining work is product-depth polish on large NIPs (29 full moderation matrix, 50 ranking, etc.).

Folder layout for the full NIP compliance audit of `nostr-effect`.

## Contents

| File | What |
| --- | --- |
| [README.md](./README.md) | Method, summary, missing NIPs, priorities, product stacks |
| [deep-dives.md](./deep-dives.md) | Cross-cutting deep dives (filters, payments, relay, chat, reputation) |
| [sequential/01-15.md](./sequential/01-15.md) | NIPs 01–15 |
| [sequential/16-30.md](./sequential/16-30.md) | NIPs 16–30 |
| [sequential/31-45.md](./sequential/31-45.md) | NIPs 31–45 |
| [sequential/46-60.md](./sequential/46-60.md) | NIPs 46–60 |
| [sequential/61-78.md](./sequential/61-78.md) | NIPs 61–78 |
| [sequential/84-99.md](./sequential/84-99.md) | NIPs 84–99 |
| [sequential/lettered.md](./sequential/lettered.md) | 5A, 7D, A0–F4 |
| [draft-openagents.md](./draft-openagents.md) | OpenAgents drafts: SA, AC, SKL, LBR, DS, TRN |
| [file-map.md](./file-map.md) | Code entry-point map |

---

## Method

- Compare current upstream NIP text to claimed support in `SUPPORTED_NIPS.md` and real code under `src/`.
- Grades: **Strong** · **Mostly OK** · **Partial** · **Stale** · **Legacy OK** · **Missing**.
- Severity: **P0** blocker · **P1** high · **P2** medium · **P3** polish.
- Upstream **unrecommended** is treated as a product signal (keep interop, do not expand).

---

## Global summary

Foundation P0/P1 gaps (open tag filters, ephemeral storage, NIP-58 kinds, NIP-98, NIP-67, NIP-85, NIP-47 NIP-44, NIP-57 F/G, missing lettered A4/5A/F4/CC) are implemented. Remaining risk is **depth** on large product surfaces (full NIP-29 moderation/LiveKit, NIP-50 quality ranking, OpenAgents drafts).

Cross-cutting: `Filter` accepts all single-letter `#a-zA-Z` tag filters (NIP-01/12).

---

## Missing upstream NIPs

| NIP | Title | Priority | Notes |
| --- | --- | --- | --- |
| — | — | — | Former missing 67/85/A4/5A/F4/CC now in `SUPPORTED_NIPS.md` |

## OpenAgents draft NIPs (not upstream)

Six living drafts live at `~/work/openagents/docs/nips/` (SA, AC, SKL, LBR, DS, TRN).  
Roadmap status: **postponed**. Full gap analysis: [draft-openagents.md](./draft-openagents.md).

| Spec | Grade here | One-liner |
| --- | --- | --- |
| LBR | Partial | Labor kinds in `Nip90.ts` |
| DS | Partial | Dataset kinds in `Nip90.ts` |
| SKL / SA / AC / TRN | Missing | No dedicated services |

---

## Priority backlog

### Done (Phases A–E)

1. ~~P0 open single-letter `#` filters~~  
2. ~~P0 NIP-58 Profile Badges 10008 / Badge Sets 30008~~  
3. ~~P0 NIP-98 verify + body hash~~  
4. ~~P1 NIP-09 `a`-tag deletion~~  
5. ~~P1 NIP-16 ephemeral broadcast-only~~  
6. ~~P1 NIP-67 EOSE finish/more~~  
7. ~~P1 NIP-85 Trusted Assertions~~  
8. ~~P1 NIP-47 NIP-44 + hold invoices~~  
9. ~~P1 NIP-57 Appendix F/G~~  
10. ~~P1 NIP-29 metadata flags + moderation helpers~~  
11. ~~P2 NIP-50 search extensions~~  
12. ~~P2 NIP-25 `a`/`k`/kind 17~~  
13. ~~P2 lettered A4, 5A, F4, CC~~  

### Remaining polish (not blockers)

- **P2** NIP-29 full moderation matrix (9000–9022) + LiveKit JWT + policy module  
- **P2** NIP-50 quality ranking of search results  
- **P2** NIP-11 client type alignment with relay schema  
- **P3** NIP-18 `q` builders; NIP-30 set-address param; OpenAgents drafts  

---

## Preferred stacks (product guidance)

| Use case | Prefer | Avoid for new work |
| --- | --- | --- |
| Private DM | NIP-17 | NIP-04 |
| Public stream chat | NIP-C7 | NIP-28 |
| Closed groups | NIP-29 | NIP-72 / NIP-28 |
| Forum threads | NIP-7D + NIP-22 | Kind-1 nest only |
| Marketplace listings | NIP-99 | NIP-15 |
| File storage | NIP-B7 Blossom | NIP-96 |
| Labels / reports | NIP-32 / NIP-56 | — |
| Display badges | NIP-58 (10008) | deprecated 30008 profile_badges |
| Aggregated reputation | NIP-85 | ad-hoc schemas |
| E2EE messaging | not EE (superseded) | NIP-EE as preferred |

Unrecommended but kept for interop: 03, 04, 06, 08, 15, 26, 28, 31, 72, 90, 96, BE, EE.

---

## Related roadmaps

- **OpenAgents #9092 sovereign identity** (BIP-39 Nostr + Spark): [IDR roadmap](../IDR_9092_NIP_PARITY_ROADMAP.md) + [Identity façade](../IDENTITY.md) (`nostr-effect/identity`).
