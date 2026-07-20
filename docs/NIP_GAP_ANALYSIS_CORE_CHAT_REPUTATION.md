# NIP Gap Analysis — Core Protocol, Chat & Reputation

**Date:** 2026-07-20  
**Scope (this pass):** NIP-01-adjacent core (relay/client protocol), public/private chat, groups, threading, and reputation/moderation.  
**Companion to:** [`NIP_GAP_ANALYSIS_01_PAYMENTS.md`](./NIP_GAP_ANALYSIS_01_PAYMENTS.md)  
**Status:** Second review draft. Analysis only — no code changes in this commit.

## Reference inputs

| Input | Value |
| --- | --- |
| Upstream NIPs clone | `/Users/christopherdavid/work/projects/repos/nips` |
| Upstream HEAD | `bdfa7e6` (2026-07-16) — *NIP-29: allow a tags in pin list* |
| nostr-effect HEAD | `4e6a73a` — *docs: add NIP-01 and payments gap analysis draft* |
| Claimed support | `docs/SUPPORTED_NIPS.md` |
| Prior full audit | `docs/NIP_PARITY_GAP_ANALYSIS.md` (2026-06-09) |

### NIPs in this pass

#### Core (NIP-01 adjacent)

| NIP | Title | Stance | Claimed |
| --- | --- | --- | --- |
| 09 | Event deletion request | optional / relay | yes |
| 11 | Relay information document | optional / relay | yes |
| 16 / 33 | Event treatment / addressable | optional / relay | yes (via Nip16Module) |
| 20 | Command results (`OK`) | moved into 01; module exists | yes |
| 40 | Expiration timestamp | optional / relay | yes |
| 42 | Client authentication | optional / relay | yes |
| 70 | Protected events | optional / relay | yes |

#### Chat / groups / threading

| NIP | Title | Stance | Claimed |
| --- | --- | --- | --- |
| 10 | Text notes and threads | optional | yes |
| 17 | Private DMs (gift wrap) | optional | yes |
| 22 | Comment | optional | yes |
| 28 | Public chat | **unrecommended** → prefer 29 | yes |
| 29 | Relay-based groups | optional / relay | yes |
| 7D | Forum threads | optional | yes |
| C7 | Chats (kind 9) | optional | yes |

#### Reputation / moderation / social signal

| NIP | Title | Stance | Claimed |
| --- | --- | --- | --- |
| 25 | Reactions | optional | yes |
| 32 | Labeling | optional | yes |
| 56 | Reporting | optional | yes |
| 58 | Badges | optional | yes |
| 72 | Moderated communities | **unrecommended** → prefer 29 | yes |
| 85 | Trusted Assertions | optional | **no** |

Also relevant: NIP-51 lists (`kind:10009` group list, profile badges as lists), NIP-01 open tag filters (blocks `#L`/`#l` / `#h` queries).

---

## Executive summary

Core relay plumbing (OK/AUTH/expiration/protected/`-` tag, replaceable storage) is largely present and tested. The main risks in this pass are:

1. **NIP-29 is stale against a fast-moving upstream** (subgroups, pins with `a` tags, LiveKit AV, banner/`closed`/`private`/`restricted` metadata model, join/invite, full moderation surface).
2. **Reputation stack is incomplete for OpenAgents-style trust**: NIP-**85 is missing**, NIP-**58 Profile Badges still use the deprecated kind**, and NIP-**32 queries are broken** by the same NIP-01 filter gap as payments (`#L` / `#l` stripped).
3. **NIP-09 addressable (`a`) deletions** are not implemented on the relay path.
4. **NIP-16 ephemeral events are still stored** (code comments admit this).
5. Chat surface area is broad (28/29/C7/7D/17/10/22) but product guidance should prefer **29 + C7 + 17** over 28/72.

### Compliance snapshot

| Area | Grade | One-line verdict |
| --- | --- | --- |
| NIP-09 deletion | **Partial** | `e`-tag delete works; `a`-tag bulk delete missing; `k` not enforced |
| NIP-11 relay info | **Mostly OK (relay)** / **Partial (client)** | Server schema has `banner`/`self`/`terms`; client `Nip11.ts` lags |
| NIP-16/33 treatment | **Partial** | Replaceable/addressable OK; ephemeral still stored |
| NIP-20 OK results | **Mostly OK** | Prefix-style reasons used; coverage good enough |
| NIP-40 expiration | **Mostly OK** | Helpers + module + tests; confirm query-path filtering everywhere |
| NIP-42 AUTH | **Mostly OK** | Challenge/verify flow + tests |
| NIP-70 protected | **Mostly OK** | Default reject without AUTH; auth-same-pubkey path present |
| NIP-10 threading | **Mostly OK** | Root/reply/q parse; legacy `mention` still accepted |
| NIP-17 private DM | **Mostly OK** | Seal/gift-wrap create+unwrap; inbox relays |
| NIP-22 comments | **Mostly OK** | Builders for root/parent kinds |
| NIP-28 public chat | **Legacy OK** | Full client surface; unrecommended |
| NIP-29 groups | **Stale / Partial** | Load/parse metadata/admins/members only; major recent features missing |
| NIP-C7 chats | **Mostly OK** | Kind 9 + `q` reply |
| NIP-7D threads | **Mostly OK** | Kind 11 + NIP-22 replies |
| NIP-25 reactions | **Partial** | Kind 7 basic; missing `a`/`k`/kind 17 external |
| NIP-32 labeling | **Partial** | Publish OK; **namespace query silently no-ops** |
| NIP-56 reporting | **Mostly OK** | Profile/note/blob templates |
| NIP-58 badges | **Stale** | Deprecated profile badges kind; no badge sets |
| NIP-72 communities | **Legacy OK** | Wrapper only; unrecommended |
| NIP-85 assertions | **Missing** | No kinds 30382–30385 / 10040 |

### Priority stack (this scope)

1. **P0 — NIP-01 open single-letter filters** (shared with payments; unblocks `#L`/`#l`/`#h`)
2. **P0 — NIP-32 query correctness** (depends on #1)
3. **P0 — NIP-58 profile badges → kind 10008 + badge sets 30008**
4. **P1 — NIP-85 Trusted Assertions** (new service; reputation backbone)
5. **P1 — NIP-29 metadata + moderation surface catch-up** (client first; relay policy later)
6. **P1 — NIP-09 `a`-tag deletion**
7. **P2 — NIP-16 true ephemeral (broadcast-only)**
8. **P2 — NIP-25 `a`/`k`/kind 17; NIP-11 client type parity**
9. **P3 — Document NIP-28/72 as legacy; prefer 29/C7**

---

## 1. Core protocol (NIP-01 adjacent)

### 1.1 NIP-09 — Event deletion request

**Spec:** `~/work/projects/repos/nips/09.md`  
**Code:** `src/relay/core/MessageHandler.ts`, `src/relay/core/nip/modules/Nip09Module.ts`  
**Tests:** `src/relay/Nip09Deletion.test.ts`

#### Present

- Kind `5` handled in `MessageHandler` before/alongside storage.
- For each `e` tag: load target, delete only if `target.pubkey === deletion.pubkey`.
- Integration test: author deletes own event; event disappears from subsequent queries.
- Module advertises NIP-09 support.

#### Gaps

| Gap | Severity | Notes |
| --- | --- | --- |
| No `a` tag handling | **P1** | Spec: when `a` is used, relays SHOULD delete **all versions** of that replaceable/addressable event up to the deletion `created_at`. Not implemented. |
| `k` tags ignored | **P2** | Spec: deletion requests SHOULD include `k` for each deleted kind. Clients neither require nor relays validate. |
| Client helper | **P3** | No first-class `deleteEvents({ e?, a?, k?, reason? })` Effect helper (apps hand-build kind 5). |
| Cross-relay broadcast guidance | **P3** | Spec says clients SHOULD rebroadcast deletion requests; no pool helper. |

#### Acceptance criteria

- [ ] Kind 5 with `a` deletes matching replaceable/addressable history ≤ `created_at` for same author.
- [ ] Mixed `e` + `a` + multiple `k` tags work.
- [ ] Tests cover wrong-author no-op and addressable multi-version delete.

---

### 1.2 NIP-11 — Relay information document

**Spec:** `~/work/projects/repos/nips/11.md`  
**Code (relay):** `src/relay/core/RelayInfo.ts`, `src/relay/core/nip/modules/Nip11Module.ts`  
**Code (client):** `src/core/Nip11.ts`  
**Tests:** `src/core/Nip11.test.ts`, `src/relay/RelayInfo.test.ts`

#### Present (relay)

`RelayInfo` schema includes current fields of interest:

- `banner`, `icon`, `pubkey`, **`self`**, `contact`, `supported_nips`, `software`, `version`
- `privacy_policy`, **`terms_of_service`**
- `limitation` including `default_limit`, `restricted_writes`, auth/payment flags, created_at bounds
- retention, fees, countries, languages, tags, posting policy

#### Gaps

| Gap | Severity | Notes |
| --- | --- | --- |
| Client `Nip11.ts` type lag | **P2** | `BasicRelayInformation` / `Limitations` miss `banner`, `self`, `terms_of_service`, `privacy_policy`, `default_limit`; still list `max_filters` / `min_prefix` not in current limitation example. |
| `nip29` extension object | **P2** | Spec (NIP-29) advertises `{ "nip29": { "subgroups": true } }`; not modeled. |
| CORS / Accept handling | Info | Assume Bun server implements; re-verify when touching HTTP path. |

#### Recommendation

Align `src/core/Nip11.ts` with `RelayInfo.ts` (single shared type if possible) so client parsers do not drop modern fields.

---

### 1.3 NIP-16 / 33 — Event treatment (addressable)

**Spec:** kind ranges now live primarily in NIP-01; module still named NIP-16.  
**Code:** `src/relay/core/nip/modules/Nip16Module.ts`, kind helpers in `src/core/Schema.ts`

#### Present

- Replaceable (`0`, `3`, `10000–19999`) → `action: "replace"` with author+kind filter.
- Addressable (`30000–39999`) → replace by author+kind+`d`.
- Kind range helpers match NIP-01 exclusive upper bounds.

#### Gaps

| Gap | Severity | Notes |
| --- | --- | --- |
| Ephemeral still stored | **P1** | Code: *“For now, we still store ephemeral events”* — NIP-01 says `20000–29999` are not expected to be stored. Should be broadcast-only (+ optional mute OK). |
| Same-second tie-break | **P2** | NIP-01: on equal `created_at`, keep lowest id. Confirm store path always applies. |
| Terminology | **P3** | Prefer “addressable” in docs/API alongside “parameterized replaceable”. |

---

### 1.4 NIP-20 — Command results

**Code:** `src/relay/core/MessageHandler.ts`, `src/relay/core/nip/modules/Nip20Module.ts`  
**Tests:** `src/relay/Nip20CommandResults.test.ts`

#### Present

- `OK` responses with machine-readable prefixes (`duplicate:`, `auth-required:`, `error:`, `rate-limited`, `invalid:`).
- Module exists for advertisement.

#### Gaps

| Gap | Severity | Notes |
| --- | --- | --- |
| Prefix consistency | **P3** | Some reasons may omit trailing colon style; NIP-01 lists `duplicate`, `pow`, `blocked`, `rate-limited`, `invalid`, `restricted`, `mute`, `error`. Spot-check all rejection paths. |
| `mute:` for no-op ephemeral | **P2** | If ephemeral becomes broadcast-only, use `mute:` when no one is listening (NIP-01 example). |

---

### 1.5 NIP-40 — Expiration

**Code:** `src/core/Nip40.ts`, `src/relay/core/nip/modules/Nip40Module.ts`, store backends  
**Tests:** `src/relay/Nip40Expiration.test.ts`, `src/core/Nip40.test.ts`

#### Present

- Client helpers: get/isExpired/createExpirationTag.
- Relay policy rejects past expiration on publish.
- Advertised via module.

#### Gaps

| Gap | Severity | Notes |
| --- | --- | --- |
| Query-path filtering | **P2** | Spec: relays SHOULD NOT send expired events even if stored. Confirm every store/query backend filters on read, not only write. |
| Lazy purge | Info | Spec allows delayed deletion — OK. |

---

### 1.6 NIP-42 — Client authentication

**Code:** `src/relay/core/AuthService.ts`, `src/relay/core/nip/modules/Nip42Module.ts`, `src/core/Nip42.ts`  
**Tests:** module + auth service tests

#### Present

- Challenge issuance, AUTH event verify (challenge, relay URL, kind, timestamp window).
- Protected-event path depends on authenticated pubkey.

#### Gaps

| Gap | Severity | Notes |
| --- | --- | --- |
| Forced auth for restricted REQs | **P2** | Spec use-cases include auth before reading DMs / paid subs. Pipeline supports `auth_required` limitation; not all subscription paths may gate uniformly. |
| Client auto-AUTH UX | **P3** | Client helpers exist; pool-level auto-respond may be incomplete depending on product needs. |

---

### 1.7 NIP-70 — Protected events

**Code:** `src/relay/core/MessageHandler.ts`, `src/relay/core/nip/modules/Nip70Module.ts`  
**Tests:** `src/relay/Nip70Protected.test.ts`

#### Present

- Default: events with `["-"]` rejected with `auth-required:` when unauthenticated / wrong pubkey.
- Module advertises support.

#### Gaps

| Gap | Severity | Notes |
| --- | --- | --- |
| Repost embedding of protected events | **P2** | Spec: relays SHOULD reject reposts that embed protected events. Not audited. |
| Auth-accept happy path test | **P2** | Default-reject tested; authenticated same-pubkey accept should have explicit integration test if not already. |

---

## 2. Chat, groups, and threading

### 2.1 NIP-28 — Public chat (legacy)

**Spec:** unrecommended → NIP-29  
**Code:** `src/client/ChatService.ts`, `src/relay/core/nip/modules/Nip28Module.ts`  
**Tests:** `src/client/ChatService.test.ts`

#### Present

Full client surface for kinds **40–44**:

- create channel (40), update metadata (41) with categories `t`, send message (42) with NIP-10-style root/reply, hide (43), mute (44)
- get channel / get messages helpers
- Relay module for advertisement

#### Gaps / positioning

| Gap | Severity | Notes |
| --- | --- | --- |
| Upstream unrecommended | Product | Prefer NIP-29 for new group products. |
| No checkout-style “moderation labels” bridge | Info | NIP-32 example uses `nip28.moderation` namespace — optional. |

**Recommendation:** keep for interop; mark legacy in SUPPORTED_NIPS / README; do not expand feature set.

---

### 2.2 NIP-29 — Relay-based groups (**highest chat priority**)

**Spec:** heavily updated through 2026-07 (`banner`, invite codes, LiveKit AV, subgroups, pin `a` tags, roles, etc.)  
**Code:** `src/client/Nip29Service.ts` only — **no relay NIP-29 policy module**  
**Tests:** `src/client/Nip29Service.test.ts`

#### Present

Client **read** path:

- `loadGroup` / fetch metadata (39000), admins (39001), members (39002)
- `fetchRelayInformation`
- Parsers for metadata/admins/members

Kinds known in code: **39000, 39001, 39002** only.

#### Critical metadata drift

Current upstream metadata tags include:

| Spec tag | Meaning | Current parser |
| --- | --- | --- |
| `private` | members-only **read** | looks for `public` instead |
| `restricted` | members-only **write** | missing |
| `closed` | join requests ignored | looks for `open` instead |
| `hidden` | hide metadata from non-members | missing |
| `banner` | banner URL | missing |
| `supported_kinds` | allowed kinds | missing |
| `livekit` | AV space | missing |
| `parent` / `child` | subgroups | missing |

`GroupMetadata.isPublic` / `isOpen` are **inverted/legacy** relative to current `private` / `closed` flags.

#### Missing event surface (client)

| Kind | Name | Status |
| --- | --- | --- |
| 39003 | group roles | missing |
| 39004 | livekit participants | missing |
| 39005 | pinned events (`e` + `a`) | missing |
| 9000 | put-user | no builder |
| 9001 | remove-user | no builder |
| 9002 | edit-metadata | no builder |
| 9005 | delete-event | no builder |
| 9007 / 9008 | create/delete group | no builder |
| 9009 | create-invite | no builder |
| 9010 | update-pin-list (e/a) | no builder |
| 9021 | join request (+ `code`) | no builder |
| 9022 | leave request | no builder |

Also missing:

- `h` tag helpers for user content into groups  
- `previous` timeline reference helpers / validation  
- Invite suffix on group naddr (`naddr1...?invite=`)  
- LiveKit token endpoint client (`/.well-known/nip29/livekit/<group-id>` + NIP-98)  
- Subgroup tree assembly from `parent`/`child`  
- NIP-11 `nip29.subgroups` detection  
- NIP-51 `kind:10009` “my groups” integration (may live partially in Nip51Service — not wired here)  
- `GroupAdminPermission` still lists legacy `add-user` name alongside `put-user`

#### Relay side

There is **no** NIP-29 relay module enforcing membership, `h` tags, late publication, timeline references, or relay-signed metadata (39000 signed by `self`). That is acceptable only if this repo’s relay is not a group host; for full compliance as a group relay it is a large separate workstream.

#### Recommendation (phased)

1. **Parse fix:** map `private`/`restricted`/`closed`/`hidden`/`banner`/`supported_kinds`/`livekit`/`parent`/`child` correctly; deprecate `isPublic`/`isOpen` or derive them as inverses.  
2. **Client write helpers:** join/leave, put-user/remove-user, edit-metadata, pins (with `a` tags), invite create/use.  
3. **Subgroups + NIP-11 `nip29` object.**  
4. **LiveKit** only if product needs AV.  
5. **Relay enforcement** only if hosting groups.

---

### 2.3 NIP-C7 — Chats (kind 9)

**Spec:** `~/work/projects/repos/nips/C7.md` (2026-05: chat views MUST only fetch kind 9)  
**Code:** `src/client/NipC7Service.ts`  
**Tests:** `src/client/NipC7Service.test.ts`

#### Present

- Publish kind 9 messages.
- Quote-reply via `q` tag (event id, relay, pubkey).
- List helpers.

#### Gaps

| Gap | Severity | Notes |
| --- | --- | --- |
| Chat-view fetch guidance | **P3** | Spec: chat UIs MUST only fetch kind 9. Document in API; optional `subscribeChatView` that hard-codes kinds `[9]`. |
| Quote other content types | Info | Spec allows quoting other kinds via NIP-18 inside kind 9 — not required helpers. |

**Grade: Mostly OK** — good modern alternative to NIP-28 for simple public chat streams.

---

### 2.4 NIP-7D — Forum threads

**Spec:** kind 11 + NIP-22 replies always to root  
**Code:** `src/client/Nip7DService.ts`  
**Tests:** present

#### Present

- Publish thread with optional `title`.
- Reply via kind 1111 with `K`/`E` (and parent `e`/`k`) pointing at root.
- List by author.

#### Gaps

| Gap | Severity | Notes |
| --- | --- | --- |
| Nested reply prevention | **P2** | Spec: always reply to root. Service should refuse/redirect if caller passes non-root parent. |
| Thread discovery filters | **P3** | Title is not a single-letter index tag; search/NIP-50 optional. |

---

### 2.5 NIP-10 — Text notes and threads

**Code:** `src/client/Nip10Service.ts`  
**Tests:** `src/client/Nip10Service.test.ts`

#### Present

- Parse marked `e` tags (`root` / `reply`), legacy positional markers, `q` quotes, `p` profiles.
- Helpers: `isReply`, `isRoot`, `getReplyToId`, `getRootId`.

#### Gaps

| Gap | Severity | Notes |
| --- | --- | --- |
| Still accepts `mention` marker | **P3** | Spec removed mention marker in favor of `q` (2025-02). Parsing legacy is fine; builders should not emit `mention`. |
| Build helpers | **P3** | Stronger on parse than on “build kind 1 reply tags”. |

---

### 2.6 NIP-17 — Private direct messages

**Code:** `src/client/Nip17Service.ts`, `src/core/Nip59.ts`  
**Tests:** `src/client/Nip17Service.test.ts`, `src/core/Nip17.test.ts`

#### Present

- Kind 14 chat / 15 file rumors with subject, reply, quotes.
- NIP-59 seal + gift wrap to receivers (`wrapManyEvents`).
- Unwrap path.
- Kind 10050 DM inbox relays publish/fetch.

#### Gaps

| Gap | Severity | Notes |
| --- | --- | --- |
| Encrypted kind 7 reactions in DM | **P2** | Spec allows kind 7 reactions inside encrypted chat; no dedicated helper. |
| Group DM room semantics | **P3** | Multi-`p` rooms supported at wrap level; higher-level “room id” UX optional. |
| Relay policy for kind 1059 | Info | Storage is normal ephemeral/replaceable rules; gift wraps are regular. |

**Grade: Mostly OK** — preferred private chat path vs NIP-04.

---

### 2.7 NIP-22 — Comments

**Code:** `src/wrappers/nip22.ts`  
**Tests:** `src/wrappers/nip22.test.ts`

#### Present

- Kind 1111 builder with root (`A`/`E`/`I` + `K`) and parent (`a`/`e`/`i` + `k`) pointers, author refs.

#### Gaps

| Gap | Severity | Notes |
| --- | --- | --- |
| Effect service | **P3** | Wrapper-only; NIP-7D already composes it. |
| Full tag matrix from latest spec | **P2** | Spot-check against current 22.md for any new required uppercase/lowercase pairs if spec drifted. |

---

## 3. Reputation, labeling, badges, reports

### 3.1 NIP-32 — Labeling

**Spec:** kind 1985 + `L`/`l` tags; self-reporting on other kinds  
**Code:** `src/client/Nip32Service.ts`  
**Tests:** `src/client/Nip32Service.test.ts`

#### Present

- `publishLabel` with namespaces (`L`), labels (`l` + mark), targets `e`/`p`/`a`/`r`/`t`.
- `queryLabels` API surface.

#### Gaps

| Gap | Severity | Notes |
| --- | --- | --- |
| `#L` / `#l` filters stripped | **P0** | Same NIP-01 Filter hole as `#u`. Verified: `decodeFilter({ kinds:[1985], "#L":["ugc"] })` → `{ kinds:[1985] }` only. Namespace queries are currently **false confidence**. |
| Self-reporting helpers | **P2** | Spec allows `L`/`l` on non-1985 kinds; no `withLabels(event, …)` helper. |
| Ontology presets | **P3** | No built-in namespaces for moderation/reputation (apps supply strings). |

#### Recommendation

Ship open tag filters first, then add regression tests that `queryLabels({ namespaces: ["nip28.moderation"] })` actually filters.

---

### 3.2 NIP-56 — Reporting

**Code:** `src/wrappers/nip56.ts`  
**Tests:** `src/wrappers/nip56.test.ts`

#### Present

- Kind 1984 builders for profile / note / blob reports.
- Report types: nudity, malware, profanity, illegal, spam, impersonation, other.
- Blob `x` + optional `e` + `server`.

#### Gaps

| Gap | Severity | Notes |
| --- | --- | --- |
| NIP-32 `L`/`l` on reports | **P3** | Spec MAY; not in templates. |
| Effect service | **P3** | Wrapper-only. |
| Relay-side report consumption | Info | Out of scope unless building moderation relay policies. |

**Grade: Mostly OK** for client emission.

---

### 3.3 NIP-58 — Badges (**high risk for reputation UX**)

**Spec:** Profile Badges = **kind 10008** (NIP-51 list); Badge Set = **kind 30008**; Definition 30009; Award 8  
**Code:** `src/client/Nip58Service.ts`  
**Tests:** `src/client/Nip58Service.test.ts`

#### Present

- Definition (30009) + Award (8) templates/validation.
- “Profile badges” generator.

#### Gaps (confirmed still open since June audit)

| Gap | Severity | Notes |
| --- | --- | --- |
| Profile Badges kind is **30008** with `d=profile_badges` | **P0** | Upstream: Profile Badges is **10008**; old 30008/`profile_badges` is deprecated migration. |
| Badge Sets missing | **P0** | Kind 30008 is now NIP-51 **sets**, not profile badges. |
| No publish/query service methods | **P2** | Templates only; no RelayService integration. |
| Thumb dimension recommendations | **P3** | Spec guidance only. |

#### Recommendation

Same fix as prior audit: migrate profile badges to 10008; add badge sets on 30008; keep legacy parse helper for `d=profile_badges`.

---

### 3.4 NIP-85 — Trusted Assertions (**missing**)

**Spec:** `~/work/projects/repos/nips/85.md`  
**Code:** none  
**SUPPORTED_NIPS:** not listed

#### Spec surface

| Kind | Subject | `d` value |
| --- | --- | --- |
| 30382 | user | pubkey |
| 30383 | event | event id |
| 30384 | addressable | address |
| 30385 | NIP-73 id | i-tag |
| 10040 | user provider preferences | (list of trusted assertion providers) |

Rich result tags: `rank`, `followers`, zap aggregates, report counts, activity windows, etc.

#### Why it matters

This is the standardized offload path for web-of-trust / reputation / orange-check style scores. Without it, clients invent private schemas.

#### Recommendation

New `TrustedAssertionsService` (or `Nip85Service`):

- parse/validate assertion events by kind  
- query by `d` + authors (provider keys)  
- publish provider preference list (10040)  
- typed accessors for known result tags (`rank`, `followers`, …)  
- document that algorithms are provider-specific  

**Priority: P1** for any reputation product.

---

### 3.5 NIP-25 — Reactions (social signal)

**Code:** `src/client/Nip25Service.ts`, `src/wrappers/nip25.ts`

#### Present

- Kind 7 create with `e`/`p` of target; inherits prior e/p tags.
- `getReactedEventPointer` uses last e/p.

#### Gaps

| Gap | Severity | Notes |
| --- | --- | --- |
| No `a` for addressable targets | **P2** | Spec SHOULD include `a` with `e` for addressable events. |
| No `k` kind tag | **P2** | Spec MAY/SHOULD include stringified kind. |
| Kind 17 external content reactions | **P2** | Spec section for NIP-73 `i`/`k` targets missing entirely. |
| Custom emoji / empty content semantics | **P3** | Document `+`/`-`/emoji rules in API docs. |

---

### 3.6 NIP-72 — Moderated communities (legacy)

**Spec:** unrecommended → NIP-29  
**Code:** `src/wrappers/nip72.ts`  
**Tests:** present

#### Present

Community definition, posts, approvals (kind 4550) builders.

#### Recommendation

Do not expand; Forum/OpenAgents group work should target **NIP-29** (+ C7/7D as needed).

---

## 4. Cross-cutting themes

### 4.1 Filter schema is the shared P0

From the payments pass and this pass, the hard-coded `#e/#p/#a/#d/#t` filter model breaks:

| Tag filter | Used by |
| --- | --- |
| `#u` | NIP-61 nutzaps |
| `#L` / `#l` | NIP-32 labels (and NIP-56 optional) |
| `#h` | NIP-29 group content |
| `#f` / `#s` / `#g` / `#y` | NIP-69 orders |
| `#k` | reactions, zaps, deletions metadata |

Until fixed, many “query” methods in client services are incomplete by construction.

### 4.2 Preferred chat stack (product)

| Use case | Prefer | Avoid for new work |
| --- | --- | --- |
| Private 1:1 / small group DM | NIP-17 | NIP-04 |
| Public stream chat | NIP-C7 (kind 9) | NIP-28 |
| Closed / moderated groups | NIP-29 | NIP-72 / NIP-28 |
| Forum-style threads | NIP-7D + NIP-22 | Kind 1 nested reply trees alone |
| Social note replies | NIP-10 + NIP-22 for non-kind-1 | — |

### 4.3 Preferred reputation stack (product)

| Use case | Prefer |
| --- | --- |
| User labels / topics / licenses | NIP-32 |
| Objectionable content signals | NIP-56 (+ optional NIP-32) |
| Achievements / display badges | NIP-58 (**after** 10008 migration) |
| Aggregated WoT / ranks / stats | **NIP-85** (to implement) |
| Group membership authority | NIP-29 relay-signed 39001/39002 |

### 4.4 Relay vs client responsibility

| Capability | Client today | Relay today |
| --- | --- | --- |
| NIP-29 groups | partial read client | no group policy module |
| NIP-28 chat | full client | advertise-only module |
| NIP-09/40/42/70 | light client helpers | real enforcement |
| NIP-32/56/58/85 | partial / missing | N/A (client protocols) |

---

## 5. Suggested implementation order (this scope)

### Phase A — Shared foundation (with payments)

1. Open single-letter tag filters (`Schema` + `FilterMatcher` + stores).  
2. Tests: `#L`, `#l`, `#h`, `#u`, `#k`.  
3. Fix NIP-32 `queryLabels` regression.

### Phase B — Reputation correctness

1. NIP-58 migrate Profile Badges → 10008; add Badge Sets 30008; legacy parse.  
2. NIP-85 service scaffold (30382–30385 + 10040).  
3. NIP-25 `a`/`k` + kind 17.  
4. Optional NIP-56 + NIP-32 combined report labels.

### Phase C — Core relay fixes

1. NIP-09 `a`-tag deletion.  
2. NIP-16 broadcast-only ephemeral.  
3. NIP-11 client type alignment + optional `nip29` extension field.  
4. NIP-70 repost embedding check if NIP-18 path embeds events.

### Phase D — Groups (NIP-29)

1. Metadata parser modernization (`private`/`closed`/…/`banner`).  
2. Join/leave + put-user/remove-user + pin list with `a`.  
3. Subgroups tree + NIP-11 `nip29.subgroups`.  
4. Invite codes + naddr suffix.  
5. LiveKit only if product requires.  
6. Relay hosting policy as a separate epic.

### Phase E — Chat productization

1. Document preferred stack; mark 28/72 unrecommended in SUPPORTED_NIPS notes.  
2. NIP-C7 chat-view subscribe helper.  
3. NIP-7D force-reply-to-root guard.  
4. NIP-17 encrypted reaction helper (optional).

---

## 6. Out of scope / deferred

- Full re-audit of NIP-51 list kinds beyond badges/groups pointers.  
- NIP-EE / Marmot E2EE messaging (supersession note in prior audit).  
- NIP-67 EOSE completeness (noted in payments companion).  
- Implementing the fixes (this commit is documentation only).

---

## Appendix — File map

```text
Core
  src/relay/core/MessageHandler.ts          # 09, 42, 70, store pipeline
  src/relay/core/nip/modules/Nip09Module.ts
  src/relay/core/nip/modules/Nip11Module.ts
  src/relay/core/RelayInfo.ts
  src/core/Nip11.ts
  src/relay/core/nip/modules/Nip16Module.ts
  src/relay/core/nip/modules/Nip20Module.ts
  src/core/Nip40.ts + Nip40Module
  src/relay/core/nip/modules/Nip42Module.ts
  src/relay/core/nip/modules/Nip70Module.ts

Chat / groups / threads
  src/client/ChatService.ts                 # NIP-28
  src/client/Nip29Service.ts                # NIP-29
  src/client/NipC7Service.ts                # NIP-C7
  src/client/Nip7DService.ts                # NIP-7D
  src/client/Nip10Service.ts                # NIP-10
  src/client/Nip17Service.ts                # NIP-17
  src/wrappers/nip22.ts                     # NIP-22

Reputation
  src/client/Nip32Service.ts                # NIP-32
  src/wrappers/nip56.ts                     # NIP-56
  src/client/Nip58Service.ts                # NIP-58
  src/client/Nip25Service.ts                # NIP-25
  src/wrappers/nip72.ts                     # NIP-72
  (missing) NIP-85
```
