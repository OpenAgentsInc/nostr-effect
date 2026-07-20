# Sequential NIP Gap Analysis — Batch 6: NIPs 84–99

**Date:** 2026-07-20  
**Series:** Sequential full-repo scan  
**Note:** Upstream numbering skips several (79–83, 91, 93, 95, 97).

## Batch summary

| NIP | Title | Claimed | Grade | Top gap |
| --- | --- | --- | --- | --- |
| 84 | Highlights | yes | **Mostly OK** | Kind highlight + labels |
| 85 | Trusted Assertions | **no** | **Missing** | 30382–30385 + 10040 |
| 86 | Relay Management API | yes | **Mostly OK** | HTTP management API |
| 87 | Ecash mint discoverability | yes | **Mostly OK** | 38000/38172/38173 |
| 88 | Polls | yes | **Mostly OK** | Single/multi choice |
| 89 | Recommended app handlers | yes | **Mostly OK** | HandlerService |
| 90 | Data Vending Machines | yes (unrec.) | **Legacy OK** | Broad DVM surface |
| 92 | Media attachments (`imeta`) | yes | **Mostly OK** | Tag helpers |
| 94 | File metadata | yes | **Mostly OK** | Kind 1063-style metadata |
| 96 | HTTP file storage | yes (unrec.) | **Legacy OK** | Prefer Blossom B7 |
| 98 | HTTP auth | yes | **Partial** | Signature not verified in validateEventFull |
| 99 | Classified listings | yes | **Mostly OK** | Prefer over 15; status/g polish |

---

## NIP-84 — Highlights

**Code:** `nip84.ts` build/sign highlights with e/r/labels. **Mostly OK.**

---

## NIP-85 — Trusted Assertions (**MISSING**)

Kinds 30382–30385 + provider prefs 10040. **P1** for reputation. See reputation thematic §3.4.

---

## NIP-86 — Relay Management API

**Code:** `Nip86Module` + BunServer HTTP management; tests.  

### Gaps

| Item | Sev | Detail |
| --- | --- | --- |
| Method completeness | **P2** | Diff methods vs latest 86.md (ban, allowlist, stats, etc.). |

**Grade: Mostly OK**

---

## NIP-87 — Mint discoverability

Cashu/Fedimint info + recommendations. **Mostly OK.**

---

## NIP-88 — Polls

Single/multiple choice with response dedup. **Mostly OK.**

---

## NIP-89 — Recommended application handlers

**Code:** `HandlerService`. **Mostly OK.**

---

## NIP-90 — DVMs

Unrecommended (too broad). DVMService job request/subscribe/cancel. **Legacy OK.**

---

## NIP-92 — Media attachments (`imeta`)

Tag helpers for media metadata. **Mostly OK.** Used with 68/71.

---

## NIP-94 — File metadata

Core + wrapper. **Mostly OK.**

---

## NIP-96 — HTTP file storage

Unrecommended → Blossom. Upload/delete/poll. **Legacy OK.** Prefer NIP-B7.

---

## NIP-98 — HTTP auth

**Code:** `Nip98.ts`  

### Gaps

| Item | Sev | Detail |
| --- | --- | --- |
| Signature verification | **P0** | `validateEventFull` comments that sig is assumed valid — not verified. |
| Payload hash over raw body | **P1** | Hashes object stringify, not request bytes. |

**Grade: Partial** · security-sensitive.

---

## NIP-99 — Classified listings

30402/30403. **Mostly OK** with softer validation / status / geohash polish (payments doc).

---

## Batch 6 backlog

1. **P0** NIP-98 signature + body hash.  
2. **P1** NIP-85 service.  
3. **P2** NIP-86 method re-diff.

## Next

**Batch 7:** Lettered NIPs (5A, 7D, A0, A4, B0, B7, BE, C0, C7, CC, EE, F4).
