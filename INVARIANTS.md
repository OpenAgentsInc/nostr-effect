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
  `.github/workflows/*.yml` exists. **There is no allowlist.** The mechanism
  was deleted, not merely emptied, so there is nowhere to name a new workflow.
- Owner restatement, 2026-07-25: *"i thought we had an invariant abuot no
  github actions. all CI must be triggered in scripts or by us etc, no fucking
  github ci."*

### The last exception is gone (2026-07-25)

`.github/workflows/release.yml` used to be allowlisted: it fired on `v*` tag
pushes and was the only path that published this package to npm. It is deleted,
and `.github/workflows/` no longer exists.

The owner directed the move: *"if that can run without me upgrading billing its
fine. otherwise move it to our infra like our updates thing is."* It cannot run.
The `OpenAgentsInc` account is locked for billing, so every workflow in the org
is killed within seconds — the last `Release` run that completed was v0.0.12 on
2025-11-30, and the only 2026 run died in 5s with *"The job was not started
because your account is locked due to a billing issue."*

Its replacement is `pnpm run release` (`scripts/publish-release.sh`), which runs
on a machine we control. See "Releasing runs on our infrastructure" below.

## Releasing runs on our infrastructure, and gives up provenance to do it

- `pnpm run release` (`scripts/publish-release.sh`) is the **only** publish path:
  preflight → `verify:postgres` → `pnpm pack` → `npm publish` → `git tag` →
  `gh release create`. `pnpm run release:dry-run` runs every gate and publishes
  nothing.
- Verification runs **before** publish, never after, and the Postgres gate has
  no skip flag. `verify:postgres` exiting 2 (no database on this machine) is a
  hard failure for a release, unlike the pre-push hook which may fall back.
- The tag is created **after** a successful publish. A tag naming a release that
  failed to publish is a lie that outlives the failure.
- Authentication is a **granular npm automation token** from workspace
  `.secrets/npm-publish.env`, loaded into a mode-0600 temporary npm userconfig
  that is deleted on exit. It is never echoed, never passed in argv, never
  committed, never written to a release note.
- **Published packages carry no SLSA provenance attestation, and this is
  permanent, not a gap to close later.** npm trusted publishing (OIDC) issues
  credentials only to a hard-coded provider allowlist — GitHub Actions and
  GitLab CI for provenance, plus CircleCI for auth only — and *"Self-hosted
  runners are not currently supported"*
  (`docs.npmjs.com/trusted-publishers`, `docs.npmjs.com/generating-provenance-statements`).
  There is no custom-issuer option; the request for one (`npm/cli#9104`) was
  closed 2026-04-21 without commitment. The gate is enforced twice: the CLI
  throws `EUSAGE` — *"Automatic provenance generation not supported for
  provider: …"* — outside those two, and the registry independently rejects
  foreign attestation bundles by checking the signing certificate's issuer,
  `Runner Environment`, and `Source Repository URI` extensions, which a
  Google-issued identity does not carry. `--provenance-file` therefore does not
  smuggle one in; it exists to split build from publish *within* a supported CI.
- What this costs a consumer, precisely. **Kept:** `dist.integrity` (the sha512
  enforced on install and pinned in lockfiles) and `dist.signatures` (the npm
  registry's ECDSA signature over name/version/integrity). `npm audit
  signatures` still verifies both and still **exits 0** — a missing attestation
  lowers a count, it does not error. **Lost:** the cryptographic link from
  tarball back to source commit, repository, and build run; the Provenance panel
  and green check on npmjs.com; npm's publish attestation; and the Rekor
  transparency-log entry. Registry signatures answer *"did npm serve the bytes
  npm intended?"*; provenance answers *"were these bytes built from that source,
  in public?"* A stolen publish token still produces a validly-signed package.
  That is the exposure we accept in exchange for not running our releases on
  third-party compute.
- Observable in the wild: `nostr-effect@0.0.12` (workflow-published) has
  `dist.attestations` with a `https://slsa.dev/provenance/v1` predicate;
  `@0.0.13` (published by hand) has none. The transition already happened.
- The only way to restore provenance is to publish from GitHub Actions or
  GitLab CI, which requires paying GitHub and re-violating the invariant above.
  That is an owner decision, not an agent's. Do not reintroduce a workflow to
  chase the green check.

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
  release; `pnpm run release` runs it for you, and the pre-push hook prefers it
  over plain `verify` whenever this machine can provide a Postgres 17 (exit
  code 2 means it could not, and the hook falls back with a warning rather than
  blocking the push).
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
