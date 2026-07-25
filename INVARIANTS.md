# Invariants

Invariant-bearing surfaces of `nostr-effect`. Read this before changing build,
test, automation, or storage-verification behavior.

Treat invariant changes as policy changes. When a change adds, removes,
relaxes, or materially reinterprets an invariant, update this file in the same
change and add the corresponding check or test.

The workspace-level guidance is `INVARIANTS.md` at
`/Users/christopherdavid/work`; the invariants below are this repo's own.

## No GitHub-Hosted CI / Cloud Actions

- Never add GitHub Actions workflows or any GitHub-hosted CI to this
  repository. `.github/workflows/` must contain no workflow files (no
  `on: push`, `on: schedule`, `on: pull_request`, or any other GitHub-runner
  automation).
- CI, scheduled jobs, freshness re-runs, and any recurring automation run on
  OpenAgents-owned infrastructure (our GCE / cloud runners and cron), not on
  GitHub-hosted compute.
- Rationale: keep build, test, scheduling, and automation on owned infra —
  consistent with the no-Expo/EAS-cloud mobile policy — and avoid handing repo
  automation, secrets, or scheduling to third-party GitHub-hosted runners.
- **Enforced** by `check:no-github-actions` (in `verify`): it fails if any
  `.github/workflows/*.yml` exists.
- Owner restatement, 2026-07-25: *"i thought we had an invariant abuot no
  github actions. all CI must be triggered in scripts or by us etc, no fucking
  github ci."*

### One documented exception, pending an owner decision

`.github/workflows/release.yml` predates this file. It fires on `v*` tag pushes
and is currently the **only** path that publishes this package to npm: it holds
the npm OIDC/provenance identity and cuts the GitHub Release. Removing it would
break publishing, so it is named in the allowlist inside
`scripts/check-no-github-actions.ts` rather than deleted unilaterally or
quietly tolerated.

Retiring it requires an owned-infrastructure release job that holds the npm
credential. Until the owner decides, nothing may be added to that allowlist and
nothing may be added to `release.yml` — no extra jobs, triggers, or service
containers.

## Infrastructure-gated suites must never skip silently

- A suite that quietly skips when its dependency is missing is worse than no
  suite: the run reports green and the layer it protects is untested.
- This is not hypothetical. `relay.openagents.com` shipped a tag-encoding
  defect that stored `tags` as a jsonb scalar string, broke every single-letter
  tag filter with `StorageError` (SQLSTATE 22023), took the whole
  NIP-17/44/59 `#p`-addressed lane offline, and needed a migration over 3823
  corrupted rows (#170). A test that fails against that defect was already in
  the tree. It had never once executed, because the whole Postgres suite was
  gated on an unset `DATABASE_URL` and nothing said so.
- Every environment-gated suite must be registered in `INFRA_GATES` in
  `src/testing/env-gate.ts` and gated with `describeRequiringEnv("VAR")`. Do
  not reach for `describe.skip` plus an ad hoc `process.env` check — that is
  the exact shape that failed.
- With a gate unmet: under `CI` the run **fails**; locally it skips after
  printing a banner naming the uncovered production layer.
  `ALLOW_SKIPPED_INFRA_TESTS=1` is the only way to skip under `CI`, and it has
  to be typed on purpose. An unset variable is an accident; that is a decision.
- **Enforced** by `infra-gates` (`scripts/check-infra-gates.ts`, in `verify`),
  which runs at the top level because a `console` call inside a skipped test
  file is swallowed by the reporter and therefore proves nothing.

## The Postgres suite must actually be run, by us

- Postgres is the relay's production store, so `pnpm run verify` alone is not a
  full verification: it does not provision a database.
- `pnpm run verify:postgres` (`scripts/verify-with-postgres.sh`) is the full
  gate. It stands up a throwaway Postgres of the production **major** version,
  exports `DATABASE_URL`, runs preflight → `verify` → postflight, and tears the
  database down. Run it before landing storage changes and before cutting a
  release; `pnpm run release` runs it for you.
- The major version is not a guess: the relay's Cloud Run service
  `openagents-nostr-relay` attaches Cloud SQL
  `openagentsgemini:us-central1:khala-sync-pg`, which is `POSTGRES_17`.
  `scripts/postgres-preflight.mjs` fails if the two drift apart, so a loss of
  fidelity is red rather than silent.
- `scripts/postgres-postflight.mjs` asserts `events` and `idx_events_tags`
  exist after the run, so `verify` exiting 0 can never again be mistaken for
  the storage layer being covered.
- This runs on machines we control. It must not be moved into a GitHub Actions
  workflow to satisfy the first invariant's convenience.
