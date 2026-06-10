# Migration Guide: Effect v3 → Effect v4

## 1. Executive Summary

Effect v4 is a major structural release of the TypeScript Effect ecosystem. The mental model is mostly the same: you still build programs with `Effect`, compose dependencies with `Layer`, model services with the context system, use `Schema` for runtime validation and codecs, and use fibers for concurrency.

The migration is not just a version bump. Treat it as a controlled refactor.

The biggest migration areas are:

1. Package and import restructuring
2. Unified package versioning
3. `Context.Tag` / `Effect.Tag` / `Effect.Service` → `Context.Service`
4. Removal of service accessor proxies
5. `Either` → `Result`
6. Transactional module renames: `TRef` → `TxRef`, `TQueue` → `TxQueue`, etc.
7. Error handling rename: `catchAll` → `catch`
8. Forking rename: `fork` → `forkChild`, `forkDaemon` → `forkDetach`
9. `FiberRef` removal in favor of `Context.Reference`
10. `Runtime<R>` removal
11. Flattened `Cause`
12. Effect subtyping replaced by `Yieldable`
13. Major `Schema` API rewrite

For production applications, migrate incrementally behind tests rather than converting the whole application blindly.

---

# 2. Recommended Migration Strategy

## Phase 0: Decide whether to migrate now

Do not migrate production-critical systems to v4 just because it exists. Migrate now if:

* You want smaller bundles and faster runtime behavior.
* You are building new Effect-heavy modules.
* You can tolerate beta churn.
* You want to align with future Effect ecosystem development.
* Your project has good tests.

Stay on v3 for now if:

* The code is stable and production-critical.
* You rely heavily on less-common ecosystem packages.
* You do not have enough test coverage.
* You cannot absorb beta API changes.

A good compromise is to migrate one package, service, worker, CLI, or API module first.

---

# 3. Upgrade Dependencies

## v3 style

```json
{
  "dependencies": {
    "effect": "^3.x",
    "@effect/platform": "^0.x",
    "@effect/platform-node": "^0.x",
    "@effect/sql": "^0.x",
    "@effect/sql-pg": "^0.x"
  }
}
```

## v4 style

In v4, Effect ecosystem packages share a single version. Keep all Effect packages on the same v4 version.

```json
{
  "dependencies": {
    "effect": "4.0.0-beta.x",
    "@effect/platform-node": "4.0.0-beta.x",
    "@effect/sql-pg": "4.0.0-beta.x"
  }
}
```

Install with:

```bash
pnpm add effect@beta
```

Then add matching implementation packages as needed:

```bash
pnpm add @effect/platform-node@beta
pnpm add @effect/sql-pg@beta
pnpm add @effect/vitest@beta
```

Run:

```bash
pnpm typecheck
pnpm test
pnpm lint
```

Expect compile failures. Those failures are the migration checklist.

---

# 4. Package and Import Migration

Effect v4 consolidates many previously separate packages into the core `effect` package.

## Common import changes

### Platform modules

```ts
// v3
import { FileSystem } from "@effect/platform/FileSystem"
import { Path } from "@effect/platform/Path"

// v4
import { FileSystem, Path } from "effect"
```

### HTTP modules

```ts
// v3
import { HttpClient } from "@effect/platform/HttpClient"
import { HttpClientRequest } from "@effect/platform/HttpClientRequest"

// v4
import { HttpClient, HttpClientRequest } from "effect/unstable/http"
```

### CLI modules

```ts
// v3
import { Command } from "@effect/cli/Command"
import { Options } from "@effect/cli/Options"

// v4
import { Command, Flag } from "effect/unstable/cli"
```

### SQL modules

```ts
// v3
import { SqlClient } from "@effect/sql/SqlClient"

// v4
import { SqlClient } from "effect/unstable/sql"
```

Use `effect/unstable/*` imports with care. Anything under `unstable` can still break in minor v4 releases.

---

# 5. Service Migration

## 5.1 Replace `Context.GenericTag`

### v3

```ts
import { Context } from "effect"

interface Database {
  readonly query: (sql: string) => Effect.Effect<ReadonlyArray<unknown>>
}

export const Database = Context.GenericTag<Database>("Database")
```

### v4

```ts
import { Context, Effect } from "effect"

interface Database {
  readonly query: (sql: string) => Effect.Effect<ReadonlyArray<unknown>>
}

export const Database = Context.Service<Database>("Database")
```

---

## 5.2 Replace class-based `Context.Tag`

### v3

```ts
import { Context, Effect } from "effect"

export class Database extends Context.Tag("Database")<
  Database,
  {
    readonly query: (sql: string) => Effect.Effect<ReadonlyArray<unknown>>
  }
>() {}
```

### v4

```ts
import { Context, Effect } from "effect"

export class Database extends Context.Service<
  Database,
  {
    readonly query: (sql: string) => Effect.Effect<ReadonlyArray<unknown>>
  }
>()("Database") {}
```

The argument order changed. In v3, the identifier came first:

```ts
Context.Tag("Database")<Self, Shape>()
```

In v4, type parameters come first:

```ts
Context.Service<Self, Shape>()("Database")
```

---

## 5.3 Replace `Effect.Tag` accessor proxies

In v3, `Effect.Tag` let you call service methods directly from the tag:

```ts
// v3
const program = Notifications.notify("hello")
```

In v4, accessor proxies are gone. Use `Service.use` or `yield* Service`.

### v4 with `use`

```ts
const program = Notifications.use((notifications) =>
  notifications.notify("hello")
)
```

### v4 with `Effect.gen`

```ts
const program = Effect.gen(function* () {[118;1:3u
  const notifications = yield* Notifications
  yield* notifications.notify("hello")
})
```

Prefer the generator style for larger workflows.

---

# 6. Providing Services

## v3

```ts
const program = Effect.gen(function* () {
  const db = yield* Database
  return yield* db.query("select 1")
}).pipe(
  Effect.provideService(Database, {
    query: (sql) => Effect.succeed([{ ok: true }])
  })
)
```

## v4

```ts
const program = Effect.gen(function* () {
  const db = yield* Database
  return yield* db.query("select 1")
}).pipe(
  Effect.provideService(Database, {
    query: (sql) => Effect.succeed([{ ok: true }])
  })
)
```

Simple `provideService` usage remains very similar. Most service breakage comes from service declaration syntax and accessor removal, not from ordinary provisioning.

---

# 7. Layer Migration

Layer composition still exists and should remain your default dependency assembly pattern.

## Recommended shape

```ts
const DatabaseLive = Layer.succeed(Database, {
  query: (sql) => Effect.succeed([{ sql }])
})

const AppLive = Layer.mergeAll(
  DatabaseLive,
  LoggerLive,
  ConfigLive
)

const main = program.pipe(
  Effect.provide(AppLive)
)
```

## Important behavior change: memoization

In v3, separate `Effect.provide(...)` calls could rebuild the same layer multiple times.

In v4, layer memoization is shared across `Effect.provide` calls by default. This prevents accidental double-construction of expensive services.

Still prefer this:

```ts
const main = program.pipe(
  Effect.provide(AppLive)
)
```

Avoid this unless intentional:

```ts
const main = program.pipe(
  Effect.provide(DatabaseLive),
  Effect.provide(LoggerLive),
  Effect.provide(ConfigLive)
)
```

If you need a fresh layer instance, use:

```ts
Effect.provide(Layer.fresh(DatabaseLive))
```

Or:

```ts
Effect.provide(DatabaseLive, { local: true })
```

---

# 8. Error Handling Migration

## Rename `Effect.catchAll` → `Effect.catch`

### v3

```ts
const program = Effect.fail("boom").pipe(
  Effect.catchAll((error) => Effect.succeed(`recovered: ${error}`))
)
```

### v4

```ts
const program = Effect.fail("boom").pipe(
  Effect.catch((error) => Effect.succeed(`recovered: ${error}`))
)
```

## Rename table

| v3                       | v4                        |
| ------------------------ | ------------------------- |
| `Effect.catchAll`        | `Effect.catch`            |
| `Effect.catchAllCause`   | `Effect.catchCause`       |
| `Effect.catchAllDefect`  | `Effect.catchDefect`      |
| `Effect.catchSome`       | `Effect.catchFilter`      |
| `Effect.catchSomeCause`  | `Effect.catchCauseFilter` |
| `Effect.catchTag`        | unchanged                 |
| `Effect.catchTags`       | unchanged                 |
| `Effect.catchIf`         | unchanged                 |
| `Effect.catchSomeDefect` | removed                   |

---

## Replace `catchSome`

### v3

```ts
import { Effect, Option } from "effect"

const program = Effect.fail(42).pipe(
  Effect.catchSome((error) =>
    error === 42
      ? Option.some(Effect.succeed("caught"))
      : Option.none()
  )
)
```

### v4

```ts
import { Effect, Filter } from "effect"

const program = Effect.fail(42).pipe(
  Effect.catchFilter(
    Filter.fromPredicate((error: number) => error === 42),
    () => Effect.succeed("caught")
  )
)
```

---

# 9. Forking and Fiber Migration

## Rename table

| v3                            | v4                  | Meaning                                             |
| ----------------------------- | ------------------- | --------------------------------------------------- |
| `Effect.fork`                 | `Effect.forkChild`  | Fork child fiber tied to parent lifecycle           |
| `Effect.forkDaemon`           | `Effect.forkDetach` | Fork detached from parent lifecycle                 |
| `Effect.forkScoped`           | unchanged           | Fork tied to current `Scope`                        |
| `Effect.forkIn`               | unchanged           | Fork in a specific `Scope`                          |
| `Effect.forkAll`              | removed             | Fork manually or use higher-level concurrency       |
| `Effect.forkWithErrorHandler` | removed             | Observe result through `Fiber.join` / `Fiber.await` |

### v3

```ts
const fiber = yield* Effect.fork(task)
```

### v4

```ts
const fiber = yield* Effect.forkChild(task)
```

### v3 daemon fiber

```ts
const fiber = yield* Effect.forkDaemon(backgroundTask)
```

### v4 detached fiber

```ts
const fiber = yield* Effect.forkDetach(backgroundTask)
```

## New fork options

```ts
const fiber = yield* Effect.forkChild(task, {
  startImmediately: true,
  uninterruptible: "inherit"
})
```

Use `forkChild` for ordinary structured concurrency. Use `forkDetach` only when the task should outlive the parent fiber.

---

# 10. `Fiber`, `Ref`, and `Deferred` Are No Longer Effects

Effect v4 replaces broad Effect subtyping with `Yieldable`.

This is one of the most important correctness changes.

## `Ref`

### v3

```ts
const program = Effect.gen(function* () {
  const ref = yield* Ref.make(0)
  const value = yield* ref
  return value
})
```

### v4

```ts
const program = Effect.gen(function* () {
  const ref = yield* Ref.make(0)
  const value = yield* Ref.get(ref)
  return value
})
```

## `Deferred`

### v3

```ts
const program = Effect.gen(function* () {
  const deferred = yield* Deferred.make<string>()
  const value = yield* deferred
  return value
})
```

### v4

```ts
const program = Effect.gen(function* () {
  const deferred = yield* Deferred.make<string>()
  const value = yield* Deferred.await(deferred)
  return value
})
```

## `Fiber`

### v3

```ts
const program = Effect.gen(function* () {
  const fiber = yield* Effect.fork(task)
  const result = yield* fiber
  return result
})
```

### v4

```ts
const program = Effect.gen(function* () {
  const fiber = yield* Effect.forkChild(task)
  const result = yield* Fiber.join(fiber)
  return result
})
```

Rule of thumb:

* To read a `Ref`, use `Ref.get`.
* To await a `Deferred`, use `Deferred.await`.
* To await a `Fiber`, use `Fiber.join`.
* To convert a yieldable value outside `Effect.gen`, use `.asEffect()` when available.

---

# 11. `Either` → `Result`

Effect v4 renames `Either` to `Result`.

## v3

```ts
import { Either } from "effect"

const result = Either.right(123)
```

## v4

```ts
import { Result } from "effect"

const result = Result.succeed(123)
```

Migration notes:

* Replace imports from `effect/Either` with `effect/Result`.
* Rename helper calls case-by-case.
* Audit all domain models named `Either`; consider renaming them to `Result` for consistency.
* If your code uses interop with fp-ts or external Either types, isolate conversions in one module.

---

# 12. Transactional Module Renames

Several STM-style transactional modules have been renamed with a `Tx` prefix.

| v3                 | v4                  |
| ------------------ | ------------------- |
| `TRef`             | `TxRef`             |
| `TQueue`           | `TxQueue`           |
| `TMap`             | `TxHashMap`         |
| `TSet`             | `TxHashSet`         |
| `TDeferred`        | `TxDeferred`        |
| `TPubSub`          | `TxPubSub`          |
| `TSemaphore`       | `TxSemaphore`       |
| `TPriorityQueue`   | `TxPriorityQueue`   |
| `TReentrantLock`   | `TxReentrantLock`   |
| `TSubscriptionRef` | `TxSubscriptionRef` |

Example:

```ts
// v3
import { TRef } from "effect"

// v4
import { TxRef } from "effect"
```

---

# 13. `FiberRef` → `Context.Reference`

In v4, `FiberRef`, `FiberRefs`, `FiberRefsPatch`, and `Differ` have been removed. Fiber-local state is now handled by `Context.Reference`.

## Reading built-in references

### v3

```ts
import { Effect, FiberRef } from "effect"

const program = Effect.gen(function* () {
  const level = yield* FiberRef.get(FiberRef.currentLogLevel)
  return level
})
```

### v4

```ts
import { Effect, References } from "effect"

const program = Effect.gen(function* () {
  const level = yield* References.CurrentLogLevel
  return level
})
```

## Scoped updates

### v3

```ts
const program = Effect.locally(
  myEffect,
  FiberRef.currentLogLevel,
  LogLevel.Debug
)
```

### v4

```ts
const program = Effect.provideService(
  myEffect,
  References.CurrentLogLevel,
  "Debug"
)
```

Use `Context.Reference` for custom request-local or fiber-local values that need defaults.

---

# 14. Runtime Migration

`Runtime<R>` no longer exists in the same form. In v4, use `Context<R>` directly and run functions on `Effect`.

## v3

```ts
import { Effect, Runtime } from "effect"

const main = Effect.gen(function* () {
  const runtime = yield* Effect.runtime<AppEnv>()
  return Runtime.runFork(runtime)(program)
})
```

## v4

```ts
import { Effect } from "effect"

const main = Effect.gen(function* () {
  const services = yield* Effect.context<AppEnv>()
  return Effect.runForkWith(services)(program)
})
```

If an effect has no service requirements, just use:

```ts
Effect.runFork(program)
```

For application entrypoints, continue using the platform runtime’s `runMain` equivalent where appropriate, because it gives signal handling, exit-code management, and error reporting.

---

# 15. Cause Migration

In v3, `Cause<E>` was a recursive tree with variants like:

```ts
Empty | Fail<E> | Die | Interrupt | Sequential<E> | Parallel<E>
```

In v4, `Cause<E>` is flattened into an array of reasons:

```ts
interface Cause<E> {
  readonly reasons: ReadonlyArray<Reason<E>>
}

type Reason<E> = Fail<E> | Die | Interrupt
```

## v3 recursive matching

```ts
const handle = (cause: Cause.Cause<string>) => {
  switch (cause._tag) {
    case "Fail":
      return cause.error
    case "Die":
      return cause.defect
    case "Interrupt":
      return cause.fiberId
    case "Sequential":
      return handle(cause.left)
    case "Parallel":
      return handle(cause.left)
    case "Empty":
      return undefined
  }
}
```

## v4 flat matching

```ts
const handle = (cause: Cause.Cause<string>) => {
  for (const reason of cause.reasons) {
    switch (reason._tag) {
      case "Fail":
        return reason.error
      case "Die":
        return reason.defect
      case "Interrupt":
        return reason.fiberId
    }
  }
}
```

## Predicate changes

| v3                             | v4                                |
| ------------------------------ | --------------------------------- |
| `Cause.isEmptyType(cause)`     | `cause.reasons.length === 0`      |
| `Cause.isFailType(cause)`      | `Cause.isFailReason(reason)`      |
| `Cause.isDieType(cause)`       | `Cause.isDieReason(reason)`       |
| `Cause.isInterruptType(cause)` | `Cause.isInterruptReason(reason)` |
| `Cause.isFailure(cause)`       | `Cause.hasFails(cause)`           |
| `Cause.isDie(cause)`           | `Cause.hasDies(cause)`            |
| `Cause.isInterrupted(cause)`   | `Cause.hasInterrupts(cause)`      |

---

# 16. Schema Migration

Schema has one of the largest v3 → v4 migrations. Treat Schema migration as its own sub-project.

## Common renames

| v3                      | v4                        |
| ----------------------- | ------------------------- |
| `asSchema(schema)`      | `revealCodec(schema)`     |
| `encodedSchema(schema)` | `toEncoded(schema)`       |
| `typeSchema(schema)`    | `toType(schema)`          |
| `compose(schemaB)`      | `decodeTo(schemaB)`       |
| `annotations(ann)`      | `annotate(ann)`           |
| `parseJson()`           | `UnknownFromJsonString`   |
| `parseJson(schema)`     | `fromJsonString(schema)`  |
| `pattern(regex)`        | `check(isPattern(regex))` |
| `nonEmptyString`        | `isNonEmpty`              |
| `BigIntFromSelf`        | `BigInt`                  |
| `SymbolFromSelf`        | `Symbol`                  |
| `URLFromSelf`           | `URL`                     |
| `RedactedFromSelf`      | `Redacted`                |
| `EitherFromSelf`        | `Result`                  |
| `TaggedError`           | `TaggedErrorClass`        |
| `decodeUnknown`         | `decodeUnknownEffect`     |
| `decode`                | `decodeEffect`            |
| `encodeUnknown`         | `encodeUnknownEffect`     |
| `encode`                | `encodeEffect`            |

## Variadic APIs now often take arrays

### v3

```ts
const Status = Schema.Literal("pending", "complete", "failed")
```

### v4

```ts
const Status = Schema.Literals(["pending", "complete", "failed"])
```

### v3

```ts
const Value = Schema.Union(Schema.String, Schema.Number)
```

### v4

```ts
const Value = Schema.Union([Schema.String, Schema.Number])
```

### v3

```ts
const Pair = Schema.Tuple(Schema.String, Schema.Number)
```

### v4

```ts
const Pair = Schema.Tuple([Schema.String, Schema.Number])
```

## Filters and refinements

### v3

```ts
const NonEmptyString = Schema.String.pipe(
  Schema.filter((s) => s.length > 0)
)
```

### v4

```ts
const NonEmptyString = Schema.String.check(Schema.isNonEmpty())
```

For custom predicates:

```ts
const Positive = Schema.Number.check(
  Schema.makeFilter((n) => n > 0)
)
```

For refinements, use `refine` when the predicate narrows the type.

## JSON parsing

### v3

```ts
const JsonUser = Schema.parseJson(User)
```

### v4

```ts
const JsonUser = Schema.fromJsonString(User)
```

---

# 17. Run Modes and Entrypoints

## Simple scripts

```ts
Effect.runPromise(program)
```

This remains acceptable for simple scripts and tests.

## Long-running Node apps

Use the platform runtime runner rather than raw `runPromise` when you want:

* graceful `SIGINT` / `SIGTERM` handling
* correct exit codes
* root fiber interruption
* unhandled error reporting

Example shape:

```ts
import { NodeRuntime } from "@effect/platform-node"

NodeRuntime.runMain(main)
```

The exact import may depend on the v4 beta package version. Keep platform packages version-aligned with `effect`.

---

# 18. Testing Migration

If using Effect’s Vitest integration, upgrade it with the rest of the Effect package set:

```bash
pnpm add -D @effect/vitest@beta
```

Migration testing checklist:

```bash
pnpm typecheck
pnpm test
pnpm lint
pnpm build
```

Add focused tests for:

* service construction
* layer memoization / resource lifecycles
* background fibers
* retry / timeout / interruption behavior
* Schema encode/decode behavior
* error recovery
* HTTP routes and clients
* SQL layer startup and teardown

Pay special attention to tests that previously relied on:

* `yield* ref`
* `yield* deferred`
* `yield* fiber`
* `Effect.fork`
* `Effect.catchAll`
* `FiberRef`
* `Runtime.runFork`
* Schema variadic APIs

---

# 19. Suggested Mechanical Migration Order

## Step 1: Upgrade packages

Update `effect` and related `@effect/*` packages to matching v4 beta versions.

## Step 2: Fix imports

Start with package/import changes:

* `@effect/platform/*` → `effect` or `effect/unstable/http`
* `@effect/cli/*` → `effect/unstable/cli`
* `@effect/sql/*` → `effect/unstable/sql`
* `effect/Either` → `effect/Result`
* `effect/TRef` → `effect/TxRef`, etc.

## Step 3: Fix services

Convert:

* `Context.Tag` → `Context.Service`
* `Context.GenericTag` → `Context.Service`
* `Effect.Tag` → `Context.Service`
* `Effect.Service` → `Context.Service`

Replace accessor proxy calls with `Service.use` or `yield* Service`.

## Step 4: Fix basic combinator renames

Replace:

```ts
Effect.catchAll
Effect.catchAllCause
Effect.catchAllDefect
Effect.catchSome
Effect.catchSomeCause
Effect.fork
Effect.forkDaemon
```

With:

```ts
Effect.catch
Effect.catchCause
Effect.catchDefect
Effect.catchFilter
Effect.catchCauseFilter
Effect.forkChild
Effect.forkDetach
```

## Step 5: Fix `Yieldable` breakages

Search for patterns like:

```ts
yield* ref
yield* deferred
yield* fiber
Effect.map(Option.some(...), ...)
Effect.all([ref, deferred, fiber])
```

Replace with explicit operations:

```ts
yield* Ref.get(ref)
yield* Deferred.await(deferred)
yield* Fiber.join(fiber)
Option.some(...).asEffect()
```

## Step 6: Fix `FiberRef`

Replace built-in `FiberRef` usage with `References`.

Replace custom `FiberRef` usage with `Context.Reference`.

## Step 7: Fix runtime usage

Replace `Effect.runtime<R>()` and `Runtime.runFork(runtime)` patterns with `Effect.context<R>()` and `Effect.runForkWith(context)`.

## Step 8: Fix `Cause`

Replace recursive cause pattern matching with iteration over `cause.reasons`.

## Step 9: Fix Schema

Do Schema migration after the core app compiles. It is large enough to handle separately.

## Step 10: Run tests, then audit behavior

Once the project compiles, run the full test suite. Then manually audit behavior around concurrency, resources, lifecycle, and Schema validation.

---

# 20. Codemod Search Patterns

Use these searches to find migration targets:

```bash
rg 'Context\.Tag|Context\.GenericTag|Effect\.Tag|Effect\.Service' src
rg 'catchAll|catchSome|catchAllCause|catchSomeCause|catchAllDefect' src
rg 'Effect\.fork\(|forkDaemon|forkAll|forkWithErrorHandler' src
rg 'FiberRef|FiberRefs|Differ' src
rg 'Effect\.runtime|Runtime\.run' src
rg 'effect/Either|Either\.' src
rg 'TRef|TQueue|TMap|TSet|TDeferred|TPubSub|TSemaphore' src
rg 'Schema\.Literal\(|Schema\.Union\(|Schema\.Tuple\(' src
rg 'parseJson|decodeUnknown|encodeUnknown|TaggedError' src
```

---

# 21. Migration PR Structure

For a real codebase, split the work into several PRs:

## PR 1: Dependency and import migration

* Upgrade packages.
* Replace imports.
* Do not change business logic unless required.

## PR 2: Services and layers

* Convert service tags.
* Remove accessor proxies.
* Confirm layer construction and teardown.

## PR 3: Effect combinators and concurrency

* Rename `catch*` APIs.
* Rename fork APIs.
* Fix `Fiber`, `Deferred`, and `Ref` yield behavior.

## PR 4: Runtime and references

* Replace `Runtime<R>` usage.
* Replace `FiberRef` with `Context.Reference` / `References`.

## PR 5: Schema migration

* Convert Schema APIs.
* Add encode/decode regression tests.

## PR 6: Cleanup and idioms

* Remove compatibility shims.
* Normalize import style.
* Replace awkward conversions with idiomatic `Effect.gen`.

---

# 22. Compatibility Shim Strategy

For large repositories, create temporary compatibility helpers to reduce churn.

Example:

```ts
// src/effect-v4-compat.ts
import { Effect } from "effect"

export const catchAll = Effect.catch
export const fork = Effect.forkChild
export const forkDaemon = Effect.forkDetach
```

Then migrate call sites gradually.

Do not keep compatibility shims forever. Add a TODO and remove them after the main migration lands.

---

# 23. Common Migration Mistakes

## Mistake: replacing `Effect.fork` with `Effect.forkDetach`

Most v3 `Effect.fork` call sites should become `Effect.forkChild`, not `Effect.forkDetach`.

Use `forkDetach` only for intentionally detached background work.

## Mistake: assuming `yield* ref` still reads a ref

Use `Ref.get(ref)`.

## Mistake: assuming `yield* fiber` still joins a fiber

Use `Fiber.join(fiber)`.

## Mistake: migrating Schema mechanically without tests

Schema behavior changes can alter validation, decoding, and JSON parsing. Add tests.

## Mistake: importing unstable modules casually

Anything under `effect/unstable/*` may change during v4 beta. Isolate those imports behind your own modules where possible.

## Mistake: keeping service accessor proxy style

v4 removes that style. Use `Service.use` or `yield* Service`.

---

# 24. Final Acceptance Checklist

A migration is complete when:

* `pnpm typecheck` passes.
* `pnpm test` passes.
* `pnpm build` passes.
* No v3 Effect packages remain.
* All Effect ecosystem packages use matching v4 versions.
* No `Context.Tag`, `Context.GenericTag`, `Effect.Tag`, or `Effect.Service` remains.
* No `Effect.catchAll` / `Effect.catchSome` remains.
* No accidental `Effect.fork` v3 usage remains.
* No `FiberRef` remains unless intentionally isolated behind a compatibility layer.
* Runtime usage has been updated.
* Schema encode/decode behavior has regression tests.
* Long-running app entrypoints still handle shutdown correctly.
* Resource layers are built the expected number of times.
* Background fibers behave correctly under cancellation and process shutdown.

---

# 25. Minimal Before/After Example

## v3

```ts
import { Context, Effect, Layer, Ref, Fiber } from "effect"

class Database extends Context.Tag("Database")<
  Database,
  {
    readonly query: (sql: string) => Effect.Effect<ReadonlyArray<unknown>>
  }
>() {}

const DatabaseLive = Layer.succeed(Database, {
  query: (sql) => Effect.succeed([{ sql }])
})

const task = Effect.succeed("done")

const program = Effect.gen(function* () {
  const db = yield* Database
  const ref = yield* Ref.make(0)

  const value = yield* ref
  const fiber = yield* Effect.fork(task)
  const result = yield* fiber

  const rows = yield* db.query("select 1")

  return { value, result, rows }
}).pipe(
  Effect.catchAll((error) => Effect.succeed({ error })),
  Effect.provide(DatabaseLive)
)
```

## v4

```ts
import { Context, Effect, Fiber, Layer, Ref } from "effect"

class Database extends Context.Service<
  Database,
  {
    readonly query: (sql: string) => Effect.Effect<ReadonlyArray<unknown>>
  }
>()("Database") {}

const DatabaseLive = Layer.succeed(Database, {
  query: (sql) => Effect.succeed([{ sql }])
})

const task = Effect.succeed("done")

const program = Effect.gen(function* () {
  const db = yield* Database
  const ref = yield* Ref.make(0)

  const value = yield* Ref.get(ref)
  const fiber = yield* Effect.forkChild(task)
  const result = yield* Fiber.join(fiber)

  const rows = yield* db.query("select 1")

  return { value, result, rows }
}).pipe(
  Effect.catch((error) => Effect.succeed({ error })),
  Effect.provide(DatabaseLive)
)
```

The v4 version is more explicit about dependency access, fiber joining, ref reading, and error recovery.


