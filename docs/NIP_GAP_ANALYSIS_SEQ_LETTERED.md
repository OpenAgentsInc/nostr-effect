# Sequential NIP Gap Analysis — Batch 7: Lettered NIPs

**Date:** 2026-07-20  
**Series:** Sequential full-repo scan (final batch)  
**Prior:** `NIP_GAP_ANALYSIS_SEQ_84_99.md`

## Batch summary

| NIP | Title | Claimed | Grade | Top gap |
| --- | --- | --- | --- | --- |
| 5A | Static Websites (nsites) | **no** | **Missing** | Manifest events + Blossom hosting |
| 7D | Forum threads | yes | **Mostly OK** | Force reply-to-root |
| A0 | Voice messages | yes | **Mostly OK** | Client + module |
| A4 | Public messages | **no** | **Missing** | Kind 24 public messages |
| B0 | Web bookmarking | yes | **Mostly OK** | Kind 39701 |
| B7 | Blossom media | yes | **Partial** | Service present; tests thin / BUD completeness |
| BE | BLE communications | yes (unrec.) | **Legacy/Niche** | Spec needs review upstream |
| C0 | Code snippets | yes | **Mostly OK** | Kind 1337 |
| C7 | Chats | yes | **Mostly OK** | Kind 9 + `q` |
| CC | Geocaching | **no** | **Missing** | Location events |
| EE | MLS E2EE | yes (unrec.) | **Legacy** | Superseded by Marmot note upstream |
| F4 | Podcasts | **no** | **Missing** | Podcast metadata/episodes |

Also claimed outside upstream: **SB** Remote Sandbox (OpenAgents) — not an upstream NIP.

---

## NIP-5A — Static websites (nsites)

**Missing.** Uses Blossom assets + site manifests (`15128`/`35128` per prior audit). Adjacent to B7. **P2** if hosting product; else backlog.

---

## NIP-7D — Forum threads

Kind 11 + NIP-22 comments. **Mostly OK.** Guard nested replies.

---

## NIP-A0 — Voice messages

Client service + relay module + tests. **Mostly OK.** Re-diff tags vs latest A0.md if needed.

---

## NIP-A4 — Public messages

**Missing.** Kind 24 public messages to receivers via `p` + NIP-65 routing. Distinct from NIP-17 DMs and NIP-C7. **P2** social clients.

---

## NIP-B0 — Web bookmarking

Kind 39701 addressable by URL `d`. **Mostly OK.**

---

## NIP-B7 — Blossom

**Code:** `BlossomService.ts`, `nipb7.ts` — upload/download/list/delete + BUD-02 auth.  

### Gaps

| Item | Sev | Detail |
| --- | --- | --- |
| Automated tests | **P2** | SUPPORTED_NIPS lists tests as “—”. |
| BUD-03 server list 10063 | **P2** | Discovery helpers optional. |
| Full BUD matrix | **P2** | Spot-check vs latest Blossom BUDs. |

**Grade: Partial** (usable, not fully hardened)

---

## NIP-BE — BLE transport

Unrecommended (unclear). Fragmentation + DEFLATE helpers with tests. **Niche/Legacy.**

---

## NIP-C0 — Code snippets

Kind 1337 + tags. **Mostly OK.**

---

## NIP-C7 — Chats

Kind 9 + quote `q`. **Mostly OK.** Prefer for public chat streams.

---

## NIP-CC — Geocaching

**Missing.** 37515/37516 + geohash; multi-char filter examples stress open tag filters. **P3** unless product.

---

## NIP-EE — MLS E2EE

KeyPackage/Welcome/relays list. Upstream notes superseded by Marmot. **Legacy** — do not position as preferred E2EE.

---

## NIP-F4 — Podcasts

**Missing.** Podcast metadata/episode/list kinds. **P2** media clients.

---

## Batch 7 backlog

1. **P1** Missing: 85 (already batch 6), 67 (batch 5).  
2. **P2** Missing lettered: A4, 5A, F4, CC (product-driven).  
3. **P2** B7 test coverage + BUD-03.  
4. **Docs** Mark EE/BE unrecommended; prefer modern stacks.

---

## End of sequential scan

All upstream root NIP files have been covered in batches 1–7 (plus thematic docs for payments and chat/reputation).

### Global missing upstream NIPs (not claimed)

| NIP | Title | Suggested priority |
| --- | --- | --- |
| 67 | EOSE completeness | **P1** relay quality |
| 85 | Trusted Assertions | **P1** reputation |
| 5A | Static websites | P2 |
| A4 | Public messages | P2 |
| CC | Geocaching | P3 |
| F4 | Podcasts | P2 |

### Global P0/P1 fix themes (all batches)

1. **NIP-01 open single-letter tag filters** (unblocks 12, 32, 61, 69, 29 `#h`, …)  
2. **NIP-58 / kinds.ts profile badges → 10008** + badge sets  
3. **NIP-98 signature verification**  
4. **NIP-09 `a` deletion**  
5. **NIP-16 ephemeral broadcast-only**  
6. **NIP-67 EOSE hints**  
7. **NIP-85 Trusted Assertions**  
8. **NIP-47 NIP-44 + hold invoices**  
9. **NIP-57 zap receipt validation**  
10. **NIP-29 metadata/moderation catch-up**
