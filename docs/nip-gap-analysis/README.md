# NIP Gap Analysis

**Last updated:** 2026-07-20  
**Upstream NIPs clone:** `/Users/christopherdavid/work/projects/repos/nips` @ `bdfa7e6`  
**Repo reviewed against:** `docs/SUPPORTED_NIPS.md` + implementation entry points  
**Status:** Analysis only — not an implementation checklist for every NIP.

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
| [sequential/61-78.md](./sequential/61-78.md) | NIPs 61–78 (incl. missing 67) |
| [sequential/84-99.md](./sequential/84-99.md) | NIPs 84–99 (incl. missing 85) |
| [sequential/lettered.md](./sequential/lettered.md) | 5A, 7D, A0–F4 |
| [file-map.md](./file-map.md) | Code entry-point map |

---

## Method

- Compare current upstream NIP text to claimed support in `SUPPORTED_NIPS.md` and real code under `src/`.
- Grades: **Strong** · **Mostly OK** · **Partial** · **Stale** · **Legacy OK** · **Missing**.
- Severity: **P0** blocker · **P1** high · **P2** medium · **P3** polish.
- Upstream **unrecommended** is treated as a product signal (keep interop, do not expand).

---

## Global summary

Most claimed NIPs have *some* code surface (kinds, builders, or services). Risk is **semantic under-implementation**: helpers exist, but filters, encryption, deletion, badges, groups, and zap/receipt validation lag the current specs.

Cross-cutting P0: `Filter` in `src/core/Schema.ts` only models `#e/#p/#a/#d/#t`. NIP-01 expects all single-letter tags. Extra `#` keys (e.g. `#u`, `#L`, `#l`, `#h`) are **silently stripped** by `decodeFilter`.

---

## Missing upstream NIPs

| NIP | Title | Priority | Notes |
| --- | --- | --- | --- |
| 67 | EOSE Completeness Hint | **P1** | Optional `finish`/`more` on EOSE |
| 85 | Trusted Assertions | **P1** | Kinds 30382–30385 + 10040 |
| 5A | Static Websites (nsites) | P2 | Adjacent to Blossom |
| A4 | Public Messages | P2 | Kind 24 |
| F4 | Podcasts | P2 | Media clients |
| CC | Geocaching Events | P3 | Needs open tag filters |

---

## Priority backlog

1. **P0** Open single-letter `#` tag filters (NIP-01/12) — unblocks 32, 61, 69, 29, …
2. **P0** NIP-58 Profile Badges → kind **10008**; Badge Sets **30008**; fix `kinds.ts`
3. **P0** NIP-98 verify event signature + hash raw body
4. **P1** NIP-09 `a`-tag multi-version deletion
5. **P1** NIP-16 ephemeral broadcast-only (do not store)
6. **P1** NIP-67 EOSE completeness hints
7. **P1** NIP-85 Trusted Assertions service
8. **P1** NIP-47 NIP-44 encryption + hold invoices
9. **P1** NIP-57 Appendix F receipt validation + Appendix G zap splits
10. **P1** NIP-29 groups metadata/moderation catch-up
11. **P2** NIP-11 client type alignment with relay schema
12. **P2** NIP-50 search extensions / ranking
13. **P2** NIP-25 `a`/`k`/kind 17; NIP-24 `bot`/`birthday`
14. **P2** Missing lettered (A4, 5A, F4, CC) as product needs

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
| Display badges | NIP-58 (after fix) | deprecated 30008 profile_badges |
| Aggregated reputation | NIP-85 (to implement) | ad-hoc schemas |
| E2EE messaging | not EE (superseded) | NIP-EE as preferred |

Unrecommended but kept for interop: 03, 04, 06, 08, 15, 26, 28, 31, 72, 90, 96, BE, EE.

---

---

## Next steps

Start implementation from the **Priority backlog** above (P0 open tag filters first). Sequential files are the NIP-by-NIP record; deep dives have extra context for high-risk areas.

