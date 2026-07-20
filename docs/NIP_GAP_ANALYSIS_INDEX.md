# NIP Gap Analysis — Index

**Last updated:** 2026-07-20  
**Upstream NIPs:** `/Users/christopherdavid/work/projects/repos/nips` @ `bdfa7e6`  
**Method:** Spec-to-code review against `docs/SUPPORTED_NIPS.md` and implementation entry points.

## Thematic passes (earlier)

| Doc | Scope |
| --- | --- |
| [NIP_GAP_ANALYSIS_01_PAYMENTS.md](./NIP_GAP_ANALYSIS_01_PAYMENTS.md) | NIP-01 filters + marketplace/Lightning (15,47,57,60,61,69,75,87,99) |
| [NIP_GAP_ANALYSIS_CORE_CHAT_REPUTATION.md](./NIP_GAP_ANALYSIS_CORE_CHAT_REPUTATION.md) | Core relay (09–70), chat/groups (10–29,C7,7D,17,22), reputation (25,32,56,58,72,85) |
| [NIP_PARITY_GAP_ANALYSIS.md](./NIP_PARITY_GAP_ANALYSIS.md) | Older full-repo snapshot (2026-06-09) |

## Sequential batches (numeric order)

| Batch | Doc | NIPs |
| --- | --- | --- |
| 1 | [NIP_GAP_ANALYSIS_SEQ_01_15.md](./NIP_GAP_ANALYSIS_SEQ_01_15.md) | 01–15 |
| 2 | [NIP_GAP_ANALYSIS_SEQ_16_30.md](./NIP_GAP_ANALYSIS_SEQ_16_30.md) | 16–30 |
| 3 | [NIP_GAP_ANALYSIS_SEQ_31_45.md](./NIP_GAP_ANALYSIS_SEQ_31_45.md) | 31–45 (no 41) |
| 4 | [NIP_GAP_ANALYSIS_SEQ_46_60.md](./NIP_GAP_ANALYSIS_SEQ_46_60.md) | 46–60 |
| 5 | [NIP_GAP_ANALYSIS_SEQ_61_78.md](./NIP_GAP_ANALYSIS_SEQ_61_78.md) | 61–78 (no 63/74/76; **67 missing**) |
| 6 | [NIP_GAP_ANALYSIS_SEQ_84_99.md](./NIP_GAP_ANALYSIS_SEQ_84_99.md) | 84–99 |
| 7 | [NIP_GAP_ANALYSIS_SEQ_LETTERED.md](./NIP_GAP_ANALYSIS_SEQ_LETTERED.md) | 5A, 7D, A0, A4, B0, B7, BE, C0, C7, CC, EE, F4 |

## Grades legend

| Grade | Meaning |
| --- | --- |
| Strong | Spec-aligned with good tests |
| Mostly OK | Usable; minor gaps |
| Partial | Claimed but incomplete semantics |
| Stale | Implements outdated shape of current spec |
| Legacy OK | Present but unrecommended; keep for interop |
| Missing | No implementation |

## Top cross-cutting work (implementation order)

1. Open single-letter `#` tag filters (NIP-01/12)  
2. NIP-58 Profile Badges → 10008 + Badge Sets 30008  
3. NIP-98 verify signatures  
4. NIP-09 `a`-tag deletion  
5. NIP-16 ephemeral not stored  
6. NIP-67 EOSE `finish`/`more`  
7. NIP-85 Trusted Assertions  
8. NIP-47 NIP-44 encryption + hold invoices  
9. NIP-57 Appendix F/G  
10. NIP-29 groups catch-up  
