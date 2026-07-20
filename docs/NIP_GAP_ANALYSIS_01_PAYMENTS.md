# NIP Gap Analysis — NIP-01 + Marketplace / Lightning Payments

**Date:** 2026-07-20  
**Scope (this pass):** NIP-01 foundation, plus marketplace and Lightning/payment-adjacent NIPs.  
**Status:** Initial review draft for style and prioritization feedback. Not a full-repo parity audit.

## Reference inputs

| Input | Value |
| --- | --- |
| Upstream NIPs clone | `/Users/christopherdavid/work/projects/repos/nips` |
| Upstream HEAD | `bdfa7e6` (2026-07-16) — *NIP-29: allow a tags in pin list* |
| nostr-effect HEAD | `2bb5787` — *chore: upgrade Effect to beta.94* |
| Claimed support | `docs/SUPPORTED_NIPS.md` |
| Prior full audit | `docs/NIP_PARITY_GAP_ANALYSIS.md` (2026-06-09) |

### NIPs in this pass

| NIP | Title | Upstream stance | Claimed in repo |
| --- | --- | --- | --- |
| 01 | Basic protocol flow | mandatory | yes |
| 15 | Nostr Marketplace | **unrecommended** → prefer 99 | yes |
| 47 | Nostr Wallet Connect | optional | yes |
| 57 | Lightning Zaps | optional | yes |
| 60 | Cashu Wallet | optional | yes |
| 61 | Nutzaps | optional | yes |
| 69 | Peer-to-peer Order events | optional | yes |
| 75 | Zap Goals | optional | yes |
| 87 | Ecash Mint Discoverability | optional | yes |
| 99 | Classified Listings | optional (preferred marketplace path) | yes |

Related but not deep-dived here: NIP-04 (checkout DMs for 15), NIP-11 (relay info fields), NIP-24 (`lud16` metadata), NIP-40 (expiration used by 69), NIP-44 (encryption for 47/60/61).

---

## Executive summary

All listed NIPs are **claimed** in `SUPPORTED_NIPS.md` and have some code surface. None of the payment paths look “empty.” The risk is **semantic under-implementation**: helpers and kind constants exist, but several protocol-critical behaviors are missing, partial, or silently broken by the NIP-01 filter model.

### Compliance snapshot

| Area | Grade | One-line verdict |
| --- | --- | --- |
| NIP-01 filters / tag index | **Partial** | Hard-coded `#e/#p/#a/#d/#t` only; breaks payment queries that need `#u`, `#k`, `#g`, `#f`, `#s`, etc. |
| NIP-01 kind ranges / storage | **Mostly OK** | Replaceable / addressable / ephemeral classification matches current ranges. |
| NIP-15 marketplace | **Partial + legacy** | Stall/product/auction covered; checkout order flow absent; upstream prefers NIP-99. |
| NIP-99 classifieds | **Mostly OK** | Build/parse/validate present; stricter than SHOULD; thin on `status` / geohash ergonomics. |
| NIP-57 zaps | **Partial** | Request/receipt builders good; receipt validation (App. F) and zap-split tags (App. G) missing; no LNURL HTTP client. |
| NIP-47 NWC | **Legacy-shaped** | NIP-04-only encryption; no `encryption` negotiation; hold-invoice + notification methods incomplete. |
| NIP-60 Cashu | **Mostly OK** | Wallet / token / history / rollover present; no mint protocol client (expected out of band). |
| NIP-61 Nutzaps | **Partial** | Publish path OK; `#u` filter silently dropped; redeem fallback may skip NIP-44. |
| NIP-69 P2P orders | **Mostly OK** | Tags including `expires_at` / `expiration` present; wrapper-only, no Effect service. |
| NIP-75 zap goals | **Mostly OK** | Required tags + optional set present; no client helper to zap a goal correctly. |
| NIP-87 mints | **Assumed OK** | Not re-audited line-by-line this pass; listed for completeness. |

### Priority stack for full compliance work

1. **P0 — NIP-01 single-letter tag filters** (unblocks NIP-61 and every payment query that is not `#e/#p/#a/#d/#t`)
2. **P0 — NIP-57 zap receipt validation + zap splits**
3. **P1 — NIP-47 NIP-44 encryption + method/notification completeness**
4. **P1 — NIP-61 findIncoming / redeem correctness**
5. **P2 — NIP-99 polish + document NIP-15 as legacy**
6. **P2 — NIP-15 checkout only if product still needs Diagon-Alley compatibility**
7. **P3 — NIP-69/75 Effect services, LNURL HTTP helpers**

---

## 1. NIP-01 — Basic protocol flow

**Spec:** `~/work/projects/repos/nips/01.md`  
**Code:** `src/core/Schema.ts`, `src/relay/core/FilterMatcher.ts`, `src/relay/core/MessageHandler.ts`, `src/relay/core/nip/modules/Nip01Module.ts`  
**Tests:** `src/relay/FilterMatcher.test.ts`, relay integration tests

### What looks compliant

- Event shape (`id`, `pubkey`, `created_at`, `kind`, `tags`, `content`, `sig`) and Schnorr/`secp256k1` usage via existing crypto path.
- Client→relay messages: `EVENT`, `REQ`, `CLOSE` (plus later NIPs: `AUTH`, `COUNT`, `NEG-*`).
- Relay→client messages: `EVENT`, `OK`, `EOSE`, `CLOSED`, `NOTICE`.
- Kind range helpers in `Schema.ts`:
  - replaceable: `0`, `3`, `10000–19999`
  - ephemeral: `20000–29999`
  - addressable (parameterized replaceable): `30000–39999`
- Storage pipeline routes replaceable / addressable / ephemeral through NIP-16 module + `MessageHandler`.
- Standard `e` / `p` / `a` tag conventions are used throughout client services.

### Gaps

#### 1.1 Filter schema only models five tag filters (P0)

`Filter` in `src/core/Schema.ts` only allows:

```text
#e  #p  #a  #d  #t
```

`FilterMatcher` only evaluates that same fixed set.

**Current NIP-01** expects all single-letter English tags (`a–z`, `A–Z`) to be indexable and queryable as `#<letter>`. Only the first value of each tag is indexed.

**Impact on this payment pass alone:**

| Consumer | Needs | Today |
| --- | --- | --- |
| NIP-61 nutzap receive | `#u` mint URLs | **Silently stripped** by `Schema.decodeSync(Filter)` |
| NIP-57 receipts / kinds | `#k` | not filterable |
| NIP-69 orders | `#f` currency, `#s` status, `#g` geohash, `#y` platform | not filterable |
| NIP-99 listings | `#g` geohash | not filterable |
| NIP-75 / multi-zap flows | various single-letter tags | not filterable |

Verified with a local decode of `{ kinds: [9321], "#p": [...], "#u": ["https://mint"] }`: decode **succeeds** and **drops `#u`**. That means `NutzapService.findIncoming` can believe it filtered by mint when it did not.

**Recommended fix**

- Model filters as known fields + an open map (or dynamic keys) for `#X` where `X` is a single `[a-zA-Z]` character.
- Update `FilterMatcher`, SQLite/query backends, and client `decodeFilter` call sites.
- Keep typed accessors for common tags; do not require a schema edit per new NIP.

#### 1.2 Prefix matching vs exact hex (P2)

NIP-01 states that `ids`, `authors`, `#e`, and `#p` lists **MUST contain exact 64-character lowercase hex**.

`FilterMatcher` still does **prefix** matching for `ids` and `authors` (`startsWith`). That is historical NIP-12-style behavior and useful in the wild, but it is not what the current NIP-01 text requires.

**Recommended fix**

- Default to exact match.
- If prefix support is retained, document it as a relay extension and optionally advertise it (e.g. NIP-11 limitation / feature flag), never as pure NIP-01.

#### 1.3 EOSE form (P2, see also NIP-67)

NIP-01 defines `["EOSE", <subscription_id>]`.  
NIP-67 extends EOSE with optional completeness hints. Current schemas only model the two-element form. Track under NIP-67 in a later pass; no payment blocker.

#### 1.4 Terminology drift only (P3)

Upstream now says **addressable** events for `30000–39999`. Code still says “parameterized replaceable” in several places. Behavior matches; rename/docs polish only.

### NIP-01 acceptance criteria for “compliant”

- [ ] Any `#` + single ASCII letter filter works end-to-end (schema → matcher → store → client).
- [ ] Documented policy for prefix vs exact `ids`/`authors`.
- [ ] REQ with unknown multi-letter keys either ignored with clear policy or rejected via `CLOSED` with `unsupported:`.
- [ ] Existing payment services that set `#u`/`#k`/`#f`/`#s` round-trip in tests.

---

## 2. Marketplace track

### 2.1 NIP-15 — Nostr Marketplace (legacy)

**Spec:** `~/work/projects/repos/nips/15.md` — marked **`unrecommended`**; points at NIP-99  
**Code:** `src/client/MarketplaceService.ts`, `src/relay/core/nip/modules/Nip15Module.ts`  
**Tests:** `src/client/MarketplaceService.test.ts`, `src/relay/core/nip/modules/Nip15Module.test.ts`

#### Present

| Kind | Role | Service API |
| --- | --- | --- |
| 30017 | stall | `publishStall` / `getStall` |
| 30018 | product | `publishProduct` / `getProduct` |
| 30019 | market UI | `publishMarketUI` / `getMarketUI` |
| 30020 | auction | `publishAuction` / `getAuction` |
| 1021 | bid | `publishBid` |
| 1022 | bid confirmation | `confirmBid` |

Content shapes for stall/product/auction roughly match the spec (shipping zones, specs, categories via `t` tags).

#### Missing / weak

| Gap | Spec expectation | Current code |
| --- | --- | --- |
| Checkout flow | Order / payment request / status as **NIP-04 JSON** types `0`, `1`, `2` | **Not implemented** in `MarketplaceService` |
| Payment options | `url`, `btc`, `ln`, `lnurl` | no builders/parsers |
| Merchant↔customer messaging helpers | kind 4 JSON payloads | none |
| Product delete via kind 5 | documented merchant action | no dedicated helper (generic NIP-09 only) |
| Positioning | upstream prefers NIP-99 | still listed as first-class marketplace support |

#### Recommendation

- Treat NIP-15 as **legacy compatibility**, not the preferred marketplace path.
- Do not invest in full checkout unless a concrete Diagon-Alley / Plebeian / NostrMarket interop requirement appears.
- If checkout is required later, implement typed encode/decode for message types 0–2 on top of existing NIP-04/17 DM primitives, with Lightning invoice (`ln` / `lnurl`) as first-class payment option types.

### 2.2 NIP-99 — Classified listings (preferred marketplace)

**Spec:** `~/work/projects/repos/nips/99.md`  
**Code:** `src/core/Nip99.ts`, `src/wrappers/nip99.ts`  
**Tests:** `src/core/Nip99.test.ts`

#### Present

- Kinds `30402` (listing) and `30403` (draft/inactive).
- Tags: `d`, `title`, `summary`, `published_at`, `location`, `price` (+ optional frequency), `image`, `t`.
- Parse + generate + validate helpers.

#### Gaps

| Gap | Severity | Notes |
| --- | --- | --- |
| Validation is stricter than spec | Low | Spec says structured tags **SHOULD** be included; `validateEvent` **requires** title/summary/location/published_at/price. Fine for “strict mode,” but reject valid minimal listings. |
| Currency length check | Medium | Requires `currency.length === 3`. Spec allows ISO 4217 **or** ISO-like codes (`btc`, `eth` — still 3). Longer custom codes would fail. |
| `status` tag (`active` / `sold`) | Medium | Not first-class in types/parse. |
| `g` geohash | Medium | Only via `additionalTags`; not documented helpers. Depends on NIP-01 `#g` filter for discovery. |
| `e` / `a` tag shape | Low | Validator requires length exactly 3 (value + relay). Spec examples use relay hints; pure two-element tags would fail. |
| No Effect service | Low | Wrapper/core only; fine if intentional, inconsistent with other high-value NIPs. |
| E-commerce extension | Info | Spec links GammaMarkets market-spec extension; out of scope unless product asks for it. |

#### Recommendation

- Keep NIP-99 as the **canonical** marketplace listing API in docs and exports.
- Soften validation into `validateEvent(event, { strict?: boolean })` or separate `validateMinimal` / `validateStrict`.
- Add `status` and `g` to the typed object model.
- Add client queries once NIP-01 open tag filters land.

### 2.3 NIP-69 — Peer-to-peer order events

**Spec:** `~/work/projects/repos/nips/69.md` (includes `expires_at` addition from 2025-11)  
**Code:** `src/wrappers/nip69.ts`  
**Tests:** `src/wrappers/nip69.test.ts`

#### Present

- Kind `38383` addressable order events.
- Mandatory tags: `d`, `k` (buy/sell), `f`, `s`, `amt`, `fa`.
- Optional: `pm`, `premium`, `source`, `rating`, `network`, `layer`, `name`, `g`, `bond`, `expires_at`, `expiration` (NIP-40), `y`, `z`.
- Fiat amount as single value or range.

#### Gaps

| Gap | Severity | Notes |
| --- | --- | --- |
| Wrapper-only | Low | No `Nip69Service` / Effect layer; no subscribe helpers. |
| `pm` encoding | Low | Spec example uses multi-value tag; prose also allows comma-separated. Impl joins with `", "`. Interop risk with Mostro/Robosats/Peach if they diverge. |
| Query helpers | Medium | Clients cannot filter `#f`/`#s`/`#y` until NIP-01 filter fix. |
| No rating schema | Info | Spec leaves rating JSON to platforms; OK. |

#### Recommendation

- Add golden-vector tests against published sample events from Mostro / lnp2pBot / Peach if interop is a goal.
- Prefer multi-arg `pm` tags matching the spec example when building events.

---

## 3. Lightning and payment track

### 3.1 NIP-57 — Lightning Zaps

**Spec:** `~/work/projects/repos/nips/57.md`  
**Code:** `src/client/ZapService.ts`, `src/relay/core/nip/modules/Nip57Module.ts`  
**Tests:** `src/client/ZapService.test.ts`

#### Present

- `makeZapRequest` for profile and event targets: `p`, `amount`, `relays`, optional `lnurl`, optional `e` / `a` / `k`.
- `validateZapRequest` (signature + basic tags).
- `makeZapReceipt` with `P`, `bolt11`, `description`, optional `preimage`; `created_at` from `paidAt`.
- `getZapEndpoint` from kind-0 `lud16` / `lud06`.
- Bolt11 amount HRP parser.
- Relay module advertises kinds 9734/9735.

#### Gaps

| Gap | Spec ref | Severity |
| --- | --- | --- |
| No `validateZapReceipt` | Appendix F | **P0** — clients must check receipt pubkey == LNURL `nostrPubkey`, amount vs request, optional lnurl match |
| No zap-split `zap` tags | Appendix G | **P1** — weighted multi-recipient zaps |
| Incomplete request validation | Appendix D | **P1** — missing: exactly one `p`; 0–1 `e`; amount vs query param; `a` coordinate validity; 0–1 `P` |
| Receipt does not copy `k` | Appendix E example | **P2** — example receipt includes `k` |
| No LNURL HTTP helpers | Protocol flow steps 1, 4–7 | **P1** — no fetch of `/.well-known/lnurlp/...`, no callback GET with `amount`/`nostr`/`lnurl`, no `allowsNostr`/`nostrPubkey` binding beyond types |
| `getZapEndpoint` is URL-only | step 1 | **P2** — returns string; does not return `LnurlPayResponse` fields callers need for validation |
| No client “send zap” orchestration | full flow | **P2** — expected to be app-level, but library could expose a single Effect workflow |

#### Recommendation

Implement in order:

1. `validateZapReceipt(receipt, { zapRequest, lnurlPayResponse })`.
2. Stricter `validateZapRequest` matching Appendix D.
3. `resolveLnurlPay(metadata | lud16)` → `LnurlPayResponse` (injectable `fetch`).
4. `requestZapInvoice({ callback, zapRequest, amount, lnurl })`.
5. `parseZapTags` / `splitZapAmounts` for Appendix G.
6. Tests with fixed vectors for valid/invalid receipts (wrong signer, amount mismatch, bad description).

### 3.2 NIP-47 — Nostr Wallet Connect

**Spec:** `~/work/projects/repos/nips/47.md` (recent: hold invoices, encryption negotiation, metadata on payments, deep links)  
**Code:** `src/core/Nip47.ts`, `src/wrappers/nip47.ts`  
**Tests:** `src/core/Nip47.test.ts`

#### Present

- Connection URI parse (`nostr+walletconnect://`, `relay`, `secret`, optional `lud16`).
- Kinds: 13194 info, 23194 request, 23195 response, 23197 / 23196 notifications (constants).
- `makeNwcRequestEvent` / `makeNwcRequest` for encrypted requests.
- Error code + method name constants for core methods.
- Error codes include `UNSUPPORTED_ENCRYPTION`.

#### Gaps

| Gap | Severity | Notes |
| --- | --- | --- |
| Encryption is **NIP-04 only** | **P0** | Spec prefers NIP-44 (`nip44_v2`); absence of `encryption` tag means legacy NIP-04. No tag negotiation. |
| No response decrypt/parse helpers | **P1** | Clients can send but have thin receive path. |
| No info-event builder/parser | **P1** | Capabilities + `encryption` + `notifications` tags. |
| Hold invoice methods missing from constants/API | **P1** | Spec: `make_hold_invoice`, `cancel_hold_invoice`, `settle_hold_invoice`, notification `hold_invoice_accepted`. |
| Notification helpers incomplete | **P1** | Constants for payment_received/sent only; no encrypt/decrypt builders. |
| Multi-relay URI | **P2** | Spec allows multiple `relay` params; parse model is singular `relay: string`. |
| `metadata` on pay/make_invoice | **P2** | Spec added optional metadata for zap/boostagram context. |
| No Effect NWC client service | **P2** | Wrapper/core only; no subscribe-to-responses loop. |
| Deep link docs/helpers | **P3** | Spec mentions deeplinks; not reflected in API. |

#### Recommendation

- Add `encryption: "nip44_v2" | "nip04"` selection driven by wallet info event.
- Default new connections to NIP-44 when advertised.
- Expand `NWC_METHODS` / `NWC_NOTIFICATIONS` to full current command set.
- Provide `encryptRequest` / `decryptResponse` / `decryptNotification` with scheme parameter.
- Parse multiple relays: `relays: string[]`.

### 3.3 NIP-60 — Cashu wallets

**Spec:** `~/work/projects/repos/nips/60.md`  
**Code:** `src/client/CashuWalletService.ts`  
**Tests:** `src/client/CashuWalletService.test.ts`

#### Present

- Kind `17375` wallet (NIP-44 encrypted `privkey` + `mint` tags payload).
- Kind `7375` token events with `mint`, `unit`, `proofs`, optional `del`.
- Kind `7376` spending history (direction/amount/unit + created/destroyed/redeemed markers).
- Token rollover + NIP-09 delete with `k=7375`.

#### Gaps

| Gap | Severity | Notes |
| --- | --- | --- |
| No Cashu mint HTTP/NUT client | Info | Spec is relay state, not mint protocol — OK if intentional. |
| Proof typing is `any` | Low | Weak safety for wallet apps. |
| No balance aggregation helper | Low | App can derive from tokens. |
| Wallet event not keyed/replaceable fetch edge cases | Low | `getLatestWallet` exists; confirm replaceable semantics under concurrent writes. |

Overall: **strongest payment implementation in this pass** for on-relay state.

### 3.4 NIP-61 — Nutzaps

**Spec:** `~/work/projects/repos/nips/61.md` (includes `unit` on kind 9321)  
**Code:** `src/client/NutzapService.ts` (+ `CashuWalletService`)  
**Tests:** `src/client/NutzapService.test.ts`

#### Present

- Kind `10019` info: `relay`, `mint` (+ units), `pubkey` (P2PK).
- Kind `9321` nutzap: `proof`, `unit`, `u`, `p`, optional `e`/`k`, content comment.
- `findIncoming` intent matches recommended REQ shape.
- `redeem` writes spending history via NIP-60 when available.

#### Gaps

| Gap | Severity | Notes |
| --- | --- | --- |
| `#u` filter dropped | **P0** | Depends on NIP-01 open tag filters; today mint filtering is a no-op. |
| Redeem fallback content | **P1** | Without `CashuWalletService`, fallback publishes **plaintext** JSON pairs instead of NIP-44 ciphertext required by NIP-60/61 history shape. |
| No mint/swap/P2PK lock helpers | **P1** | Spec assumes Cashu mint ops + `"02"`-prefixed P2PK lock; library documents “client prefixes” but does not help. |
| DLEQ proof requirement | **P2** | Spec says proofs include DLEQ; not validated. |
| `since` marker from latest 7376 | **P2** | Caller must pass `since`; no helper to compute marker. |

### 3.5 NIP-75 — Zap goals

**Spec:** `~/work/projects/repos/nips/75.md`  
**Code:** `src/core/Nip75.ts`, `src/wrappers/nip75.ts`  
**Tests:** `src/core/Nip75.test.ts`

#### Present

- Kind `9041` with required `amount` + `relays`.
- Optional `closed_at`, `image`, `summary`, `r`, `a`, `zap` tags.
- Template generation + basic validation.

#### Gaps

| Gap | Severity | Notes |
| --- | --- | --- |
| No “zap this goal” helper | Medium | Spec: clients MUST copy goal `relays` into zap request; SHOULD tag goal id when zapping addressable events with `goal` tag. |
| No tally helper | Low | Sum validated 9735 receipts toward `amount`, respecting `closed_at`. |
| No Effect service | Low | Consistency only. |

### 3.6 NIP-87 — Ecash mint discoverability

**Spec:** `~/work/projects/repos/nips/87.md`  
**Code:** `src/client/MintDiscoverabilityService.ts`  
**Tests:** `src/client/MintDiscoverabilityService.test.ts`

Listed as claimed support and in buildout as complete. Not line-audited in this pass. Follow-up: confirm kinds 38000 / 38172 / 38173, tags `k`/`d`/`u`/`a`/`nuts`/`modules`/`n`, and query helpers against current spec after the NIP-01 filter work (recommendation pointers use `a` tags).

---

## 4. Cross-cutting issues

### 4.1 “Supported” vs “protocol complete”

`docs/SUPPORTED_NIPS.md` is a good inventory of **entry points**, not a guarantee of **end-to-end protocol fidelity**. Several payment NIPs are at “builder + kind constant” maturity rather than “wallet-grade client.”

**Recommendation:** when closing gaps, update each SUPPORTED_NIPS row with a maturity note (`scaffold` / `partial` / `complete`) or keep maturity only in this analysis to avoid dual sources of truth.

### 4.2 Wrapper vs Effect service inconsistency

| NIP | Style |
| --- | --- |
| 15, 57, 60, 61, 87 | Effect services under `src/client/**` |
| 47, 69, 75, 99 | core/wrapper only |

Either style is fine, but full compliance work should pick one pattern per NIP family (payments → Effect services with thin Promise wrappers).

### 4.3 Relay modules vs client-only

| NIP | Relay module | Notes |
| --- | --- | --- |
| 01 | yes | core |
| 15 | yes | legacy advertise |
| 57 | yes | advertise-only (correct; LNURL does work) |
| 47, 60, 61, 69, 75, 99 | no dedicated module | OK for client protocols; 47 ephemeral kinds may want ephemeral treatment awareness |

### 4.4 Unrecommended NIPs still first-class

NIP-15 is unrecommended upstream. Docs and README examples should steer new marketplace work to **NIP-99** (+ Lightning via 57/47, ecash via 60/61).

---

## 5. Suggested implementation order (this scope)

### Phase A — Foundation (blocks everything)

1. Open single-letter tag filters in `Schema.Filter` + `FilterMatcher` + stores.
2. Regression tests: `#u`, `#k`, `#f`, `#s`, `#g`, `#y` match and query.
3. Fix `NutzapService.findIncoming` test that asserts mint filtering actually works.

### Phase B — Lightning correctness

1. NIP-57 Appendix F receipt validation + stricter Appendix D request validation.
2. NIP-57 Appendix G zap splits.
3. Optional LNURL fetch helpers (injectable fetch) for endpoint + invoice request.
4. NIP-75 helpers that compose with ZapService (`relays` copy, goal `e` tag).

### Phase C — Wallet connect modernization

1. NIP-47 NIP-44 encryption path + `encryption` tag negotiation.
2. Multi-relay URI; info event parse; response/notification decrypt.
3. Hold invoice methods + `hold_invoice_accepted` notification type.
4. Optional Effect `NwcClient` service.

### Phase D — Marketplace positioning

1. NIP-99: `status`, `g`, softer validation, discovery queries.
2. Document NIP-15 as legacy; leave checkout unimplemented unless required.
3. NIP-69 interop vectors + multi-value `pm` tags.

### Phase E — Cashu hardening

1. NIP-61 redeem always NIP-44 when writing 7376.
2. Optional P2PK/`02` prefix helpers; DLEQ presence checks.
3. NIP-87 re-verify against current tags after Phase A.

---

## 6. Out of scope for this document

- Full re-audit of all 90+ claimed NIPs (see older `NIP_PARITY_GAP_ANALYSIS.md`).
- Completely missing upstream NIPs (`5A`, `67`, `85`, `A4`, `CC`, `F4`, …).
- Non-payment semantic drift already flagged previously (NIP-58 badges, NIP-98 signature verify, NIP-50 autocomplete).
- Implementing fixes (analysis only).

---

## 7. Style note for reviewers

This pass intentionally:

- Ties each gap to **spec section** + **code path** + **severity**.
- Distinguishes **missing NIP** vs **claimed but partial**.
- Treats upstream **unrecommended** status as a product signal, not only a code gap.
- Uses a phased plan rather than a flat bug list.

If this style is good, next analysis passes can cover:

1. NIP-01 adjacent core: 02, 09, 11, 16/33, 20, 40, 42, 70  
2. Messaging: 17, 44, 59, EE  
3. Remainder in buildout order from `docs/BUILDOUT.md`

---

## Appendix — File map for this pass

```text
NIP-01
  src/core/Schema.ts
  src/relay/core/FilterMatcher.ts
  src/relay/core/MessageHandler.ts
  src/relay/core/nip/modules/Nip01Module.ts

NIP-15
  src/client/MarketplaceService.ts
  src/relay/core/nip/modules/Nip15Module.ts

NIP-47
  src/core/Nip47.ts
  src/wrappers/nip47.ts

NIP-57
  src/client/ZapService.ts
  src/relay/core/nip/modules/Nip57Module.ts

NIP-60
  src/client/CashuWalletService.ts

NIP-61
  src/client/NutzapService.ts

NIP-69
  src/wrappers/nip69.ts

NIP-75
  src/core/Nip75.ts
  src/wrappers/nip75.ts

NIP-87
  src/client/MintDiscoverabilityService.ts

NIP-99
  src/core/Nip99.ts
  src/wrappers/nip99.ts
```
