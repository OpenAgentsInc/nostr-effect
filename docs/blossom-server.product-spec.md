---
spec_format_version: "0.1"
title: "Blossom Server Co-hosted with nostr-effect Relay"
artifact_type: "prd"
spec_revision: 1
author: "OpenAgents"
created_at: "2026-07-21T00:00:00Z"
updated_at: "2026-07-21T00:00:00Z"
linked_github_repo: "OpenAgentsInc/nostr-effect"
applies_to:
  - path: "src/relay/"
  - path: "src/client/BlossomService.ts"
  - path: "src/wrappers/nipb7.ts"
  - component: "BunServer"
  - component: "EventStore"
custom_sections:
  - id: "custom-owner-gates"
    label: "Owner Gates"
    after: "success_metrics"
  - id: "custom-receipts"
    label: "Receipts"
    after: "custom-owner-gates"
  - id: "custom-architecture"
    label: "Architecture"
    after: "custom-receipts"
  - id: "custom-implementation-plan"
    label: "Implementation Plan"
    after: "custom-architecture"
  - id: "custom-promise-links"
    label: "Promise Links"
    after: "custom-implementation-plan"
tool_metadata:
  openagents_lane: "BLS-01 through BLS-12"
  openagents_source: "session analysis of co-locating Blossom with Bun/Cloudflare relay; hzrd149/blossom BUDs 00–12"
  openagents_assurance_level: "library + optional server module; default-off until config enables Blossom"
  openagents_related_client: "existing Blossom client (BUD-01/02/03/11/12 partial) in BlossomService"
---

## Problem

nostr-effect ships a production-shaped Nostr **relay** (WebSocket NIP-01, SQLite
`EventStore`, Bun and Cloudflare backends) and a Blossom **client**
(`BlossomService` / `nipb7`) that talks to remote Blossom hosts. It does not
ship a Blossom **server**. Operators who want media co-located with their relay
must run a second process, second origin, and second operational stack—or depend
on third-party CDNs. That breaks the natural product shape: one host that
accepts events **and** content-addressed blobs under the same Nostr identity
model, with BUD-03 `kind:10063` discovery pointing at that host.

Existing client gaps (no mirror, media, preflight, payments, reports, or
`blossom:` URI) also leave NIP-B7 incomplete relative to the full BUD matrix.
Without a first-class server module designed against this relay’s storage and
HTTP surface, co-location stays an ad-hoc fork rather than a supported product
capability.

## Hypothesis

If nostr-effect adds an optional Blossom **server module** co-hosted on the
relay process—HTTP routes at the domain root, BUD-11 auth, blob metadata in
SQLite (or DO SQLite) **beside** the events table, and blob **bytes** on
filesystem (Bun) or R2 (Cloudflare)—then operators can enable Blossom with
config only, clients can use the existing `BlossomClient` against the same
origin as the relay, and OpenAgents products can treat “relay + media” as one
deployable unit without forking storage or auth models.

## Scope

```productspec-scope
in:
  - optional Blossom server module co-hosted with Bun and Cloudflare relay HTTP surfaces
  - BlobStore abstraction separate from EventStore (metadata index + object bytes)
  - SQLite (or DO SQLite) tables for blob metadata only; never store blob bodies in the events table
  - filesystem object backend for Bun; R2 (or compatible) object backend for Cloudflare
  - BUD-01 GET/HEAD /{sha256}[.ext] blob retrieval and existence checks
  - BUD-02 PUT /upload with Blob Descriptor responses
  - BUD-11 kind 24242 authorization (t/x/expiration; optional server scope)
  - BUD-12 GET /list/{pubkey} and DELETE /{sha256} including cursor/limit pagination
  - BUD-03 integration: clients already build kind 10063; document recommended server URLs for this host
  - BUD-04 PUT /mirror client-facing endpoint on the co-hosted server
  - BUD-06 HEAD /upload preflight
  - CORS and root-path rules per BUD-01
  - Effect-layered services consistent with EventStore / MessageHandler patterns
  - bun test coverage and bun run verify green before merge
  - config flag default-off (blossom only when explicitly enabled)
out:
  - replacing or rewriting EventStore / NIP-01 pipeline for media
  - storing multi-megabyte blobs as Nostr event content or in the events table
  - making Blossom a mandatory dependency of all relay deploys
  - full CDN, multi-region replication, or third-party SaaS Blossom as the primary product
  - paid storage marketplace UI (BUD-07 may return typed 402 headers later; no wallet product in this lane)
  - claiming server-side compliance for BUD-05 media optimization beyond a stub or deferred phase
cut:
  - BUD-05 trusted media optimization (PUT/HEAD /media) until core 01/02/11/12/04/06 pass
  - BUD-07 full payment rails (402 + X-{method} headers may land as typed hooks; settlement is cut)
  - BUD-08 nip94 field on descriptors (optional polish after core)
  - BUD-09 PUT /report endpoint (NIP-56 blob report helpers already exist client-side)
  - BUD-10 blossom: URI encode/decode (client helper; may follow as small PR)
  - production LiveKit-style commercial object CDN policies and abuse tooling
```

## User Experience

An operator starts the relay with Blossom enabled (e.g. `blossom: { enabled:
true, dataDir: "./data/blobs" }` on Bun, or R2 binding on Cloudflare). The same
origin serves `wss://` Nostr and HTTPS Blossom. A client using `BlossomClient`
points at that origin, signs kind `24242` auth, uploads, lists, and deletes.
Users publish `kind:10063` listing that origin (and optional mirrors). Other
clients that only know NIP-B7 recover media by hash across listed servers.
Failures return HTTP status codes and optional `X-Reason` human diagnostics;
clients do not parse `X-Reason` for control flow.

## Acceptance Criteria

```productspec-acceptance-criteria
- id: AC-1
  criterion: "BlobStore interface exists (put/get/head/delete/listByPubkey) with Effect errors; no dependency on EventStore for blob bytes."
- id: AC-2
  criterion: "Bun backend stores metadata in SQLite tables separate from events and stores bytes under a configured dataDir path keyed by sha256."
- id: AC-3
  criterion: "Cloudflare backend stores metadata in DO SQLite (or agreed meta store) and blob bytes in R2 (or documented object binding)."
- id: AC-4
  criterion: "BUD-11 auth validates kind 24242, signature, expiration, and t-tag verb; rejects expired/invalid tokens with 401."
- id: AC-5
  criterion: "BUD-01 GET and HEAD /{sha256} return the blob or 404; CORS headers satisfy BUD-01 for browser clients."
- id: AC-6
  criterion: "BUD-02 PUT /upload accepts body, verifies sha256 against auth x-tag when present, returns 200/201 Blob Descriptor with url/sha256/size/type/uploaded."
- id: AC-7
  criterion: "BUD-12 GET /list/{pubkey} supports cursor and limit; DELETE /{sha256} requires auth and removes meta+bytes when authorized."
- id: AC-8
  criterion: "BunServer (and CF DO fetch) mount Blossom routes when config enables Blossom; WS upgrade and NIP-11 on / remain correct."
- id: AC-9
  criterion: "BUD-04 PUT /mirror fetches remote URL, verifies hash, stores blob, returns Blob Descriptor."
- id: AC-10
  criterion: "BUD-06 HEAD /upload preflight uses X-SHA-256, X-Content-Type, X-Content-Length and returns status without requiring body upload."
- id: AC-11
  criterion: "Integration tests cover upload→head→get→list→delete and auth failure paths; bun run verify passes."
- id: AC-12
  criterion: "Docs in docs/ and SUPPORTED_NIPS (or BLOSSOM.md) describe config, BUD coverage matrix, and that Blossom is optional co-host not a rewrite of EventStore."
```

## Success Metrics

```productspec-success-metrics
- id: SM-1
  metric: blossom_core_bud_coverage
  target: "BUD-01,02,03,04,06,11,12 client+server paths documented and tested for core module"
  window: at merge of implementation epic
  segment: nostr-effect main
  source: docs_and_bun_test
- id: SM-2
  metric: cohost_config_enable_path
  target: "= 1 documented config path to enable Blossom on Bun relay without second process"
  window: at merge
  segment: operators
  source: docs
- id: SM-3
  metric: verify_green
  target: "= 100% bun run verify on main after merge"
  window: every PR merge
  segment: CI
  source: bun_run_verify
```

## Owner Gates

- Confirm object storage defaults for Bun (`dataDir`) and Cloudflare (R2 binding
  name) before production deploy docs claim support.
- BUD-05 media optimization and BUD-07 payments remain cut until owner admits a
  follow-on revision.
- Do not advertise “full Blossom server” publicly until AC-1 through AC-12 pass
  and the BUD coverage matrix is published.

## Receipts

- This ProductSpec at `docs/blossom-server.product-spec.md` @ `spec_revision: 1`.
- Architecture analysis from co-location review (events SQLite vs blob object
  store).
- Prior client work: `BlossomService`, BUD-03 helpers, NIP-B7 wrapper.
- Implementation PRs must cite this spec path and revision; issues track AC ids.

## Architecture

### Storage split (non-negotiable)

| Concern | Store |
| --- | --- |
| Nostr events | Existing `events` table / `EventStore` |
| Blob metadata | New `blobs` (or equivalent) table in same SQLite file **or** DO SQL |
| Blob bytes | Filesystem path (Bun) or R2 (Cloudflare) |

### Process shape

```text
Bun.serve / Worker fetch
  ├─ Upgrade → MessageHandler (NIP-01)
  ├─ GET / + Accept nostr+json → NIP-11
  ├─ NIP-86 / LiveKit well-known (existing)
  └─ Blossom routes (when enabled)
       ├─ GET|HEAD /:sha256
       ├─ PUT /upload
       ├─ HEAD /upload
       ├─ PUT /mirror
       ├─ GET /list/:pubkey
       └─ DELETE /:sha256
```

### Services

- `BlobStore` — put/get/head/delete/listByPubkey
- `BlossomAuth` — BUD-11 validate Authorization header
- `BlossomHttp` — map HTTP ↔ BlobStore + auth
- Optional: reuse `EventStore` only for serving or validating `kind:10063`
  discovery events, not for blob bodies

### Auth

Blossom uses kind **24242** (BUD-11), not NIP-98 kind **27235**. Implement a
dedicated validator; patterns can mirror `Nip98` (base64 event, verify sig,
check tags) without overloading NIP-98 semantics.

## Implementation Plan

Ordered work packets (each maps to GitHub issues; AC references in brackets):

1. **BLS-01** — `BlobStore` interface + Bun SQLite meta + filesystem backend [AC-1, AC-2]
2. **BLS-02** — BUD-11 auth module (kind 24242) [AC-4]
3. **BLS-03** — BUD-01 GET/HEAD handlers [AC-5]
4. **BLS-04** — BUD-02 PUT /upload + Blob Descriptor [AC-6]
5. **BLS-05** — BUD-12 list + delete + pagination [AC-7]
6. **BLS-06** — Wire BunServer routes + config + CORS [AC-8]
7. **BLS-07** — Integration tests upload→delete + auth failures [AC-11]
8. **BLS-08** — BUD-06 HEAD /upload preflight [AC-10]
9. **BLS-09** — BUD-04 PUT /mirror [AC-9]
10. **BLS-10** — Cloudflare R2 + DO meta backend [AC-3]
11. **BLS-11** — Docs + BUD coverage matrix + SUPPORTED/BLOSSOM notes [AC-12]
12. **BLS-12** (optional follow-on) — BUD-10 `blossom:` URI helpers; BUD-08 nip94 on descriptor

## Promise Links

- None yet. Public “full Blossom server” claims require a later promise-registry
  entry after SM-1–SM-3 evidence exists.
```
