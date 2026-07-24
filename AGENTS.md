---
description: Node 24 with pnpm and Vite Plus. Bun and Cloudflare are retired.
globs: "*.ts, *.tsx, *.html, *.css, *.js, *.jsx, package.json"
alwaysApply: false
---

**Note**: Issue tracking is GitHub Issues on `OpenAgentsInc/nostr-effect`.
Do not use beads/`bd` — that system is retired.

## Runtime: Node 24, pnpm, Vite Plus (owner direction, 2026-07-24)

OpenAgents has removed all dependence on, and usage of, Cloudflare and Bun.
This repository serves Node only, on the Node and Vite Plus stack the
`openagents` monorepo uses, deployed to Google Cloud.

Read
[`docs/2026-07-24-node-google-cloud-migration.md`](docs/2026-07-24-node-google-cloud-migration.md)
for the migration history. Stages 1–4 are done (Cloudflare removed, portable
relay core, Node host and stores, pnpm / Vite Plus toolchain). Stage 5 is
Google Cloud deploy.

Rules for all work:

- Target Node 24. Do not add a `bun:` import, a `Bun.*` API call, or a Bun
  dependency (`@types/bun`, `bun.lock`, or a package script that invokes `bun`).
- Do not add Cloudflare Workers, Durable Objects, D1, or R2 as a runtime, a
  store, a fallback, or a compatibility lane. They are retired.
- Use pnpm for dependency work. **Always use exact versions**
  (`pnpm add package@1.2.3`, no `^` or `~` ranges).
- Prefer the platform: `node:http` plus `ws` for the server, `node:sqlite` for
  local SQLite, Cloud SQL Postgres for production storage, `node:fs` for
  files.
- Production secrets come from Google Secret Manager at runtime. Never commit
  a secret and never place one in an event, a tag, or a log.

Verification gate for every change:

```bash
pnpm run verify   # typecheck + vp test --run
```

## Code Style

- **Never use inline/dynamic imports** - All imports must be at the top of the file. Do not use `import()` expressions or inline type imports like `options.value as import("./module").Type`. Import the type at the top of the file instead.

## Testing

The only test runner is Vite Plus (`vp test`), which re-exports Vitest.
Import test APIs from `vite-plus/test`. Do not add a second runner.

```ts
import { describe, test, expect } from "vite-plus/test"

test("hello world", () => {
  expect(1).toBe(1)
})
```

For spies and mocks use `vi` from the same import:

```ts
import { describe, test, expect, vi, beforeEach, afterEach } from "vite-plus/test"

const fetchSpy = vi.spyOn(globalThis, "fetch")
const callback = vi.fn()
```

Use `startTestRelay(port)` from `nostr-effect/relay/node` (or
`./relay/backends/node/index.js` inside this repo) for an in-memory Node host.

## Issue Tracking

Use **GitHub Issues** on `OpenAgentsInc/nostr-effect`. Beads/`bd` and the
`.beads/` directory are retired — do not recreate them.

```bash
gh issue list --repo OpenAgentsInc/nostr-effect
gh issue view <n> --repo OpenAgentsInc/nostr-effect
gh issue comment <n> --body "..."
gh issue close <n> --reason completed
```

Program work for the Sarah workroom is coordinated from
`OpenAgentsInc/omega#31`.

## Relay host

The supported host is Node 24:

```ts
import { startRelay } from "nostr-effect/relay/node"

const relay = await startRelay({ port: 8080 })
// Durable local store: compose NodeSqliteStoreLive from nostr-effect/relay/node/sqlite
// Production store: PostgresStoreLive from nostr-effect/relay/node/postgres
```

Standalone entry:

```sh
pnpm exec tsx src/relay/main.ts
# PORT=8080 optional
```

There is no Bun host and no `nostr-effect/relay/bun` export.

## Pull Request Policy

**NEVER open a PR until:**
1. `pnpm run typecheck` passes with no errors
2. `pnpm run test` passes with no failures

Or simply: `pnpm run verify`. Always verify both before pushing and creating PRs.

## Buildout Plan

**IMPORTANT**: Follow the buildout plan in `docs/BUILDOUT.md` for all development work.

### Workflow for Each Issue

1. **Check the buildout order** - Read `docs/BUILDOUT.md` to determine the next issue to work on. Follow the phase order (1 → 2 → 3 → 4) and the order within each phase.

2. **Pick the next issue** - Select the next uncompleted issue from the buildout plan. Check dependencies - some client issues depend on relay issues being completed first.

3. **Create a feature branch**:
   ```bash
   git checkout main
   git pull
   git checkout -b feat/<issue-description>-issue-<number>
   ```

4. **Implement the feature**:
   - Follow the existing code patterns (Effect services, branded types, etc.)
   - Write tests alongside the implementation
   - Ensure `pnpm run verify` passes (typecheck + tests)

5. **Open a PR**:
   ```bash
   git push -u origin <branch-name>
   gh pr create --title "<Issue title>" --body "Closes #<issue-number>"
   ```

6. **Merge and clean up**:
   ```bash
   gh pr merge <pr-number> --squash --delete-branch
   git checkout main
   git pull
   ```

7. **Update BUILDOUT.md** - Mark the completed issue and update the current state section. Commit this update to main.

### Current Focus

Check `docs/BUILDOUT.md` for:
- **Current State**: What's completed vs in-progress
- **Phase Order**: Foundation → Core NIPs → Encryption/Auth → Advanced
- **Dependencies**: Which client issues need relay issues completed first

### Keep BUILDOUT.md Updated

After completing each issue:
1. Mark the issue as done in the phase tables
2. Update the "Completed" section in Current State
3. Move any completed issues from "Open Issues" to "Completed"
4. Commit the BUILDOUT.md update to main

## NIP Module System

The relay uses a pluggable NIP module system for adding protocol support. Key files:

- `src/relay/core/nip/NipModule.ts` - Interface definition for NIP modules
- `src/relay/core/nip/NipRegistry.ts` - Service for managing/combining modules
- `src/relay/core/nip/modules/` - Built-in module implementations

### Creating a NIP Module

```typescript
import { createModule } from "../NipModule.js"

export const MyNipModule = createModule({
  id: "nip-XX",           // Unique identifier
  nips: [XX],             // NIP numbers implemented
  description: "...",     // Human-readable description
  kinds: [N, M, ...],     // Event kinds handled (empty = all kinds)
  policies: [],           // Validation policies (see Policy.ts)
  preStoreHook: (event) => Effect.succeed({ action: "store", event }),  // Optional
  postStoreHook: (event) => Effect.void,  // Optional
  limitations: {},        // NIP-11 relay limitations
})
```

### Key Concepts

- **policies**: Validation rules that Accept/Reject/Shadow events
- **preStoreHook**: Called before storage, can modify/reject/replace events
- **postStoreHook**: Called after storage for side effects
- **limitations**: Contributes to NIP-11 relay info document

### Reference PRs

- Issue #5 / PR #41 - Original NIP module system implementation
- See existing modules (Nip01Module, Nip16Module, Nip28Module, Nip42Module) for patterns

## Nostr NIPs Reference

**Local NIPs Repository:** The NIPs specification repo is cloned locally at `~/code/nips`. When implementing a NIP, read the spec from there instead of fetching from GitHub:

```bash
# Example: Read NIP-65 spec
cat ~/code/nips/65.md
```

Common NIPs for this project:
- `01.md` - Basic protocol flow (events, filters, subscriptions)
- `02.md` - Follow list (kind 3)
- `04.md` - Encrypted DMs (legacy)
- `05.md` - DNS identifiers
- `09.md` - Event deletion
- `11.md` - Relay information
- `16.md` - Event treatment (replaceable events)
- `19.md` - bech32 encoding
- `33.md` - Parameterized replaceable events
- `42.md` - Authentication
- `44.md` - Versioned encryption
- `46.md` - Nostr Connect (remote signing)
- `65.md` - Relay list metadata (kind 10002)

### Definitive NIP Support List

- Canonical list: `docs/SUPPORTED_NIPS.md`.
- Treat that file as the single source of truth for what we support. When you add or change a NIP implementation (service/wrapper/registry module), update `docs/SUPPORTED_NIPS.md` in the same PR.
- Do not add additional NIP support tables elsewhere (e.g., README). Link to `docs/SUPPORTED_NIPS.md` instead.
- Include links to:
  - Spec (local): `~/code/nips/<nip>.md`
  - Code entry points: service/wrapper/module paths
  - Tests
  - Keep the table sorted numerically by NIP (ascending). If you touch the file, fix ordering in the same PR.

### Relay NIPs: Registry Requirement

- Any NIP implemented by the relay (message handling, storage, policies, or NIP‑11 info) MUST be registered in the NIP module registry so it appears in `supported_nips` and is discoverable.
  - Location: `src/relay/core/nip/modules/**` for module definitions.
  - Registration: export from `src/relay/core/nip/modules/index.ts` and include in `DefaultModules` unless the NIP is intentionally opt‑in.
  - The registry (`src/relay/core/nip/NipRegistry.ts`) aggregates supported NIPs for NIP‑11 and provides hooks/policies to the pipeline.
- MessageHandler logic may still enforce certain NIPs (e.g., NIP‑70 protected events, NIP‑09 deletion), but each such NIP must also have a module stub to advertise support via NIP‑11 and keep configuration centralized.

### Wrapper vs Service

- Wrappers under `src/wrappers/**` exist to offer a light Promise‑style API and small builders.
- The authoritative implementation MUST live as Effect services/modules in `src/client/**`, `src/relay/core/**`, or `src/core/**`.
- When adding a new NIP:
  - Implement the logic in an Effect service (client) and/or relay module (server) first.
  - Optionally expose a thin wrapper for Promise users.
  - Ensure the Effect service is exported (package.json exports) and the relay module is registered in the NipRegistry (see above).

## NIP Implementation Playbook

When adding or updating a NIP, follow these patterns to move fast and keep consistency.

- Source of truth for support
  - Update `docs/SUPPORTED_NIPS.md` with spec path, code entry points, and tests.
  - README should only link to `docs/SUPPORTED_NIPS.md` (no extra lists).

- Client service pattern
  - File under `src/client/<Name>Service.ts`
  - Define `export interface <Name>Service` methods, `export const <Name>Service = Context.GenericTag<...>()`, and `export const <Name>ServiceLive = Layer.effect(..., make)`
  - Compose with `RelayService`, `EventService`, and `CryptoService` (only when needed).
  - Use Effect Schema decoders (`decodeKind`, `decodeFilter`, `decodeTag`) to build safe event/filter payloads.

- Kinds and tags
  - Add constants in `src/wrappers/kinds.ts` with clear comments and NIP numbers.
  - For parameterized‑replaceable events (NIP‑33), always include `d` tag; query with `#d` filters.
  - Follow tag semantics from the spec (e.g., for NIP‑87: `k`, `d`, `u`, `a`, `nuts`, `modules`, `n`).

- Tests (Vite Plus / `vp test`)
  - Use `startTestRelay(port)` from the Node host for an in‑memory relay; layer composition via `makeRelayService()`.
  - Prefer `Effect.race(Stream.runHead, Effect.sleep(...))` for bounded subscriptions.
  - Structure tests similar to existing service tests (create/publish, query/parse, negatives).

- Registry modules (relay)
  - Add new modules under `src/relay/core/nip/modules/**` using `createModule`.
  - If exposing by default, add to `DefaultModules` in `src/relay/core/nip/modules/index.ts`.
  - Ensure `nips: [ .. ]` is accurate; contribute relay info via `limitations` when applicable.

- PR checklist
  - `pnpm run verify` passes (typecheck + tests).
  - Update `docs/SUPPORTED_NIPS.md`.
  - Link PR to the appropriate issue(s).
  - Add export mapping in `package.json` (e.g., `"./nipXX": "./src/wrappers/nipXX.ts"`).
  - Update `docs/UNSUPPORTED_NIPS.md` to remove implemented NIPs.
  - If a relay NIP: add/adjust a registry module under `src/relay/core/nip/modules/**` and include it in `DefaultModules` as needed.

### Docs Hygiene

- One source of truth for NIPs: `docs/SUPPORTED_NIPS.md` (sorted ascending). Remove duplicate lists elsewhere.
- When adding a new NIP:
  - Add a row to `docs/SUPPORTED_NIPS.md` (spec path, code entry points, tests)
  - Do not maintain `UNSUPPORTED_NIPS.md`; if new specs appear in `~/code/nips`, open an issue and implement on a feature branch, then update `SUPPORTED_NIPS.md` in the same PR.
  - Ensure README links only to `docs/SUPPORTED_NIPS.md`

### Useful code patterns

- Build tags: collect as `string[][]`, then `tags.map(decodeTag)`.
- Quick filter: `decodeFilter({ kinds: [decodeKind(K)], "#d": [d], limit: 1 })`.
- Recommendation pointers: encode `'a'` as `${kind}:${pubkey}:${d}` and include optional relay hints.

## Compression

- Use `pako@2.1.0` for DEFLATE/INFLATE to keep bundles small and portable under Node.

## Development Commands

```bash
pnpm install         # Install dependencies (generates pnpm-lock.yaml)
pnpm run prepare     # Setup language service and git hooks
pnpm run setup:hooks # Install pre-push hook
pnpm test            # Run all tests (vp test --run)
pnpm run typecheck   # Type check only (tsc --noEmit)
pnpm run verify      # Typecheck + tests (used by pre-push)
pnpm run build       # Bundle entry with Vite Plus pack
pnpm run fmt         # Format with vp fmt
pnpm run lint        # Lint with vp lint
```
