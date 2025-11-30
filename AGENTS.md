---
description: Use Bun instead of Node.js, npm, pnpm, or vite.
globs: "*.ts, *.tsx, *.html, *.css, *.js, *.jsx, package.json"
alwaysApply: false
---

Default to using Bun instead of Node.js.

- Use `bun <file>` instead of `node <file>` or `ts-node <file>`
- Use `bun test` instead of `jest` or `vitest`
- Use `bun build <file.html|file.ts|file.css>` instead of `webpack` or `esbuild`
- Use `bun install` instead of `npm install` or `yarn install` or `pnpm install`
- **Always use exact versions** when adding packages: `bun add package@1.2.3` (no `^` or `~` ranges)
- Use `bun run <script>` instead of `npm run <script>` or `yarn run <script>` or `pnpm run <script>`
- Bun automatically loads .env, so don't use dotenv.

## APIs

- `Bun.serve()` supports WebSockets, HTTPS, and routes. Don't use `express`.
- `bun:sqlite` for SQLite. Don't use `better-sqlite3`.
- `Bun.redis` for Redis. Don't use `ioredis`.
- `Bun.sql` for Postgres. Don't use `pg` or `postgres.js`.
- `WebSocket` is built-in. Don't use `ws`.
- Prefer `Bun.file` over `node:fs`'s readFile/writeFile
- Bun.$`ls` instead of execa.

## Code Style

- **Never use inline/dynamic imports** - All imports must be at the top of the file. Do not use `import()` expressions or inline type imports like `options.value as import("./module").Type`. Import the type at the top of the file instead.

## Testing

Use `bun test` to run tests.

```ts#index.test.ts
import { test, expect } from "bun:test";

test("hello world", () => {
  expect(1).toBe(1);
});
```

## Frontend

Use HTML imports with `Bun.serve()`. Don't use `vite`. HTML imports fully support React, CSS, Tailwind.

Server:

```ts#index.ts
import index from "./index.html"

Bun.serve({
  routes: {
    "/": index,
    "/api/users/:id": {
      GET: (req) => {
        return new Response(JSON.stringify({ id: req.params.id }));
      },
    },
  },
  // optional websocket support
  websocket: {
    open: (ws) => {
      ws.send("Hello, world!");
    },
    message: (ws, message) => {
      ws.send(message);
    },
    close: (ws) => {
      // handle close
    }
  },
  development: {
    hmr: true,
    console: true,
  }
})
```

HTML files can import .tsx, .jsx or .js files directly and Bun's bundler will transpile & bundle automatically. `<link>` tags can point to stylesheets and Bun's CSS bundler will bundle.

```html#index.html
<html>
  <body>
    <h1>Hello, world!</h1>
    <script type="module" src="./frontend.tsx"></script>
  </body>
</html>
```

With the following `frontend.tsx`:

```tsx#frontend.tsx
import React from "react";

// import .css files directly and it works
import './index.css';

import { createRoot } from "react-dom/client";

const root = createRoot(document.body);

export default function Frontend() {
  return <h1>Hello, world!</h1>;
}

root.render(<Frontend />);
```

Then, run index.ts

```sh
bun --hot ./index.ts
```

For more information, read the Bun API docs in `node_modules/bun-types/docs/**.md`.

## Pull Request Policy

**NEVER open a PR until:**
1. `bunx tsc --noEmit` passes with no errors
2. `bun test` passes with no failures

Always verify both before pushing and creating PRs.

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
   - Ensure `bun run verify` passes (typecheck + tests)

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
  - Use `@effect/schema` decoders (`decodeKind`, `decodeFilter`, `decodeTag`) to build safe event/filter payloads.

- Kinds and tags
  - Add constants in `src/wrappers/kinds.ts` with clear comments and NIP numbers.
  - For parameterized‑replaceable events (NIP‑33), always include `d` tag; query with `#d` filters.
  - Follow tag semantics from the spec (e.g., for NIP‑87: `k`, `d`, `u`, `a`, `nuts`, `modules`, `n`).

- Tests (bun test)
  - Use `startTestRelay(port)` for in‑memory relay; layer composition via `makeRelayService()`.
  - Prefer `Effect.race(Stream.runHead, Effect.sleep(...))` for bounded subscriptions.
  - Structure tests similar to existing service tests (create/publish, query/parse, negatives).

- Registry modules (relay)
  - Add new modules under `src/relay/core/nip/modules/**` using `createModule`.
  - If exposing by default, add to `DefaultModules` in `src/relay/core/nip/modules/index.ts`.
  - Ensure `nips: [ .. ]` is accurate; contribute relay info via `limitations` when applicable.

- PR checklist
  - `bun run verify` passes (typecheck + tests).
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

### NIP‑87 Tips

- Kinds: 38000 (recommendation), 38172 (Cashu info), 38173 (Fedimint info). Add constants in `src/wrappers/kinds.ts` and use schema decoders.
- Tags: `k` (recommended kind), `d` (identifier), `u` (URL or invite), `a` (pointer `${kind}:${pubkey}:${d}` with optional relay/label), `nuts`, `modules`, `n` (network).
- Queries: filter recommendations with `{ kinds: [38000], '#k': ['38172'|'38173'], authors?, limit? }`.
- Tests: cover authors filter, multiple `a` pointers, and negative cases (missing `d` or invalid `k`).

### NIP‑26 Tips

- Message: `nostr:delegation:${delegatePubkey}:${conditions}`; sign sha256(message) with delegator secret key.
- Tag: `["delegation", delegatorPubkey, conditions, signature]`.
- Delegate signs the actual event; include the delegation tag in `tags`.
- Helpers live in `src/wrappers/nip26.ts`; tests in `src/wrappers/nip26.test.ts`.

### NIP‑56 Tips


### NIP‑77 Client Tips

- Use `RelayService.negOpen(filter, initialHex?)` to open a session; it returns `{ id, messages, send, close }`.
- Encode/decode IdList payloads via `encodeIdListMessage` / `decodeIdListMessage` from `src/relay/core/negentropy/Codec.ts`.
- For IdList mode, the relay responds with server-only IDs (serverIds − clientIds). Iterate until the returned list is empty.
- Message schemas for `NEG-OPEN`, `NEG-MSG`, `NEG-ERR` are defined in `src/core/Schema.ts`.
- Keep all imports at the top of files (no dynamic imports).

- Kind 1984 with report type in third position of `p`/`e`/`x` tag: e.g., `["p", pubkey, "impersonation"]`.
- Blob reports: include `x` (hash), optional `e` (event containing blob), and optional `server` URL.
- Helpers live in `src/wrappers/nip56.ts`; tests in `src/wrappers/nip56.test.ts`.


### NIP‑B0 Tips

- Kind: 39701. Parameterized replaceable by `d` tag (URL without scheme).
- Testing replacement reliably: allow `createdAt` override in service so tests can publish v1/v2 with distinct seconds; tie‑breaking at same second is by id.
- Minimal relay module advertises support and kind; replacement behavior rides on NIP‑16/33 in the pipeline.

### NIP‑B7 Tips (Blossom)

- Client service: `src/client/BlossomService.ts` provides upload, download, list, delete. Wrapper: `src/wrappers/nipb7.ts` exposes a Promise API (`BlossomClient`).
- Auth: sign kind `24242` event and send as `Authorization: Nostr <base64(event)>` per BUD‑02; helper builds this in the service.
- Server discovery: BUD‑03 uses kind `10063` (User Server List). If adding discovery helpers, define a constant for 10063 and use `RelayService` + `EventService` to publish/query `["server", url]` tags.
- Relation to NIP‑96: `10096` (FileServerPreference) is deprecated for Blossom; prefer `10063`.
- Keep SUPPORTED_NIPS lettered section updated with spec/code/tests; no duplicate lists elsewhere.

### NIP‑BE Tips (BLE Transport)

- This spec is a client transport. Implement fragmentation + DEFLATE per spec; avoid platform BLE APIs in tests by mocking chunk streams.
- Framing: two‑byte big‑endian chunk index at head, one byte tail last‑flag (1 final, 0 otherwise).
- Enforce 64KiB max uncompressed message length before compression.
- Default chunk size ~200 bytes (fits BLE 4.2 safely); make configurable.
- Use `pako@2.1.0` for DEFLATE/INFLATE to keep bundles small and portable under Bun.
- Half‑duplex NEG sync (NIP‑77) can be layered on top of the chunking helpers; prefer to keep it in a small adapter rather than in the core service.

### NIP‑C0 Tips (Code Snippets)

- Kind 1337. Suggested tags: `l` (language, lowercase), `name` (filename), `extension` (lowercase), `description`, `runtime`, `license` (repeatable; SPDX id with optional URL/ref), `dep` (repeatable), `repo` (URL or NIP‑34 repo address).
- Relay filters only support `#e/#p/#a/#d/#t`. You can’t filter by `name` or `l` directly; prefer author + kind filtering and client‑side tag checks, or NIP‑50 `search` when available.
- Keep SUPPORTED_NIPS updated; this is a client‑only NIP (no registry module needed).
- Add a constant for the kind in `src/wrappers/kinds.ts` (CodeSnippet = 1337).



<!-- effect-solutions:start -->
## Effect Solutions Usage

The Effect Solutions CLI provides curated best practices and patterns for Effect TypeScript. Before working on Effect code, check if there's a relevant topic that covers your use case.

- `effect-solutions list` - List all available topics
- `effect-solutions show <slug...>` - Read one or more topics
- `effect-solutions search <term>` - Search topics by keyword

**Local Effect Source:** The Effect repository is cloned to `~/.local/share/effect-solutions/effect` for reference. Use this to explore APIs, find usage examples, and understand implementation details when the documentation isn't enough.
<!-- effect-solutions:end -->
