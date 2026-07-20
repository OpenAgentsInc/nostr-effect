# Sequential NIP Gap Analysis — Batch 1: NIPs 01–15

**Date:** 2026-07-20  
**Series:** Sequential full-repo scan (numeric order, ~15 NIPs per batch)  
**Upstream:** `/Users/christopherdavid/work/projects/repos/nips` @ `bdfa7e6`  
**Repo:** `nostr-effect` @ `d147c1b`  
**Claimed support:** `docs/SUPPORTED_NIPS.md`  
**Related thematic docs:** `NIP_GAP_ANALYSIS_01_PAYMENTS.md`, `NIP_GAP_ANALYSIS_CORE_CHAT_REPUTATION.md`

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

## Next batch

**Batch 2:** NIPs 16–30 (event treatment through custom emoji).
