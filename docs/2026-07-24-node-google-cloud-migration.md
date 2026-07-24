# Node and Google Cloud migration

- Class: migration plan
- Date: 2026-07-24
- Status: Stages 1–2 done, Stage 3 host (SARAH-NR-02) done, Stage 3 stores
  and Stages 4–5 planned
- Direction: owner, 2026-07-24
- Consumer plan: `openagents` `docs/omega/2026-07-24-sarah-workroom-mvp-spec.md`
  Part 2

## Direction

OpenAgents has removed all dependence on, and usage of, Cloudflare and Bun.

Everything this repository serves must run on Node with the Node and Vite Plus
stack that the `openagents` monorepo uses, and must deploy to Google Cloud.
Secrets live in Google Secret Manager.

This repository is the exception that has not migrated yet. This document is
the plan that closes that gap.

## Why now

The `openagents` Sarah runtime is moving to Nostr on a relay that OpenAgents
controls. That relay is this repository's relay core. It cannot ship on Bun or
on Cloudflare Workers, so the migration is now on the critical path.

The consumer plan is Part 2 of the Sarah workroom specification in the
`openagents` repository. Read it for the product context and the packet order.

## Stage 1: remove Cloudflare — DONE 2026-07-24

Deleted:

- `src/relay/backends/cloudflare/` — `DoSqliteStore.ts`, `NostrRelayDO.ts`,
  `worker.ts`, `mount.ts`, and `index.ts`
- `wrangler.toml`
- `docs/CLOUDFLARE.md`
- the four `./relay/backends/cloudflare*` package exports
- the `build:cloudflare`, `deploy:cloudflare`, and `dev:cloudflare` scripts
- the `@cloudflare/workers-types` and `wrangler` development dependencies

The backend was fully isolated. No source file imported it. Only the package
exports and three comments referenced it.

One real coupling appeared. `@cloudflare/workers-types` was silently supplying
the web platform globals for the whole repository, including `Blob`,
`Headers`, `MessageEvent`, and `RequestInfo`. Removing it broke the typecheck
in eight files.

The correct fix was to declare those globals from the platform library instead
of from a vendor package. `tsconfig.check.json` now uses
`"lib": ["ESNext", "DOM"]`. One call site in `src/wrappers/nip96.ts` needed a
real fix, because a `Uint8Array` over a `SharedArrayBuffer` is not a valid
`BlobPart` under the DOM library.

Verification: `npx tsc --noEmit -p tsconfig.check.json` is clean, and
`bun test` gives 1430 pass and 0 fail across 146 files.

## Stage 2: make the relay core platform-agnostic — DONE (SARAH-NR-01b)

The relay core is now portable. The Bun host remains a thin adapter.

1. `RelayServer`, `RelayConfig`, `RelayHandle`, `ConnectionData`, and
   `LivekitConfig` live in `src/relay/core/RelayServer.ts`.
2. `MemoryEventStoreLive` is a pure Map store in
   `src/relay/storage/MemoryEventStore.ts` (no `bun:sqlite`).
3. `src/relay/index.ts` imports no backend.
4. `Bun.serve` and `bun:sqlite` stay under `src/relay/backends/bun/`, exported
   as `nostr-effect/relay/bun`, until Stage 4 deletes them.

Exit met: `nostr-effect/relay` imports under Node with no `bun:` specifier in
its import graph.

## Stage 3: the Node backend

Add `src/relay/backends/node/`:

- `NodeServer.ts` on `node:http` plus `ws`, carrying the connection
  discipline the core already assumes: a connection limit, a NIP-42 challenge,
  a heartbeat with a miss limit, and a slow-client policy. **Host done
  (SARAH-NR-02 / #165).** Exported as `nostr-effect/relay/node`.
  `startTestRelay` uses `MemoryEventStoreLive` so a local Node relay runs
  without Bun or Cloudflare.
- `NodeSqliteStore.ts` on `node:sqlite` for development and non-production
  proofs. **Planned under SARAH-NR-01d / #166.**
- `PostgresStore.ts` implementing the seven-method `EventStore` interface
  against Cloud SQL Postgres, with append, replaceable, and parameterized
  replaceable storage plus the tag-filter grammar the clients use.
  **Planned under SARAH-NR-01d / #166.**

Export the Node backend from `package.json` (`./relay/node`).

Exit for the host half (#165): the relay runs on Node 24 with no Bun and no
Cloudflare import in the served path, and `startTestRelay` works under Node.

Exit for the store half (#166): the existing relay test suites pass against
the Node durable backends, a durable append survives a process restart, a
duplicate insert is idempotent, and a replaceable event replaces only an
older event.

## Stage 4: replace the Bun toolchain

This is the largest stage. The current state is 146 test files on `bun:test`
out of 373 source files, plus `bun` in every package script and `"types":
["bun"]` in the typecheck configuration.

Work:

1. Adopt pnpm and Node 24 to match the `openagents` monorepo. Delete
   `bun.lock`.
2. Adopt Vite Plus. Add a `vite.config.ts` in the shape the monorepo uses and
   move `test`, `typecheck`, `lint`, and `fmt` onto `vp`.
3. Convert the 146 test files from `bun:test` to the Vite Plus test runner.
   The import site is the only difference for most files, so convert
   mechanically and review the exceptions.
4. Replace `@types/bun` with `@types/node` and set `"types": ["node"]`.
5. Delete `src/relay/backends/bun/` and `src/relay/main.ts` Bun entry
   behavior. Replace the entry with a Node entry.
6. Replace the `bun build` scripts with the Vite Plus build.
7. Rewrite `AGENTS.md` and `CLAUDE.md`. Both currently instruct agents to
   prefer Bun over Node, `bun:sqlite` over other drivers, `Bun.serve` over a
   server library, and `bun test` over a test runner. Those instructions must
   invert.

Exit: no `bun` binary, no `bun:` import, no `Bun.` API call, and no
`@types/bun` reference in the tracked tree. `pnpm run verify` is green.

## Stage 5: deploy to Google Cloud

Deploy the relay to Cloud Run in project `openagentsgemini`, following the
same shape as the `openagents` monolith deploy. Attach Cloud SQL. Mount
secrets from Secret Manager. Serve `relay.openagents.com` with DNS-only
records that point at Google Cloud.

Run the load test before the relay carries coordination traffic. Report the
rate, the median and ninety-ninth percentile latency, the error classes, and
the failure mode under overload. Write the backup, restore, key rotation, and
multi-replica operator notes.

Exit: the relay is live, measured, monitored, and has a public-safe receipt.

## Known follow-up

The test suite connects to `wss://nos.lol`, a third-party public relay. A
relay we control must not depend on a third-party relay to prove itself.
Replace those cases with the in-process test relay before Stage 5.

## Rules that survive the migration

- No Cloudflare Workers, Durable Objects, D1, or R2 as a runtime, a store, a
  fallback, or a compatibility lane.
- No Bun as a runtime, a package manager, a test runner, or a build tool.
- No raw secret in an event, a tag, a log, or a receipt. Secrets come from
  Secret Manager at runtime.
- The relay stays a library plus a thin host. Product policy and admission
  belong to the consumer, never to the relay.
