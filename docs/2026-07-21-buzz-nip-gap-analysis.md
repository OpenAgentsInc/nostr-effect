# NIP Gap Analysis — Full `buzz` NIP-Set Support

**Date:** 2026-07-21
**Repo:** `OpenAgentsInc/nostr-effect`
**Target:** the complete set of NIPs used by Block Inc's `block/buzz` workspace relay
**Sources:**
- `~/work/projects/repos/buzz` (audited commit `e9188c03f6c2460983a3dac0fa7702b468838e62`, read-only)
- `~/work/projects/repos/buzz/docs/nips/*` — the 14 custom buzz NIP specs
- `~/work/projects/repos/buzz/crates/buzz-core/src/pairing/NIP-AB.md` — a 15th custom NIP (device pairing)
- `~/work/openagents/docs/teardowns/2026-07-21-buzz-teardown.md` — buzz teardown with NIP appendix
- `~/work/projects/repos/nips` — canonical upstream NIP specs (read-only)
- This repo: `src/`, `docs/SUPPORTED_NIPS.md`

> This document is analysis and roadmap only. It does **not** implement any NIP.
> The canonical support table for this repo stays `docs/SUPPORTED_NIPS.md`.

---

## Executive summary

The target is everything `buzz` speaks: **15 standard NIPs plus Blossom media**, and
**15 custom, buzz-authored NIPs** (the 14 in `buzz/docs/nips/` plus the separately
filed device-pairing `NIP-AB`).

| Bucket | Target | Supported today | Gap |
| --- | --- | --- | --- |
| Standard workspace NIPs (NIP-01/05/09/10/11/16/17/25/29/34/42/43/50/70/98) | 15 | **15** | 0 |
| Blossom media (this repo tracks it as NIP-B7) | 1 | **1** | 0 |
| Custom buzz NIPs (AA, AB, AE, AM, AO, AP, CW, DV, ER, GS, IA, OA, PL, RS, WP) | 15 | **0** | 15 |
| **Total** | **31** | **16** | **15** |

**Headline:** every *standard* NIP `buzz` relies on is already implemented in
`nostr-effect`, most with client service, relay module, and tests. The gap is the
entire **custom agent-and-workspace NIP family** that Block authored for `buzz`.

**The good news is the floor is already poured.** Every cryptographic and structural
primitive the custom NIPs need already exists and is vector-tested in this repo:

- NIP-44 v2 conversation-key encryption — `src/services/Nip44Service.ts`
  (`getConversationKey`, `encrypt`, `decrypt`)
- NIP-59 gift wrap — `src/wrappers/nip59.ts` (`wrapEvent`, `unwrapEvent`, `createSeal`)
- BIP-340 Schnorr sign/verify and event finalize/verify — `src/core/*` (used by
  NIP-06, NIP-98, EventService)
- NIP-42 auth (`kind:22242`) — `src/relay/core/nip/modules/Nip42Module.ts`
- NIP-43 relay access metadata — `src/wrappers/nip43.ts`
- Addressable / replaceable / ephemeral event handling — `src/relay/core/nip/modules/Nip16Module.ts`
- NIP-40 expiration, NIP-09 deletion, NIP-31 `alt`, NIP-70 protected, NIP-65 relay lists,
  NIP-11 relay info — all present

So none of the 15 gaps require new foundational crypto. They are additive
**schema + kind + tag + derivation** work on primitives that already ship.

`nostr-effect` also has a rare advantage over a pure client library: it ships **both a
client and a relay** (`src/client/**` and `src/relay/**`). Several custom buzz NIPs are
relay-signed projections or relay-admission policies; this repo can implement *both*
halves (the client reader and the relay module) rather than only consuming someone
else's relay.

### Recommended priority order (phase 1 first)

1. **NIP-OA** — Owner Attestation. The shared cryptographic root; NIP-AA, NIP-GS, and
   NIP-IA all reuse it. Small, fully generalizable, zero relay coupling.
2. **NIP-AA** — Agent Authentication. Agent gains virtual membership by presenting a
   NIP-OA `auth` tag during NIP-42 auth. Small on the client side.
3. **NIP-AP** — Agent Personas. Plaintext addressable `kind:30175` blueprint. Small,
   the easiest of the set, unblocks agent discovery.
4. **NIP-AE** — Agent Engrams. Owner-decryptable `kind:30174` memory. Medium. The
   flagship idea and the one that maps directly onto the OpenAgents owner-decryptable
   memory invariant (buzz teardown §6.2).

These four are the portable, high-leverage core: an owner can attest an agent, the
agent can authenticate, describe itself, and hold owner-auditable memory — all with
primitives this repo already has.

### Scope honesty

The custom NIPs are Block-authored and pre-numbered (they advertise via NIP-11
`supported_extensions: ["nip-xx"]`, never `supported_nips`). Adopting them means
implementing the **protocol**, not depending on `buzz`. Some are too tied to buzz's
own infrastructure to generalize cleanly — most sharply **NIP-PL** (push leases),
which bakes a normative "Public APNs Gateway Profile" at `push.buzz.xyz` and a pinned
`buzz-relay` dispatch seam into the spec. See [§6](#6-scope-and-generalizability).
The OpenAgents buzz teardown (§7) explicitly recommends *not* adopting these kinds
while they remain a single-vendor registry; this roadmap exists because the owner
wants `nostr-effect` positioned to support the full set if and when that decision
flips. It is a readiness plan, not a directive to ship tenant-coupled kinds today.

---

## 1. Method

1. Confirmed the standard NIP list from the teardown appendix and cross-checked it
   against `buzz` source (`git grep -i nip`, `crates/buzz-core/src/kind.rs`, README).
2. Verified each standard NIP has a real implementing file in this repo (not just a
   row in `SUPPORTED_NIPS.md`).
3. Read all 14 custom specs in `buzz/docs/nips/` plus the separately filed `NIP-AB`,
   and captured for each: event kinds, tags, encryption/signing, dependencies,
   buzz-specificity, and effort against this repo's existing primitives.
4. Mapped each gap onto the primitives already present in `src/`.

`nippe`/`nip-pe` appear in a raw `git grep` of buzz but are false positives (substring
of "snippet"); there is no NIP-PE spec. The real custom set is the 15 listed here.

---

## 2. What `nostr-effect` supports today (standard target set)

All present, verified by file existence and the repo's own test suite.

| NIP | Title | Status | Implementing module | Notes vs buzz usage |
| --- | --- | --- | --- | --- |
| 01 | Basic protocol flow | ✅ supported | `src/relay/core/nip/modules/Nip01Module.ts`, `src/core/Schema.ts`, `src/relay/core/FilterMatcher.ts` | Open single-letter `#` tag filters supported (buzz leans on `#h`). |
| 05 | DNS identifiers | ✅ supported | `src/client/Nip05Service.ts` | — |
| 09 | Event deletion | ✅ supported | `src/relay/core/MessageHandler.ts` (`e` + `a` tags) | — |
| 10 | Reply threading | ✅ supported | `src/client/Nip10Service.ts` | buzz classifies top-level vs reply via marked `reply` e-tags (used by NIP-CW). |
| 11 | Relay information | ✅ supported | `src/relay/core/nip/modules/Nip11Module.ts`, `src/core/Nip11.ts` | Has `self`, banner, terms fields buzz relies on for relay-signed events. |
| 16 | Event treatment (+ NIP-33 addressable) | ✅ supported | `src/relay/core/nip/modules/Nip16Module.ts` | Ephemeral no-store + addressable head selection — needed by the custom kinds. |
| 17 | Private direct messages | ✅ supported | `src/client/Nip17Service.ts` | buzz DMs are NIP-17 gift wrap. |
| 25 | Reactions | ✅ supported | `src/client/Nip25Service.ts` | — |
| 29 | Relay-based groups | ✅ supported | `src/client/Nip29Service.ts`, `src/relay/core/nip/modules/Nip29Module.ts` | Full moderation builders (9000–9010) + membership kinds; buzz is a heavy NIP-29 user. |
| 34 | Git collaboration | ✅ supported | `src/core/Nip34.ts` | Event kinds present; buzz layers a relay-hosted forge on top (out of NIP scope). |
| 42 | Client authentication | ✅ supported | `src/relay/core/nip/modules/Nip42Module.ts` | `kind:22242`; the vehicle NIP-AA reuses. |
| 43 | Relay access metadata | ✅ supported | `src/wrappers/nip43.ts` | Membership advertisement NIP-AA/NIP-IA reference. |
| 50 | Search | ✅ supported | `src/client/Nip50Service.ts`, `src/relay/core/FilterMatcher.ts` | Extensions + ranking. |
| 70 | Protected events | ✅ supported | `src/relay/core/MessageHandler.ts` | `-` tag; NIP-IA marks archival requests protected. |
| 98 | HTTP auth | ✅ supported | `src/core/Nip98.ts`, `src/wrappers/nip98.ts` | Schnorr-verified `kind:27235`; NIP-CW/PL/DV use it on HTTP legs. |
| B7 | Blossom media | ✅ supported | `src/client/BlossomService.ts`, `src/wrappers/nipb7.ts` | BUD-03 `kind:10063`; buzz uses Blossom for media + git CAS. |

Depth caveats (not gaps, but worth tracking):

- **NIP-29:** buzz uses a relay-signed-membership variant where clients may not submit
  membership kinds and discovery events are channel-scoped. This repo has the builders
  and a relay module; matching buzz's exact admission policy is relay-config work, not
  a missing primitive.
- **NIP-34:** buzz hosts git over the relay (Smart HTTP + S3 CAS). The NIP-34 *event*
  surface is covered here; the forge is a separate product concern and relates to the
  custom **NIP-GS** below.

---

## 3. The gap — custom buzz NIPs

None are implemented in `nostr-effect` today. Effort is rated against this repo's
existing primitives (NIP-44/59/42/43, Schnorr, addressable events). "Client" = a pure
client-authored convention this library can own end-to-end; "relay-signed" = the value
comes from relay-side computation and the client is mainly a verifying reader (this
repo can also implement the relay module).

| NIP | Title | Status | Kinds | New signing/crypto | Depends on | Class | Effort |
| --- | --- | --- | --- | --- | --- | --- | --- |
| **OA** | Owner Attestation | ❌ missing | none (`auth` tag) | custom Schnorr preimage `nostr:agent-auth:` | BIP-340 | client / primitive | **Small** |
| **AA** | Agent Authentication | ❌ missing | reuses `22242` | verify NIP-OA tag at auth | OA, 42, 43 | client + relay policy | **Small** |
| **AP** | Agent Personas | ❌ missing | `30175` (+`30177`) | none (plaintext) | 01/33 | client | **Small** |
| **AE** | Agent Engrams | ❌ missing | `30174` addressable | NIP-44 + HMAC-blinded `d` tag | 44, 65, 09, 31 | client | **Medium** |
| **AM** | Agent Turn Metrics | ❌ missing | `44200` regular | NIP-44 encrypt-to-owner | 44, 42, AO | client + relay gate | **Small–Medium** |
| **AO** | Agent Observability | ❌ missing | `24200` ephemeral | NIP-44 bidirectional (+ opt NIP-59) | 44, 42, 29, 59 | client + relay ephemeral | **Small–Medium** |
| **ER** | Event Reminders | ❌ missing | `30300` addressable | NIP-44 encrypt-to-self | 40, 42, 44, 65, 09 | client (+ opt relay push) | **Small** |
| **RS** | Read State Sync | ❌ missing | `30078` (NIP-78 reuse) | NIP-44 encrypt-to-self + CvRDT | 78, 44, 09 | client | **Small–Medium** |
| **GS** | Git Object Signing | ❌ missing | none (git-embedded) | custom Schnorr preimage `nostr:git:v1:` | BIP-340, OA (opt) | tooling / CLI | **Medium** |
| **CW** | Channel Window | ❌ missing | `39005`/`39006` relay-signed | verify relay `self` sig | 01, 11, 29, 98, 10 | relay-signed | **Medium** (client) / Large (relay) |
| **DV** | DM Visibility | ❌ missing | `30622` relay-signed | verify relay `self` sig | 11, 43, 29, 42/98 | relay-signed | **Small** (client) / relay-derived |
| **IA** | Identity Archival | ❌ missing | `9035/9036/8002/8003/13535` | relay `self` sig + NIP-OA | 11, 42, 43, 70, OA | relay-signed + user-signed | **Medium** |
| **WP** | Workspace Profile | ❌ missing | `9033` admin-signed | none | 11, 42, 43 | relay role-gated | **Small** |
| **AB** | Device Pairing | ❌ missing | none (sidecar relay flow) | ECDH + HKDF-SHA256 + SAS-6 + NIP-44 v2 | 44 | client + pairing relay | **Medium** |
| **PL** | Push Leases | ❌ missing | `30350` addressable | NIP-44 encrypt-to-executor | 40, 42, 44, 11, 98 | infra-heavy | **Large** |

---

## 4. Per-gap detail — phase-1 targets

### NIP-OA — Owner Attestation (root primitive, Small)

**What it requires.** An `auth` tag by which an owner key authorizes an agent key to
publish under the agent's own authorship (provenance, not delegation):
`["auth", <owner-pubkey-hex>, <conditions>, <sig-hex>]`. The owner signs a BIP-340
Schnorr signature over `SHA256("nostr:agent-auth:" || event.pubkey || ":" || conditions)`.
`conditions` is a `&`-joined string of `kind=<n>`, `created_at<t>`, `created_at>t`
clauses. It defines **no event kind** — it is a reusable tag applicable to any event.

**Primitives already present.** BIP-340 Schnorr sign/verify is already used by
NIP-06/NIP-98/EventService; only a new **domain-separated preimage** and a small
conditions parser are new.

**Concrete work.**
- `Schema` for the `auth` tag and a `Conditions` model (parse/serialize the
  `&`-joined clause string; bounded fields only — `kind` int, two timestamps).
- `OwnerAttestationService` (`Context.Service`) with `sign(agentPubkey, conditions, ownerSeckey)`
  and `verify(authTag, agentPubkey)` returning `Effect<boolean, Nip0aError>`.
- A tagged error type (`Nip0aError`) for malformed tag / bad signature / stale window.
- Note the NIP-IA gotcha for reuse: the preimage pubkey is the **target/agent** key,
  not the request signer.

This is the root: NIP-AA verifies it at connection admission, NIP-GS optionally embeds
it in git signatures, NIP-IA carries it on archival requests. Implement it once, first.

### NIP-AA — Agent Authentication (Small, client side)

**What it requires.** During NIP-42 auth, the agent sends a `kind:22242` event carrying
an owner's NIP-OA `auth` tag. The relay verifies the tag (reusing NIP-OA's construction,
but **not** evaluating `kind=` clauses at admission) and grants the agent "virtual"
membership derived from the owner's NIP-43 membership. `kind=` clauses are advisory at
the connection level unless the relay opts into per-event enforcement.

**Primitives already present.** `kind:22242` (`Nip42Module`), NIP-43 membership state,
NIP-OA (phase-1 item 1).

**Concrete work.**
- Client: an `Nip42Module`/signer extension to attach a NIP-OA `auth` tag to the
  `kind:22242` AUTH event. Trivial once NIP-OA exists.
- Relay (optional, since this repo has one): a `Nip42Module` admission hook that
  verifies the `auth` tag, resolves the owner's membership, mints a virtual session,
  and (optionally) enforces `kind=` per event. Error responses follow the spec's
  `invalid:` / `restricted:` split.

### NIP-AP — Agent Personas (Small, easiest)

**What it requires.** A public, addressable `kind:30175` "blueprint" (NIP-33) describing
how to instantiate an agent: identity, system prompt, model/runtime/provider, name pool.
Keyed by `(pubkey, d)` with a plaintext flat slug `d` (`^[a-z0-9][a-z0-9_-]{0,63}$`),
no `p` tag, optional NIP-31 `alt`. **Deliberately unencrypted** for discovery/indexing;
secrets are prohibited in content (they belong in a NIP-AE `mem/persona` sidecar). Also
references `kind:30177` (instance state) as a companion projection.

**Primitives already present.** Addressable event handling (`Nip16Module`), standard
finalize/verify. No encryption.

**Concrete work.**
- Effect `Schema` for the persona body (typed JSON) and the `kind:30175` envelope.
- `PersonaService` with `build`, `read` (head selection over `(pubkey, d)`), `list`.
- A validator that rejects secret-shaped fields in `content`.

### NIP-AE — Agent Engrams (Medium, flagship)

**What it requires.** Addressable `kind:30174` events holding agent memory, encrypted
with **NIP-44** under the agent↔owner conversation key `K_c` — symmetric, so the owner
can always decrypt everything the agent remembers. Two record types share one envelope:
`core` (exactly one per pair) and `mem/…` (zero or more). The `d` tag is
**HMAC-blinded** so slugs never leak:

```
K_c = nip44_conversation_key(seckey_a, pubkey_o)   // == nip44_conversation_key(seckey_o, pubkey_a)
d   = lower_hex( HMAC-SHA256(K_c, utf8("agent-memory/v1/d-tag") || 0x00 || utf8(slug)) )
```

Envelope: exactly one `d` (64-hex), exactly one `p` (owner pubkey), optional NIP-31
`alt`; `content` is a NIP-44 ciphertext of a JSON body whose `slug` discriminates
`core` vs `mem/…`. Configured relays come from the agent's NIP-65 `kind:10002` write
list (with canonicalization + dedup rules). Head selection tolerates relays that
surface stale addressable versions.

**Primitives already present.** This is the strongest case for "the floor is poured":
`Nip44Service.getConversationKey` already returns the exact `K_c` this NIP needs (HKDF
extract over the ECDH `shared_x` with `salt = "nip44-v2"`), and `encrypt`/`decrypt` are
vector-tested. NIP-65 relay lists (`RelayListService`), NIP-09 deletion, NIP-31 `alt`,
and addressable head selection all exist.

**Concrete work.**
- HMAC-SHA256 `d`-tag derivation helper (domain-separated, `0x00`-delimited) —
  `@noble/hashes` is already a dependency via NIP-44.
- Slug grammar validator (`core` or the `mem/…` regex, ≤255 bytes).
- Effect `Schema` for core/memory bodies and the envelope.
- `EngramService`: `writeCore`, `writeMemory(slug, body)`, `readCore`, `read(slug)`,
  `list`, `tombstone(slug)` — with relay-set resolution and monotonic-write / head
  selection logic.
- Owner-side symmetric read path (owner uses the event `pubkey` as the counterparty
  hint, same `K_c`).

This is the highest-value gap: it is fully generalizable (no relay/tenant coupling) and
it operationalizes the owner-decryptable-memory invariant OpenAgents already wants.

---

## 5. Phased roadmap

Foundational floor (NIP-01/11/42/43/44/59, Schnorr, addressable events, NIP-40/09/31/65/70/98)
is **already done** — the phases below are additive.

### Phase 0 — Prerequisites (complete)

No work. Confirm the vector suites stay green (NIP-44, NIP-59, NIP-06, NIP-98) before
building on them.

### Phase 1 — Foundational agent primitives (portable, high leverage)

| Order | NIP | Effort | Why here |
| --- | --- | --- | --- |
| 1 | **OA** | Small | Shared root; unblocks AA, GS, IA. Zero relay coupling. |
| 2 | **AA** | Small | Agent authentication on top of OA + existing NIP-42. |
| 3 | **AP** | Small | Plaintext persona discovery; no crypto; fast win. |
| 4 | **AE** | Medium | Owner-decryptable memory flagship; reuses existing NIP-44 `K_c`. |

Exit: an owner can attest an agent, the agent authenticates, publishes a public persona,
and holds owner-auditable encrypted memory — all on primitives already in `src/`.

### Phase 2 — Agent data + personal state (portable, NIP-44)

| Order | NIP | Effort | Notes |
| --- | --- | --- | --- |
| 5 | **AM** | Small–Medium | `kind:44200` turn metrics, encrypt-to-owner. Data-modeling; relay owner-gate optional. |
| 6 | **AO** | Small–Medium | `kind:24200` ephemeral telemetry/control, bidirectional NIP-44. Needs relay ephemeral fan-out (this repo has a relay). |
| 7 | **ER** | Small | `kind:30300` reminders, encrypt-to-self + public `not_before`. |
| 8 | **RS** | Small–Medium | `kind:30078` read-state sync, encrypt-to-self + grow-only CvRDT merge. |

These are all NIP-44 conventions this library can own end-to-end. AM/AO's relay-side
owner-gating (`is_agent_owner()`) is a relay policy concern; the event formats are
portable.

### Phase 3 — Git signing + relay-signed projection readers

| Order | NIP | Effort | Notes |
| --- | --- | --- | --- |
| 9 | **GS** | Medium | `nostr:git:v1:` Schnorr signing for git objects. A CLI/tooling artifact (git `gpg.x509.program`), likely a separate export/package rather than core client. |
| 10 | **DV** | Small (client) | `kind:30622` relay-signed DM visibility; client is a verifying reader, relay derives it. |
| 11 | **CW** | Medium (client) | `kind:39005/39006` relay-signed channel window; client sends extended filters + verifies relay `self` sig. |
| 12 | **IA** | Medium | `9035/9036/8002/8003/13535` archival; mix of user-signed requests and relay-signed deltas/snapshots; reuses NIP-OA. |
| 13 | **WP** | Small | `kind:9033` admin-signed workspace icon; read via NIP-11 `icon`. |

For CW/DV/IA/WP this repo can implement both the **client reader** and the **relay
module**, since it owns a relay — a differentiator versus a pure client library.

### Phase 4 — Relay-side and infrastructure-heavy (generalize with care)

| Order | NIP | Effort | Notes |
| --- | --- | --- | --- |
| 14 | **AB** | Medium | Device pairing: `nostrpair://` QR, ECDH + HKDF-SHA256 + SAS-6-digit + NIP-44 v2, over an ephemeral sidecar relay. Crypto is generalizable; needs a pairing-relay flow. |
| 15 | **PL** | Large | Push leases `kind:30350`. Implement the **lease schema + restricted filter grammar** only; the normative buzz APNs gateway profile is out of scope (see §6). |

---

## 6. Scope and generalizability

The custom NIPs split into three honest tiers.

**Tier A — fully generalizable client conventions (adopt cleanly).**
NIP-OA, NIP-AE, NIP-AP, NIP-ER, NIP-RS. Pure client-authored Nostr conventions with no
relay/tenant/DB assumptions. Any relay that stores the relevant event range works.
These are protocol, not buzz.

**Tier B — dual-surface (client reader + relay module), relay-coupled but generalizable.**
NIP-AA, NIP-AM, NIP-AO, NIP-CW, NIP-DV, NIP-IA, NIP-WP. The event formats are portable,
but the *value* depends on relay-side behavior: `is_agent_owner()` ownership lookups
(AA/AM/AO), relay-identity (`self`) signing of derived projections (CW/DV/IA/WP), NIP-70
protection and role state (IA/WP), or ephemeral fan-out (AO). Because `nostr-effect`
ships a relay, it can implement both halves — but matching buzz's exact admission and
projection policy is relay-config/policy work, and some of it (e.g. buzz's private
`hidden_at` column behind NIP-DV, its DM-as-NIP-29-group model) reflects buzz product
decisions rather than a neutral protocol.

**Tier C — too buzz-infrastructure-specific to generalize as-is.**
- **NIP-PL (push leases)** is the clearest case. The spec bakes in a normative "Public
  APNs Gateway Profile" at `https://push.buzz.xyz` (App Attest enrollment, capability
  issuance), a pinned `buzz-relay` dispatch seam at a specific SHA, an `event_mentions`
  table, and a `uuid-v4-lowercase` `h`-grammar. The **lease event schema and filter
  grammar are portable**; the gateway service and platform push credentials are not a
  Nostr-library concern. Implement the protocol surface, reject the gateway profile.
- **NIP-GS (git object signing)** is generalizable as a signature scheme but is a
  standalone signing-program binary + git config integration, and the reference reads
  `BUZZ_PRIVATE_KEY`/`BUZZ_AUTH_TAG` env vars. It belongs in a git-signing tool/package,
  not the core client surface.
- **NIP-CW/NIP-DV** at full value require a buzz-style relay query engine (thread
  indexing at ingest, keyset pagination, relay-identity signing). The client reader is
  cheap; the relay engine is a large, buzz-shaped build.

Two custom signing schemes live **outside** NIP-01 event signing and each need a
dedicated domain-separated Schnorr path: NIP-OA (`nostr:agent-auth:`) and NIP-GS
(`nostr:git:v1:`). Three encryption modes appear, all NIP-44 v2: encrypt-to-owner
(AE/AM/AO), encrypt-to-self (ER/RS), and encrypt-to-executor (PL).

**Discovery convention.** All the relay-facing custom NIPs advertise via NIP-11
`supported_extensions: ["nip-xx"]`, never `supported_nips`. If this repo adopts any,
its `Nip11Module` should surface them the same way to stay interoperable with buzz
clients and to avoid claiming a standard-registry number this repo does not hold.

---

## 7. Proposed module shape (Effect conventions)

Following this repo's existing patterns (`Context.Service`, branded types, Effect
`Schema`, tagged errors, thin `src/wrappers/*` façades):

- `src/services/OwnerAttestationService.ts` — NIP-OA sign/verify + conditions parser
  (branded `AuthTag`, `Conditions`; `Nip0aError`).
- `src/client/EngramService.ts` — NIP-AE; depends on `Nip44Service`, `RelayListService`;
  branded `Slug`, `EngramAddress`; `Nip0aeError`.
- `src/client/PersonaService.ts` — NIP-AP; plaintext NIP-33 read/write.
- `src/client/AgentMetricsService.ts` / `AgentObservabilityService.ts` — NIP-AM/AO.
- `src/client/ReminderService.ts` / `ReadStateService.ts` — NIP-ER/RS (encrypt-to-self).
- Relay modules under `src/relay/core/nip/modules/` for the Tier-B relay halves
  (`NipAaModule`, `NipAoModule`, `NipCwModule`, `NipDvModule`, `NipIaModule`, `NipWpModule`),
  registered like the existing `NipXXModule` set.
- `src/wrappers/nipXX.ts` thin re-export façades per the repo convention, plus a
  `nostr-effect/agent` (or similar) subpath export grouping the agent NIP family.

Each service is an `Effect` `Context.Service` with a `Layer`, a tagged error channel,
and a `*.test.ts` sibling with buzz spec vectors where the specs provide them (NIP-OA,
NIP-AE, and NIP-AB all ship test vectors).

---

## 8. Bottom line

- **Standard set: complete.** 15/15 standard NIPs plus Blossom already ship.
- **Custom set: 15 gaps, but no foundational crypto gaps.** NIP-44, NIP-59, Schnorr,
  NIP-42/43, and addressable events are already in place and vector-tested.
- **Start with NIP-OA → NIP-AA → NIP-AP → NIP-AE.** Small, portable, and they light up
  the agent-identity-plus-owner-decryptable-memory core.
- **Hold Tier C (PL, and the git-tooling/relay-engine halves of GS/CW/DV) as protocol
  surfaces only** — implement the wire format, do not import buzz's gateway or
  tenant-specific backend assumptions.

Related in this repo: [`docs/SUPPORTED_NIPS.md`](./SUPPORTED_NIPS.md) ·
[`docs/nip-gap-analysis/`](./nip-gap-analysis/) ·
[`docs/IDR_9092_NIP_PARITY_ROADMAP.md`](./IDR_9092_NIP_PARITY_ROADMAP.md)
