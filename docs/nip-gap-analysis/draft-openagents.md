# OpenAgents draft NIPs (out-of-tree)

**Source:** `/Users/christopherdavid/work/openagents/docs/nips/`  
**Specs:** `AC.md`, `DS.md`, `LBR.md`, `SA.md`, `SKL.md`, `TRN.md` (+ `README.md`)  
**Upstream status:** Not part of `nostr-protocol/nips`. Living OpenAgents drafts.  
**Roadmap status (2026-07-08):** README marks the set **POSTPONED** behind Khala Code / business focus — direction retained, no new product work routed from them by default.

These six drafts restore protocol docs from the last shipped pre-Bun-rebuild tree (`f5919c766^:crates/nostr/nips/`). They define agent markets, credit, skills, labor, data, and training coordination on Nostr + Lightning/Cashu rails.

## Summary

| Spec | Title | Market stream | Grade in `nostr-effect` | Notes |
| --- | --- | --- | --- | --- |
| **NIP-LBR** | Agentic labor (NIP-90 profile) | Labor | **Partial** | Labor job kinds + builders live in `src/core/Nip90.ts` |
| **NIP-DS** | Datasets | Data | **Partial** | Listing/offer/access kinds present in `Nip90.ts`; not a full DS service |
| **NIP-SKL** | Skills registry | Skills | **Missing** | No `33400`/`33401` service |
| **NIP-SA** | Sovereign agents | Agents | **Missing** | No `392xx` agent/tick/trajectory helpers |
| **NIP-AC** | Agent credit | Credit | **Missing** | No `3924x` envelope/spend helpers |
| **NIP-TRN** | Training coordination | Training | **Missing** | No `395xx` training helpers |

Related in-repo OpenAgents protocol (not in this six-pack): **NIP-SB** Remote Sandbox (`docs/mechacoder/NIP-SB.md`, `SandboxService`) — claimed in `SUPPORTED_NIPS.md`.

---

## NIP-LBR — Labor market

**Spec:** `LBR.md` — agentic labor jobs over NIP-90; relay is transport; escrow/settlement stay platform-side.

### Kind allocation (spec)

| Request | Result | Job type |
| ---: | ---: | --- |
| 5930 | 6930 | `sandbox_run` |
| 5931 | 6931 | `repo_index` |
| 5932 | 6932 | `patch_gen` |
| 5933 | 6933 | `code_review` |
| **5934** | **6934** | **`agentic_coding` / `code_task` (v1 focus)** |
| 5935 | 6935 | `review` |
| 5936 | 6936 | `document_work` |
| 7000 | — | NIP-90 feedback (quotes, accept/reject) |

### Present in `nostr-effect`

`src/core/Nip90.ts`:

- `KIND_JOB_SANDBOX_RUN` … `KIND_JOB_LABOR_DOCUMENT_WORK` (5930–5936)
- `laborJobKindForType` / `laborJobTypeForKind`
- Labor request/result tag builders and parsers (`labor_job_type`, artifacts, etc.)
- Shared DVM feedback kind 7000

### Gaps

| Item | Sev | Detail |
| --- | --- | --- |
| Full LBR product flow | **P2** | Spec: budgeted request → quote (7000) → accept/escrow → result → accept/reject with **platform** settlement. Library has transport kinds; no escrow/settlement service (correctly out of pure protocol lib). |
| Document as NIP-LBR | **P3** | SUPPORTED_NIPS only lists generic NIP-90; no LBR row. |
| Result kind constants | **P2** | Confirm 6930–6936 result helpers parity with request side. |

**Grade: Partial** (strong NIP-90 labor transport substrate)

---

## NIP-DS — Datasets

**Spec:** `DS.md` — dataset identity, listings, offers, access contracts, DVM-style access request/result.

### Kind allocation (spec)

| Kind | Role |
| ---: | --- |
| 30404 | Dataset listing (addressable) |
| 30405 | Draft/inactive listing |
| 30406 | Dataset offer |
| 30407 | Dataset access contract |
| 5960 | Access request (DVM-style) |
| 6960 | Access result |
| 7000 | Feedback |
| + | Optional NIP-94 `1063`, NIP-15 stall/product, NIP-99 classified ads |

### Present in `nostr-effect`

`src/core/Nip90.ts`:

- `KIND_DATASET_LISTING = 30404`
- `KIND_DATASET_OFFER = 30406`
- `KIND_DATASET_ACCESS_REQUEST = 5960`
- `KIND_DATASET_ACCESS_RESULT = 6960`
- Dataset / offer address parsers (`30404:…`, `30406:…`)

### Gaps

| Item | Sev | Detail |
| --- | --- | --- |
| Kind 30405 draft listings | **P2** | Not seen as named constant. |
| Kind 30407 access contracts | **P1** | Spec core post-sale state object — missing. |
| Full listing/offer builders | **P1** | Constants/parsers ≠ full DS client service (tags: digests, access posture, prices, delivery). |
| SUPPORTED_NIPS row | **P3** | Not listed as NIP-DS. |

**Grade: Partial**

---

## NIP-SKL — Skills registry

**Spec:** `SKL.md` — publishable skill manifests + version log + trust via NIP-32.

### Kind allocation (spec)

| Kind | Role |
| ---: | --- |
| 33400 | Skill manifest (addressable) |
| 33401 | Version log (regular) |
| 33410 / 33411 | Optional PoP challenge/response (ephemeral) |
| 1985 | Trust/safety labels (NIP-32) |
| 5 | Publisher-origin revocation (NIP-09) |

### Present in `nostr-effect`

No dedicated SKL module. NIP-32 labeling and NIP-09 deletion exist generically (with known filter/`a`-tag gaps in the main audit).

### Gaps

| Item | Sev | Detail |
| --- | --- | --- |
| Entire SKL surface | **P1** if skills product | Manifest/version builders, discovery queries, revocation helpers. |
| Depends on open `#` filters | **P0** | Skill discovery by tags needs NIP-01 filter fix. |

**Grade: Missing**

---

## NIP-SA — Sovereign agents

**Spec:** `SA.md` — agent profile, encrypted state, schedule, tick execution, guardian approvals, trajectories, skill licenses.

### Kind allocation (spec)

| Kind | Role | Treatment |
| ---: | --- | --- |
| 39200 | Agent profile | Replaceable |
| 39201 | Agent state (encrypted) | Replaceable |
| 39202 | Schedule | Replaceable |
| 39203 | Goals | Replaceable |
| 39210 | Tick request | Ephemeral |
| 39211 | Tick result | Ephemeral |
| 39212 | Guardian approval request | Regular |
| 39213 | Guardian approval | Regular |
| 39220 | Skill license | Addressable |
| 39221 | Skill delivery | Ephemeral |
| 39230 | Trajectory session | Addressable |
| 39231 | Trajectory event | Regular |
| 39260 | Agent delegation | Regular |

Integrates NIP-AC envelopes, NIP-SKL manifests, NIP-90 jobs, Lightning/Cashu spend rails.

### Present in `nostr-effect`

**None** for SA kinds. Building blocks exist generically: NIP-44, NIP-59, NIP-40, NIP-57/60/61, NIP-90, ephemeral kind range (but ephemeral still stored — main audit P1).

### Gaps

| Item | Sev | Detail |
| --- | --- | --- |
| Full SA client | **P1** if agents product | Profile/state/tick/trajectory/guardian/license services. |
| Ephemeral ticks | **P1** | 39210/11/21 require true ephemeral treatment (NIP-16 gap). |
| Encrypted state | **P2** | Compose NIP-44 self-encrypt for 39201. |

**Grade: Missing**

---

## NIP-AC — Agent credit

**Spec:** `AC.md` — outcome-scoped credit envelopes (not free capital); reputation-backed; optional Cashu/Lightning rails.

### Kind allocation (spec)

| Kind | Role |
| ---: | --- |
| 39240 | Credit intent |
| 39241 | Credit offer |
| 39242 | Credit envelope (addressable OSCE) |
| 39243 | Spend authorization |
| 39244 | Settlement receipt |
| 39245 | Default notice |
| 39246 | Cancel spend (reversibility window) |

Cross-links NIP-SA guardian approvals (`39213`), NIP-32 skill safety labels, NIP-90 provider announcements.

### Present in `nostr-effect`

**None** for AC kinds. Payment primitives (57/60/61/47) are separate.

### Gaps

| Item | Sev | Detail |
| --- | --- | --- |
| Full AC flow | **P1** if credit product | Intent→offer→envelope→spend→settlement/default/cancel. |
| Provider `spend_rail` on 31990 | **P2** | NIP-89/90 handler announcements may need rail tags. |

**Grade: Missing**

---

## NIP-TRN — Training coordination

**Spec:** `TRN.md` — multi-party training network contracts, nodes, windows, receipts, validator verdicts, artifact locators (bytes stay off-Nostr).

### Kind allocation (spec)

| Kind | Role |
| ---: | --- |
| 39500 | Training network contract |
| 39501 | Training node record |
| 39510 | Training window |
| 39511 | Training receipt |
| 39512 | Validator verdict |
| 39520 | Artifact locator |
| 39530 | Contribution closeout |

### Present in `nostr-effect`

**None.**

### Gaps

| Item | Sev | Detail |
| --- | --- | --- |
| Entire TRN surface | **P2** | Only if training marketplace returns to roadmap. |
| Composes DS/SKL/AC | Info | Spec depends on sibling drafts. |

**Grade: Missing**

---

## Cross-draft dependency graph

```text
NIP-01 / 32 / 40 / 44 / 59 / 90  (upstream, mostly present)
        │
        ├─ NIP-SKL (manifests) ────────┐
        │                              │
        ├─ NIP-DS (datasets) ──────────┤
        │                              ▼
        ├─ NIP-AC (credit) ◄────── NIP-SA (agents / ticks / guardians)
        │                              │
        └─ NIP-LBR (labor over 90) ◄───┘
                       │
                       └─ NIP-TRN (training) uses DS + SKL + AC
```

Ephemeral correctness (NIP-16) and open tag filters (NIP-01) remain hard prerequisites for any serious SA/SKL implementation.

---

## Recommended stance for `nostr-effect`

1. **Do not** advertise these as supported NIPs until product re-opens the market streams (README is postponed).
2. **Do** document LBR/DS **partial** kind support under NIP-90 / an OpenAgents appendix in `SUPPORTED_NIPS.md` when ready (optional honesty pass).
3. When implementation resumes, order by leverage:
   1. NIP-01 filters + ephemeral (shared foundation)
   2. **SKL** manifests (identity of skills)
   3. **SA** profile/state/tick (agent runtime)
   4. **AC** envelopes (spend control)
   5. Complete **DS** + **LBR** product APIs on existing Nip90 substrate
   6. **TRN** last

---

## File references

| Spec path | Role |
| --- | --- |
| `~/work/openagents/docs/nips/README.md` | Index + postponed status |
| `~/work/openagents/docs/nips/LBR.md` | Labor |
| `~/work/openagents/docs/nips/DS.md` | Datasets |
| `~/work/openagents/docs/nips/SKL.md` | Skills |
| `~/work/openagents/docs/nips/SA.md` | Sovereign agents |
| `~/work/openagents/docs/nips/AC.md` | Agent credit |
| `~/work/openagents/docs/nips/TRN.md` | Training |
| `src/core/Nip90.ts` | Partial LBR + DS kinds |
| `src/client/SandboxService.ts` / `src/core/NipSB.ts` | NIP-SB (related, separate) |
