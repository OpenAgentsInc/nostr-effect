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

### Useful code patterns

- Build tags: collect as `string[][]`, then `tags.map(decodeTag)`.
- Quick filter: `decodeFilter({ kinds: [decodeKind(K)], "#d": [d], limit: 1 })`.
- Recommendation pointers: encode `'a'` as `${kind}:${pubkey}:${d}` and include optional relay hints.



<!-- effect-solutions:start -->
## Effect Solutions Usage

The Effect Solutions CLI provides curated best practices and patterns for Effect TypeScript. Before working on Effect code, check if there's a relevant topic that covers your use case.

- `effect-solutions list` - List all available topics
- `effect-solutions show <slug...>` - Read one or more topics
- `effect-solutions search <term>` - Search topics by keyword

**Local Effect Source:** The Effect repository is cloned to `~/.local/share/effect-solutions/effect` for reference. Use this to explore APIs, find usage examples, and understand implementation details when the documentation isn't enough.
<!-- effect-solutions:end -->
