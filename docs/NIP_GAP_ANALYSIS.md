# NIP Gap Analysis

**Last updated:** 2026-07-20  
**Upstream NIPs clone:** `/Users/christopherdavid/work/projects/repos/nips` @ `bdfa7e6`  
**Repo reviewed against:** `docs/SUPPORTED_NIPS.md` + implementation entry points  
**Status:** Consolidated single-file audit (thematic + sequential passes). Analysis only.

This document is the **single source of truth** for NIP compliance gaps in `nostr-effect`.

## Table of contents

1. [Method](#method)
2. [Global summary](#global-summary)
3. [Missing upstream NIPs](#missing-upstream-nips)
4. [Priority backlog](#priority-backlog)
5. [Preferred stacks (product guidance)](#preferred-stacks-product-guidance)
6. [Deep dives](#deep-dives)
   - [NIP-01 filters (cross-cutting)](#deep-dive-nip-01-filters)
   - [Marketplace and Lightning](#deep-dive-marketplace-and-lightning)
   - [Core relay (09–70)](#deep-dive-core-relay)
   - [Chat and groups](#deep-dive-chat-and-groups)
   - [Reputation](#deep-dive-reputation)
7. [Sequential coverage (all NIPs)](#sequential-coverage-all-nips)
8. [File map](#file-map)

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

## Deep dives

### Deep dive: NIP-01 filters

**Code:** `src/core/Schema.ts` (`Filter`), `src/relay/core/FilterMatcher.ts`

NIP-01: all single-letter English tags (`a–z`, `A–Z`) are expected to be indexable as `#<letter>`; only the first value of each tag is indexed.

Today only `#e`, `#p`, `#a`, `#d`, `#t` are modeled. `FilterMatcher` only evaluates that set.

Verified: `decodeFilter({ kinds: [9321], "#u": ["https://mint"] })` succeeds and **drops `#u`**. Same for `#L` / `#l` (NIP-32).

Also: matcher uses **prefix** match on `ids`/`authors`; NIP-01 says exact 64-char lowercase hex.

**Acceptance:** any `#X` single-letter filter works schema → matcher → store → client; document exact-vs-prefix policy.

---

### Deep dive: Marketplace and Lightning

| NIP | Grade | Notes |
| --- | --- | --- |
| 15 Marketplace | Partial / Legacy | Stall/product/auction yes; **no checkout** types 0–2 over NIP-04; unrecommended → 99 |
| 47 NWC | Partial | NIP-04 only; no `encryption` negotiate; hold-invoice methods incomplete; multi-relay URI singular |
| 57 Zaps | Partial | Request/receipt builders; **no validateZapReceipt (App F)**; no zap-split `zap` tags (App G); no LNURL HTTP client |
| 60 Cashu | Mostly OK | 17375/7375/7376 + rollover; strongest payment state path |
| 61 Nutzaps | Partial | Publish OK; `#u` stripped; redeem fallback may skip NIP-44 |
| 69 P2P orders | Mostly OK | Tags incl. expires_at; needs open filters for `#f/#s/#g` |
| 75 Zap goals | Mostly OK | Kind 9041; weak compose with ZapService |
| 87 Mints | Mostly OK | 38000/38172/38173 |
| 99 Classifieds | Mostly OK | Preferred marketplace; strict validation; status/g polish |

**Payments implementation order:** open filters → 57 F/G → 47 NIP-44 → 61 redeem → 99 polish → 15 leave legacy.

---

### Deep dive: Core relay

| NIP | Grade | Notes |
| --- | --- | --- |
| 09 Deletion | Partial | `e` delete OK; **no `a` bulk delete** up to created_at; `k` not required |
| 11 Relay info | Partial client / OK relay | RelayInfo has banner/self/terms; `src/core/Nip11.ts` lags |
| 16/33 Treatment | Partial | Replaceable/addressable OK; **ephemeral still stored** |
| 20 OK results | Mostly OK | Prefixes used; consistency polish |
| 40 Expiration | Mostly OK | Write reject; confirm query-path filter |
| 42 AUTH | Mostly OK | Challenge/verify + protected gate |
| 70 Protected | Mostly OK | Default reject `["-"]`; auth path |

---

### Deep dive: Chat and groups

| NIP | Grade | Notes |
| --- | --- | --- |
| 10 Threading | Mostly OK | Parse root/reply/q; legacy mention still accepted |
| 17 Private DM | Mostly OK | Seal/gift-wrap; 10050 inbox |
| 22 Comment | Mostly OK | Kind 1111 builders |
| 28 Public chat | Legacy OK | Full 40–44; unrecommended → 29 |
| 29 Groups | **Stale** | Only 39000/01/02 read; metadata tags wrong (`public`/`open` vs `private`/`closed`/`restricted`/`hidden`); missing subgroups, LiveKit, pins+`a`, join/invite, moderation 9000–9022, roles 39003–39005; no relay policy module |
| C7 Chats | Mostly OK | Kind 9 + `q` |
| 7D Threads | Mostly OK | Kind 11 + NIP-22 |

**NIP-29 is the largest chat gap** if groups are in product.

---

### Deep dive: Reputation

| NIP | Grade | Notes |
| --- | --- | --- |
| 25 Reactions | Partial | Missing `a`/`k`; no kind 17 external |
| 32 Labeling | Partial | Publish OK; **`#L`/`#l` queries no-op** |
| 56 Reporting | Mostly OK | Profile/note/blob templates |
| 58 Badges | **Stale** | Profile badges still 30008+`profile_badges`; should be **10008**; Badge Sets missing |
| 72 Communities | Legacy OK | Prefer 29 |
| 85 Assertions | **Missing** | WoT/rank offload |

---

## Sequential coverage (all NIPs)

### Batch: NIPs 01–15

## Batch summary

| NIP | Title | Upstream | Claimed | Grade | Top gap |
| --- | --- | --- | --- | --- | --- |
| 01 | Basic protocol flow | mandatory | yes | **Partial** | Single-letter tag filters only `#e/#p/#a/#d/#t` |
| 02 | Follow list | final | yes | **Mostly OK** | Petname chain helpers optional |
| 03 | OpenTimestamps | unrecommended | yes | **Legacy OK** | Wrapper-only; keep legacy |
| 04 | Encrypted DMs | unrecommended → 17 | yes | **Legacy OK** | Crypto only; prefer NIP-17 |
| 05 | DNS identifiers | final | yes | **Mostly OK** | Local-part charset / `_@domain` display polish |
| 06 | Mnemonic keys | unrecommended | yes | **Mostly OK** | Keep as compatibility |
| 07 | `window.nostr` | draft | yes | **Mostly OK** | Types only (correct for browser extension host) |
| 08 | Mentions | unrecommended → 27 | yes | **Legacy OK** | Prefer NIP-27 |
| 09 | Deletion request | draft / relay | yes | **Partial** | No `a`-tag multi-version delete |
| 10 | Text notes / threads | draft | yes | **Mostly OK** | Legacy `mention` still parsed |
| 11 | Relay info document | draft / relay | yes | **Partial** | Client `Nip11.ts` lags relay schema |
| 12 | Generic tag queries | **moved → 01** | yes | **Partial** | Same as 01 filter gap |
| 13 | Proof of Work | draft / relay | yes | **Mostly OK** | Relay min-pow policy wiring optional |
| 14 | Subject tag | draft | yes | **Mostly OK** | Thin helpers; complete for scope |
| 15 | Marketplace | unrecommended → 99 | yes | **Partial** | No checkout types 0–2; prefer 99 |

**Batch P0/P1 themes:** open tag filters (01/12), NIP-09 `a` deletion, NIP-11 client types, marketplace positioning (15).

---

## NIP-01 — Basic protocol flow

**Spec:** `01.md` · `mandatory` `relay`  
**Code:** `src/core/Schema.ts`, `FilterMatcher.ts`, `MessageHandler.ts`, `Nip01Module.ts`  
**Tests:** `FilterMatcher.test.ts`, relay integration suite

### Present

- Event shape, Schnorr/`secp256k1`, id serialization path.
- Client→relay: `EVENT`, `REQ`, `CLOSE` (+ later NIPs).
- Relay→client: `EVENT`, `OK`, `EOSE`, `CLOSED`, `NOTICE`.
- Kind ranges: replaceable / ephemeral / addressable helpers align with NIP-01 bands.
- Signature verification policies in Nip01Module.

### Gaps

| Item | Sev | Detail |
| --- | --- | --- |
| Tag filter surface | **P0** | Filter schema hard-codes `#e,#p,#a,#d,#t`. NIP-01 expects all single-letter `a–zA–Z` keys indexed; only first tag value. |
| Prefix match on ids/authors | **P2** | Matcher uses `startsWith`; NIP-01 says exact 64-char lowercase hex for `ids`/`authors`/`#e`/`#p`. |
| EOSE extensions | **P2** | Two-element only; NIP-67 optional hints deferred. |
| Subscription id max 64 | **P3** | Confirm enforcement on REQ. |

### Acceptance

- [ ] Arbitrary `#X` single-letter filters end-to-end.
- [ ] Documented exact-vs-prefix policy.

---

## NIP-02 — Follow list

**Spec:** `02.md` · `final`  
**Code:** `src/client/FollowListService.ts`  
**Tests:** `FollowListService.test.ts`

### Present

- Kind 3 replaceable follow list.
- `p` tags with optional relay + petname.
- `getFollows` / `setFollows` / `addFollow` / `removeFollow` / `isFollowing`.
- Append-on-add behavior via fetch-then-publish.

### Gaps

| Item | Sev | Detail |
| --- | --- | --- |
| Petname chain resolution | **P3** | Spec describes multi-hop petname tables; not a library concern unless product wants it. |
| Empty content enforcement | **P3** | Spec: content unused; service may not force `""`. |

**Grade: Mostly OK**

---

## NIP-03 — OpenTimestamps attestations

**Spec:** unrecommended (attack surface)  
**Code:** `src/wrappers/nip03.ts`  
**Tests:** `nip03.test.ts`

### Present

- Kind 1040 builder with `e`/`k` + base64 OTS content.

### Gaps

| Item | Sev | Detail |
| --- | --- | --- |
| Upstream unrecommended | Product | Do not expand; document legacy. |
| OTS verify/attestation crypto | **P3** | Build/sign only; no full OTS validation library. |

**Grade: Legacy OK**

---

## NIP-04 — Encrypted direct messages

**Spec:** unrecommended → NIP-17  
**Code:** `src/core/Nip04.ts`, `src/wrappers/nip04.ts`  
**Tests:** `Nip04.test.ts`

### Present

- ECDH + AES-256-CBC encrypt/decrypt (ciphertext?iv= form).

### Gaps

| Item | Sev | Detail |
| --- | --- | --- |
| No kind-4 event service | **P3** | Crypto primitives only — fine; apps compose events. |
| Prefer NIP-17 | Product | Keep for NWC legacy + migration decrypt. |

**Grade: Legacy OK**

---

## NIP-05 — DNS-based identifiers

**Spec:** `05.md` · `final`  
**Code:** `src/client/Nip05Service.ts`, `src/wrappers/nip05.ts`  
**Tests:** `Nip05Service.test.ts`

### Present

- Fetch `/.well-known/nostr.json?name=…`
- `names` map validation against pubkey.
- Optional `relays` map in response type.
- `queryProfile` / reverse lookup / `isValid`.
- Identifier regex.

### Gaps

| Item | Sev | Detail |
| --- | --- | --- |
| Local-part charset | **P2** | Spec: only `a-z0-9-_.`; regex may be looser (`NIP05_REGEX`). |
| `_@domain` root display | **P3** | Spec: show as bare domain; helper optional. |
| CORS / CORS failure UX | Info | Network-dependent. |

**Grade: Mostly OK**

---

## NIP-06 — Key derivation from mnemonic

**Spec:** unrecommended (prefer single nsec)  
**Code:** `src/core/Nip06.ts`  
**Tests:** `Nip06.test.ts`

### Present

- BIP-39 mnemonic generate/validate.
- Path `m/44'/1237'/…` private key derivation.
- Account / extended key helpers.

### Gaps

| Item | Sev | Detail |
| --- | --- | --- |
| Upstream unrecommended | Product | Keep compatibility; don’t push as default UX. |

**Grade: Mostly OK (compatibility)**

---

## NIP-07 — `window.nostr`

**Spec:** `07.md` · draft  
**Code:** `src/wrappers/nip07.ts`  
**Tests:** `nip07.test.ts`

### Present

- TypeScript interface: `getPublicKey`, `signEvent`, optional `nip04` / `nip44`.
- Mock provider tests.

### Gaps

| Item | Sev | Detail |
| --- | --- | --- |
| Runtime provider | N/A | Correctly types-only; extension implements. |
| Newer optional methods | **P3** | Spot-check latest 07.md for added methods (e.g. `getRelays`) if any. |

**Grade: Mostly OK**

---

## NIP-08 — Handling mentions

**Spec:** unrecommended → NIP-27  
**Code:** `src/wrappers/nip08.ts`  
**Tests:** `nip08.test.ts`

### Present

- Build `#[index]` content + tag arrays for p/e mentions.

### Gaps

| Item | Sev | Detail |
| --- | --- | --- |
| Prefer NIP-27 | Product | Legacy interop only. |

**Grade: Legacy OK**

---

## NIP-09 — Event deletion request

**Spec:** `09.md` · relay  
**Code:** `MessageHandler.ts`, `Nip09Module.ts`  
**Tests:** `Nip09Deletion.test.ts`

### Present

- Kind 5; delete referenced `e` events only when same pubkey.
- Keep deletion event stored.
- Module advertises NIP 9.

### Gaps

| Item | Sev | Detail |
| --- | --- | --- |
| `a` tag bulk delete | **P1** | Spec: delete all versions of replaceable/addressable up to deletion `created_at`. |
| `k` tags | **P2** | SHOULD include kind of deleted events; not required/validated. |
| Client delete helper | **P3** | No dedicated Effect API. |

**Grade: Partial**

---

## NIP-10 — Text notes and threads

**Spec:** `10.md`  
**Code:** `src/client/Nip10Service.ts`  
**Tests:** present

### Present

- Parse marked `e` (`root`/`reply`), positional legacy, `q` quotes, `p` profiles.
- `isReply` / `isRoot` / id helpers.

### Gaps

| Item | Sev | Detail |
| --- | --- | --- |
| `mention` marker | **P3** | Spec removed in favor of `q`; parser still accepts (interop OK). |
| Reply builders | **P3** | Stronger parse than build. |

**Grade: Mostly OK**

---

## NIP-11 — Relay information document

**Spec:** `11.md` · relay  
**Code:** `src/relay/core/RelayInfo.ts` (full), `src/core/Nip11.ts` (client lag), modules  
**Tests:** `Nip11.test.ts`, `RelayInfo.test.ts`

### Present (relay)

- HTTP `Accept: application/nostr+json` document path (server).
- Fields: name, description, banner, icon, pubkey, **self**, contact, supported_nips, software, version, terms/privacy, limitation (incl. default_limit, restricted_writes), retention, fees, etc.

### Gaps

| Item | Sev | Detail |
| --- | --- | --- |
| Client type lag | **P2** | `src/core/Nip11.ts` misses banner/self/terms/privacy/default_limit; stale limitation fields. |
| Extension objects | **P3** | e.g. `nip29: { subgroups }` not modeled. |

**Grade: Partial (client) / Mostly OK (relay)**

---

## NIP-12 — Generic tag queries

**Spec:** moved entirely to NIP-01  
**Code:** same as NIP-01 filters

### Gaps

Identical to NIP-01 tag filter gap. Claiming “support” without open single-letter filters is incomplete.

**Grade: Partial**

---

## NIP-13 — Proof of Work

**Spec:** `13.md` · relay optional  
**Code:** `src/core/Nip13.ts`  
**Tests:** `Nip13.test.ts`

### Present

- `getPow` (leading zero bits).
- `minePow` with `nonce` tag + target difficulty commitment.
- `verifyPow` / `getClaimedDifficulty`.

### Gaps

| Item | Sev | Detail |
| --- | --- | --- |
| Relay min_pow_difficulty policy | **P2** | NIP-11 limitation field exists; confirm always enforced on EVENT when set. |
| Worker/async mine | **P3** | Sync mine blocks event loop for high difficulty. |

**Grade: Mostly OK**

---

## NIP-14 — Subject tag

**Spec:** `14.md`  
**Code:** `src/wrappers/nip14.ts`  
**Tests:** `nip14.test.ts`

### Present

- `withSubject` / `getSubject` / `replySubject` (Re: adornment).

### Gaps

| Item | Sev | Detail |
| --- | --- | --- |
| Length guidance | **P3** | Spec: prefer &lt; 80 chars; no trim helper. |

**Grade: Mostly OK**

---

## NIP-15 — Nostr Marketplace

**Spec:** unrecommended → NIP-99  
**Code:** `src/client/MarketplaceService.ts`, `Nip15Module`  
**Tests:** client + module tests  
**Detail:** see payments gap analysis §2.1

### Present

- Kinds 30017 stall, 30018 product, 30019 market UI, 30020 auction, 1021 bid, 1022 confirm.

### Gaps

| Item | Sev | Detail |
| --- | --- | --- |
| Checkout JSON over NIP-04 (types 0–2) | **P1** if interop | Not implemented. |
| Prefer NIP-99 | Product | Do not expand unless required. |

**Grade: Partial (legacy)**

---

## Batch 1 action list (implementation backlog)

1. **P0** NIP-01/12 open single-letter tag filters.  
2. **P1** NIP-09 `a`-tag deletion.  
3. **P2** Align client NIP-11 types with `RelayInfo`.  
4. **P2** NIP-05 local-part charset strictness.  
5. **P2** Wire/verify relay `min_pow_difficulty` (NIP-13).  
6. **Docs** Mark 03/04/06/08/15 as unrecommended in SUPPORTED_NIPS notes.

---

### Batch: NIPs 16–30

## Batch summary

| NIP | Title | Stance | Claimed | Grade | Top gap |
| --- | --- | --- | --- | --- | --- |
| 16 | Event treatment | moved → 01 | yes | **Partial** | Ephemeral events still stored |
| 17 | Private DMs | draft | yes | **Mostly OK** | Encrypted kind-7 reaction helper |
| 18 | Reposts | draft | yes | **Mostly OK** | Quote `q` builders; addressable `a` on kind 16 |
| 19 | bech32 entities | draft | yes | **Mostly OK** | `nrelay` deprecated; size limit 5k |
| 20 | Command results | moved → 01 | yes | **Mostly OK** | Prefix consistency polish |
| 21 | `nostr:` URI | draft | yes | **Mostly OK** | Thin but complete |
| 22 | Comment | draft | yes | **Mostly OK** | `P`/`p` author tags completeness |
| 23 | Long-form content | draft | yes | **Mostly OK** | Drafts via NIP-37; published_at optional path |
| 24 | Extra metadata | draft | yes | **Partial** | Missing `bot` / `birthday` fields |
| 25 | Reactions | draft | yes | **Partial** | No `a`/`k`; no kind 17 external |
| 26 | Delegation | unrecommended | yes | **Legacy OK** | Do not expand |
| 27 | Text note references | draft | yes | **Mostly OK** | Solid parse; emit helpers optional |
| 28 | Public chat | unrecommended | yes | **Legacy OK** | Prefer 29 |
| 29 | Relay groups | draft / relay | yes | **Stale** | Major upstream drift (see thematic doc) |
| 30 | Custom emoji | draft | yes | **Partial** | 4th tag param set-address; limited kinds |

---

## NIP-16 — Event treatment

**Spec:** moved to NIP-01 (kind ranges).  
**Code:** `Nip16Module.ts` (also covers 33).

### Present

- Replaceable + addressable replace hooks.
- Kind range helpers.

### Gaps

| Item | Sev | Detail |
| --- | --- | --- |
| Ephemeral storage | **P1** | Still stores 20000–29999; should broadcast-only. |
| Same-timestamp lowest-id | **P2** | Confirm store tie-break. |

---

## NIP-17 — Private direct messages

**Code:** `Nip17Service.ts` + NIP-59 wrap  
**Detail:** core/chat thematic doc §2.6

### Present

- Kind 14/15 rumors, subject, multi-recipient wrap, unwrap, 10050 inbox relays.

### Gaps

| Item | Sev | Detail |
| --- | --- | --- |
| Encrypted kind 7 in room | **P2** | Spec allows reactions as rumors. |
| Prefer over NIP-04 | Product | Document default. |

**Grade: Mostly OK**

---

## NIP-18 — Reposts

**Code:** `Nip18Service.ts`

### Present

- Kind 6 (kind-1) and kind 16 (generic) with `k` tag.
- Empty content for NIP-70 protected sources.
- Parse reposted event from content + pointer helpers.

### Gaps

| Item | Sev | Detail |
| --- | --- | --- |
| Quote repost `q` tag helpers | **P2** | Spec section on converting NIP-21 mentions to `q` tags — not first-class builders. |
| Addressable generic repost `a` tag | **P2** | Spec SHOULD include `a` for replaceable when not pinning a version. |
| Relay URL required on `e` | **P3** | Service takes `relayUrl`; validate non-empty. |

**Grade: Mostly OK**

---

## NIP-19 — bech32-encoded entities

**Code:** `src/core/Nip19.ts`, wrappers

### Present

- `npub` / `nsec` / `note` / `nprofile` / `nevent` / `naddr`.
- TLV relay/author/kind.
- Effect + sync APIs; solid tests.

### Gaps

| Item | Sev | Detail |
| --- | --- | --- |
| `nrelay` | **P3** | Deprecated upstream; omit or legacy-only. |
| 5000 char size limit | **P3** | Spec SHOULD limit; enforce on encode. |
| Unknown TLV ignore | **P3** | Confirm decode ignores unknown types (spec). |

**Grade: Mostly OK**

---

## NIP-20 — Command results

Moved to NIP-01 `OK`/`CLOSED` prefixes. Module + MessageHandler coverage **Mostly OK**. See batch 1 / core thematic for prefix polish.

---

## NIP-21 — `nostr:` URI scheme

**Code:** `src/core/Nip21.ts`

### Present

- Detect/parse/encode `nostr:<bech32>`; regex helpers.

### Gaps

| Item | Sev | Detail |
| --- | --- | --- |
| Extract-all from text | **P3** | Single parse; bulk extract optional (NIP-27 covers content parse). |

**Grade: Mostly OK**

---

## NIP-22 — Comment

**Code:** `src/wrappers/nip22.ts`

### Present

- Kind 1111 with root `A/E/I` + `K`, parent `a/e/i` + `k`, author refs.

### Gaps

| Item | Sev | Detail |
| --- | --- | --- |
| `P`/`p` always when author known | **P2** | Spec MUST for nostr events; verify builder always emits. |
| Effect service | **P3** | Wrapper-only. |

**Grade: Mostly OK**

---

## NIP-23 — Long-form content

**Code:** `Nip23Service.ts`

### Present

- Kind 30023 publish/get/list with `d`, title, summary, image, tags.
- Addressable replace semantics via relays.

### Gaps

| Item | Sev | Detail |
| --- | --- | --- |
| `published_at` | **P2** | Spec optional standardized tag; confirm API exposes it. |
| Kind 30024 drafts | **P3** | Spec deprecated → NIP-37; avoid implementing 30024. |
| Comments via NIP-22 | **P3** | Document; no combined helper. |
| Markdown rules | Info | Client content policy (no hard wrap / no HTML) is app-level. |

**Grade: Mostly OK**

---

## NIP-24 — Extra metadata fields and tags

**Code:** `src/wrappers/nip24.ts`

### Present

- `display_name`, website, banner, deprecated field normalize (`displayName`→`display_name`).
- Tag helpers: `r`, external id, title, hashtags.

### Gaps

| Item | Sev | Detail |
| --- | --- | --- |
| `bot` boolean | **P2** | Spec field missing from `ProfileMetadata`. |
| `birthday` object | **P2** | Spec field missing. |
| Kind 3 relay JSON deprecation | **P3** | Document NIP-65 instead. |

**Grade: Partial**

---

## NIP-25 — Reactions

**Code:** `Nip25Service.ts`  
**Detail:** reputation thematic §3.5

### Gaps (recap)

- Missing `a` for addressable, `k` kind tag, kind **17** external reactions (NIP-73).

**Grade: Partial**

---

## NIP-26 — Delegated event signing

**Stance:** unrecommended  
**Code:** `nip26.ts` create/verify delegation tag + finalize.

**Grade: Legacy OK** — do not use for OpenAgents authority.

---

## NIP-27 — Text note references

**Code:** `src/core/Nip27.ts`

### Present

- Parse content into blocks: text, references, urls, relays, media, emoji, hashtags.
- Extract helpers.

### Gaps

| Item | Sev | Detail |
| --- | --- | --- |
| Compose/emojify mentions on write | **P3** | Read path strong; write “insert nostr:nprofile” helpers optional. |

**Grade: Mostly OK**

---

## NIP-28 — Public chat

Unrecommended → 29. Full ChatService kinds 40–44. **Legacy OK.** Prefer 29/C7.

---

## NIP-29 — Relay-based groups

**Stale** vs July 2026 spec (subgroups, LiveKit, pins with `a`, metadata flag rename, moderation/join). Full matrix in [Chat and groups](#deep-dive-chat-and-groups).

**Grade: Stale / Partial** · **P1** product priority if groups matter.

---

## NIP-30 — Custom emoji

**Code:** `src/core/Nip30.ts`

### Present

- Shortcode match/replace, `emoji` tag builder (name + url), resolve URL from tags.

### Gaps

| Item | Sev | Detail |
| --- | --- | --- |
| Optional 4th tag param (emoji set `a` pointer) | **P2** | Spec: `["emoji", shortcode, url, set-address]`. |
| Kind 0/1/7/30315 integration helpers | **P3** | Content match only; no profile-name emojify helper. |
| Shortcode charset | **P3** | Spec alphanumeric/hyphen/underscore; regex `\w+` close enough. |

**Grade: Partial**

---

## Batch 2 backlog highlights

1. **P1** NIP-16 ephemeral broadcast-only.  
2. **P1** NIP-29 catch-up (if groups in product).  
3. **P2** NIP-24 `bot`/`birthday`; NIP-25 `a`/`k`/kind17; NIP-18 `q`/`a`; NIP-30 set address.  
4. **P2** NIP-22 `P`/`p` completeness check.

---

### Batch: NIPs 31–45

## Batch summary

| NIP | Title | Stance | Claimed | Grade | Top gap |
| --- | --- | --- | --- | --- | --- |
| 31 | Unknown kinds (`alt`) | unrecommended | yes | **Legacy OK** | Thin helpers |
| 32 | Labeling | draft | yes | **Partial** | `#L`/`#l` filters stripped |
| 33 | Addressable events | moved → 01 | yes | **Mostly OK** | Via Nip16Module |
| 34 | Git collaboration | draft | yes | **Mostly OK** | Broad builders; depth optional |
| 35 | Torrents | draft | yes | **Mostly OK** | Kinds 2003/2004 + magnet |
| 36 | Content warning | draft | yes | **Mostly OK** | Complete for tag helpers |
| 37 | Draft wraps | draft | yes | **Mostly OK** | Kind 31234 + private relays |
| 38 | User statuses | draft | yes | **Mostly OK** | Kind 30315 d-type |
| 39 | External identities | draft | yes | **Mostly OK** | Platform claim helpers |
| 40 | Expiration | draft / relay | yes | **Mostly OK** | Query-path expired filter |
| 42 | AUTH | draft / relay | yes | **Mostly OK** | Restricted REQ gating polish |
| 43 | Relay access metadata | draft | yes | **Mostly OK** | Client builders; relay enforce optional |
| 44 | Versioned encryption | optional | yes | **Strong** | Spec vectors tested |
| 45 | Event counts | draft / relay | yes | **Mostly OK** | Naive full-scan count |

---

## NIP-31 — Unknown event kinds (`alt`)

Unrecommended / bloated. Helpers `withAltTag` / `getAltTag`. **Legacy OK.**

---

## NIP-32 — Labeling

**Code:** `Nip32Service.ts`  
**P0:** `queryLabels` uses `#L`/`#l` which Filter schema **strips** (verified). Publish path OK. See reputation thematic.

**Grade: Partial**

---

## NIP-33 — Parameterized / addressable events

Spec renamed to addressable; ranges in NIP-01. Implemented in `Nip16Module` replace-by-`d`. **Mostly OK** pending ephemeral fix (16).

---

## NIP-34 — Git collaboration

**Code:** `src/core/Nip34.ts` — large surface:

- Repo 30617, state 30618, patch 1617, PR 1618/1619, issue 1621, status 1630–1633, GRASP list 10317.
- Generate/parse for major structures.

### Gaps

| Item | Sev | Detail |
| --- | --- | --- |
| Spec completeness vs latest 34.md | **P2** | Spot-check new tags/kinds if upstream grew. |
| Effect service / relay workflows | **P3** | Core builders only. |

**Grade: Mostly OK**

---

## NIP-35 — Torrents

Kind 2003 torrent + 2004 comment; magnet helper. **Mostly OK.**

---

## NIP-36 — Content warning

`content-warning` tag + optional NIP-32 labels. **Mostly OK.**

---

## NIP-37 — Draft wraps

Kind 31234 encrypted drafts; kind 10013 private relays; encrypt/decrypt for author. **Mostly OK.** Preferred over 30024 for NIP-23 drafts.

---

## NIP-38 — User statuses

Kind 30315 addressable by `d` (status type); publish/get.  

### Gaps

| Item | Sev | Detail |
| --- | --- | --- |
| Expiration / link tags | **P2** | Spec may define optional `expiration`, `r`/`p`/`e` links — confirm full tag set. |
| Emoji (NIP-30) on 30315 | **P3** | Spec lists 30315 as emoji-eligible. |

**Grade: Mostly OK**

---

## NIP-39 — External identities

Identity claims (github/twitter/mastodon/telegram) with verification fetch helpers. **Mostly OK.**

---

## NIP-40 — Expiration

Helpers + module reject expired on write. **P2:** ensure query path never returns expired. **Mostly OK.**

---

## NIP-42 — AUTH

Challenge, verify, protected-event gate. **Mostly OK.**

---

## NIP-43 — Relay access metadata/requests

Kinds 13534 membership, 8000/8001 add/remove, 28934–28936 join/invite/leave builders.  

### Gaps

| Item | Sev | Detail |
| --- | --- | --- |
| Relay-side enforcement | **P2** | Client builders + tests publish OK; hosting policy not full NIP-29-style. |

**Grade: Mostly OK (client)**

---

## NIP-44 — Versioned encryption

**Code:** `Nip44Service.ts` — v2 encrypt/decrypt, conversation key, padding; **matches official test vectors**. **Strong.**

---

## NIP-45 — Event counts

Relay `COUNT` in MessageHandler; client `Nip45Service.count`.  

### Gaps

| Item | Sev | Detail |
| --- | --- | --- |
| Implementation cost | **P2** | Counts by materializing query results — fine small-scale; may need index path for production. |
| Approximate flag | **P3** | Always `approximate: false` today. |

**Grade: Mostly OK**

---

## Batch 3 backlog

1. **P0** NIP-32 filter fix (depends NIP-01).  
2. **P2** NIP-45 efficient count; NIP-40 query filter; NIP-38 optional tags.  
3. **P2** NIP-34 re-diff vs latest git NIP.

---

### Batch: NIPs 46–60

## Batch summary

| NIP | Title | Claimed | Grade | Top gap |
| --- | --- | --- | --- | --- |
| 46 | Nostr Connect (remote signing) | yes | **Mostly OK** | Full bunker session UX edge cases |
| 47 | Nostr Wallet Connect | yes | **Partial** | NIP-04 only; no hold-invoice / NIP-44 negotiate |
| 48 | Bridged / proxy tags | yes | **Mostly OK** | Thin wrapper |
| 49 | Private key encryption (`ncryptsec`) | yes | **Mostly OK** | Complete crypto helper |
| 50 | Search capability | yes | **Partial** | Substring only; no extensions |
| 51 | Lists | yes | **Mostly OK** | Generic service; kinds.ts constants |
| 52 | Calendar events | yes | **Mostly OK** | Date/time/calendar/RSVP |
| 53 | Live streaming & spaces | yes | **Mostly OK** | 30311 + 1311 chat |
| 54 | Wiki | yes | **Mostly OK** | Core builders |
| 55 | Android signer | yes | **Mostly OK** | Intent URI builders |
| 56 | Reporting | yes | **Mostly OK** | See reputation thematic |
| 57 | Lightning zaps | yes | **Partial** | Receipt validation / zap splits |
| 58 | Badges | yes | **Stale** | Profile badges kind wrong |
| 59 | Gift wrap | yes | **Mostly OK** | Used by NIP-17 |
| 60 | Cashu wallets | yes | **Mostly OK** | On-relay state solid |

---

## NIP-46 — Remote signing

**Code:** `Nip46Service.ts` — bunker:// + nostrconnect://, kind 24133, methods connect/sign_event/ping/get_public_key/nip44_*.  

### Gaps

| Item | Sev | Detail |
| --- | --- | --- |
| Full method matrix vs latest 46.md | **P2** | Re-diff for any new methods (e.g. nip04_* legacy). |
| Silent timeout hardening | **P2** | Upstream notes timeout issues; confirm client timeouts. |

**Grade: Mostly OK**

---

## NIP-47 — NWC

See payments analysis. **Partial** — NIP-04 encryption path, missing hold invoices & encryption negotiation.

---

## NIP-48 — Bridged events / proxy tags

**Code:** `nip48.ts` proxy tag helpers. **Mostly OK.**

---

## NIP-49 — `ncryptsec`

**Code:** `Nip49.ts` encrypt/decrypt private keys. **Mostly OK.**

---

## NIP-50 — Search

**Code:** `Nip50Service` + FilterMatcher substring on `content`.  

### Gaps

| Item | Sev | Detail |
| --- | --- | --- |
| Quality ranking | **P2** | Spec wants score-ordered results; matcher is filter-only substring. |
| Extensions | **P2** | Spec MAY: `include:spam`, `domain:`, `language:`, `sentiment:`, `nsfw:` — none implemented. |
| Multi-field match | **P3** | Only content. |

**Grade: Partial**

---

## NIP-51 — Lists

Generic publish/get with private NIP-44 items; works for 100xx and 300xx. Constants in `kinds.ts` (mute 10000, pins 10001, bookmarks 10003, groups 10009, sets, etc.).  

### Gaps

| Item | Sev | Detail |
| --- | --- | --- |
| Typed helpers per standard list | **P3** | Generic API; apps pass kind numbers. |
| Profile badges kind 10008 | **P0** | Tied to NIP-58 migration; kinds.ts still has ProfileBadges=30008. |

**Grade: Mostly OK** (except badge kind constant)

---

## NIP-52 — Calendar

Kinds 31922 date, 31923 time, 31924 calendar, 31925 RSVP. **Mostly OK.**

---

## NIP-53 — Live activities

30311 live event + 1311 chat. **Mostly OK.** Spot-check for spaces/host tags vs latest 53.md.

---

## NIP-54 — Wiki

Core wiki event helpers. **Mostly OK.**

---

## NIP-55 — Android signer

Intent URI builders. **Mostly OK.**

---

## NIP-56 — Reporting

Kind 1984 templates. **Mostly OK.**

---

## NIP-57 — Zaps

**Partial** — see payments doc (App F/G, LNURL HTTP).

---

## NIP-58 — Badges

**Stale** — Profile Badges should be 10008; Badge Sets 30008. **P0.**

---

## NIP-59 — Gift wrap

**Code:** `Nip59.ts` wrap/unwrap; foundation for 17/37/EE. **Mostly OK.**

---

## NIP-60 — Cashu wallets

17375/7375/7376. **Mostly OK** (payments doc).

---

## Batch 4 backlog

1. **P0** NIP-58 + kinds.ts ProfileBadges.  
2. **P1** NIP-47 NIP-44 + hold invoices.  
3. **P1** NIP-57 receipt validation.  
4. **P2** NIP-50 search extensions / ranking.

---

### Batch: NIPs 61–78

## Batch summary

| NIP | Title | Claimed | Grade | Top gap |
| --- | --- | --- | --- | --- |
| 61 | Nutzaps | yes | **Partial** | `#u` filter stripped; redeem encryption |
| 62 | Request to Vanish | yes | **Mostly OK** | Kind 62 wipe by pubkey |
| 64 | Chess (PGN) | yes | **Mostly OK** | Niche wrapper |
| 65 | Relay list metadata | yes | **Mostly OK** | Kind 10002 read/write |
| 66 | Relay discovery & liveness | yes | **Mostly OK** | 30166 / 10166 |
| 67 | EOSE completeness hint | **no** | **Missing** | Optional 3rd EOSE element |
| 68 | Picture-first feeds | yes | **Mostly OK** | Kind picture + imeta |
| 69 | P2P orders | yes | **Mostly OK** | See payments; filter tags |
| 70 | Protected events | yes | **Mostly OK** | Default reject `-` |
| 71 | Video events | yes | **Mostly OK** | Kinds 21/22 + imeta |
| 72 | Moderated communities | yes (unrec.) | **Legacy OK** | Prefer 29 |
| 73 | External content IDs | yes | **Mostly OK** | `i`/`k` helpers |
| 75 | Zap goals | yes | **Mostly OK** | Zap-goal helpers thin |
| 77 | Negentropy syncing | yes | **Strong** | Client + relay IdList |
| 78 | App data | yes | **Mostly OK** | Arbitrary app events |

---

## NIP-61 — Nutzaps

**Partial** — payments doc. P0 `#u` filter; P1 redeem NIP-44.

---

## NIP-62 — Request to Vanish

**Code:** MessageHandler kind 62 deletes all author events ≤ created_at; module + tests.  

### Gaps

| Item | Sev | Detail |
| --- | --- | --- |
| Spec nuances | **P2** | Re-read for relay tag / scope requirements from latest 62.md. |
| Client helper | **P3** | Relay-side primary. |

**Grade: Mostly OK**

---

## NIP-64 — Chess

PGN note builder. **Mostly OK.**

---

## NIP-65 — Relay list metadata

**Code:** `RelayListService` kind 10002 get/set/add. **Mostly OK.** Preferred over deprecated kind-3 relay JSON (NIP-24).

---

## NIP-66 — Relay discovery & liveness

**Code:** `RelayDiscoveryService` 30166 discovery + 10166 monitor. **Mostly OK.**

---

## NIP-67 — EOSE completeness hint (**MISSING**)

**Spec:** optional third element on EOSE: `["finish"]` / `["more"]`.  
**Code:** schemas emit/accept only `["EOSE", subid]`.  

### Gaps

| Item | Sev | Detail |
| --- | --- | --- |
| Entire NIP | **P1** | High value for pagination correctness. |
| Advertise 67 in supported_nips | **P1** | After implement. |

**Grade: Missing**

---

## NIP-68 — Picture-first feeds

Picture events with imeta. **Mostly OK.**

---

## NIP-69 — P2P orders

Wrapper complete incl. expires_at. Queries need open tag filters. **Mostly OK** / filter **P0**.

---

## NIP-70 — Protected events

Default reject; AUTH path. **Mostly OK.**

---

## NIP-71 — Video events

Normal/short video with imeta variants. **Mostly OK.**

---

## NIP-72 — Moderated communities

Unrecommended → 29. **Legacy OK.**

---

## NIP-73 — External content IDs

Web/ISBN/podcast/hashtag/chain helpers. **Mostly OK.**

---

## NIP-75 — Zap goals

Kind 9041 amount+relays. **Mostly OK**; compose with ZapService.

---

## NIP-77 — Negentropy

Client `Nip77Service` + relay module + MessageHandler; IdList reconcile tests. **Strong.**

---

## NIP-78 — App data

`AppDataService` arbitrary custom app events. **Mostly OK.**

---

## Batch 5 backlog

1. **P1** Implement NIP-67 EOSE hints.  
2. **P0** Filters for 61/69.  
3. **P2** NIP-62 full re-diff.

---

### Batch: NIPs 84–99

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

---

### Batch: NIPs Lettered

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

---

## File map

```text
Core / filters
  src/core/Schema.ts
  src/relay/core/FilterMatcher.ts
  src/relay/core/MessageHandler.ts
  src/relay/core/nip/modules/Nip01Module.ts
  src/relay/core/nip/modules/Nip09Module.ts
  src/relay/core/nip/modules/Nip11Module.ts
  src/relay/core/RelayInfo.ts
  src/core/Nip11.ts
  src/relay/core/nip/modules/Nip16Module.ts
  src/relay/core/nip/modules/Nip40Module.ts
  src/relay/core/nip/modules/Nip42Module.ts
  src/relay/core/nip/modules/Nip70Module.ts

Payments
  src/client/MarketplaceService.ts
  src/core/Nip47.ts · src/client/ZapService.ts
  src/client/CashuWalletService.ts · src/client/NutzapService.ts
  src/wrappers/nip69.ts · nip75.ts · nip99.ts
  src/client/MintDiscoverabilityService.ts

Chat / groups
  src/client/ChatService.ts · Nip29Service.ts · NipC7Service.ts
  src/client/Nip7DService.ts · Nip10Service.ts · Nip17Service.ts
  src/wrappers/nip22.ts

Reputation
  src/client/Nip32Service.ts · Nip58Service.ts · Nip25Service.ts
  src/wrappers/nip56.ts · nip72.ts
  (missing) NIP-85
```

## Historical note

Earlier multi-file drafts (`NIP_GAP_ANALYSIS_SEQ_*`, thematic payments/chat docs, June `NIP_PARITY_GAP_ANALYSIS.md`) are consolidated here. Prefer this file only.
