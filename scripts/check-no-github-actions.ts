/**
 * Enforce the workspace invariant: no GitHub-hosted CI in this repository.
 *
 * CI, scheduled jobs, freshness re-runs, and any recurring automation run on
 * OpenAgents-owned infrastructure (our GCE / cloud runners and cron), not on
 * GitHub-hosted compute. See INVARIANTS.md.
 *
 * This exists because the rule was written down only in the `openagents` repo,
 * so an agent working here added `.github/workflows/ci.yml` in good faith and
 * violated it. A written rule with no check is a rule that gets broken by the
 * next person who does not happen to read it.
 *
 * Mirrors `check:no-github-actions` in the openagents monorepo, with one
 * documented exception (below) that does not exist there.
 */
import { existsSync, readdirSync } from "node:fs"
import { join } from "node:path"

const WORKFLOW_DIR = ".github/workflows"

/**
 * Workflows that predate the invariant being recorded here, kept only until
 * their owned-infrastructure replacement exists.
 *
 * `release.yml` fires on `v*` tag pushes and is currently the ONLY path that
 * publishes this package to npm — it holds the npm OIDC/provenance identity and
 * cuts the GitHub Release. Deleting it to satisfy this check would break
 * publishing, which is worse than the violation it would fix, so it is named
 * here in the open rather than removed unilaterally or quietly ignored.
 * Retiring it is an owner decision: it needs an owned-infra release job holding
 * the npm credential first.
 *
 * Nothing may be added to this list. New automation goes on our infrastructure.
 */
const PENDING_OWNER_DECISION = new Set(["release.yml"])

if (!existsSync(WORKFLOW_DIR)) {
  console.log("no-github-actions: no .github/workflows directory — clean.")
  process.exit(0)
}

const workflows = readdirSync(WORKFLOW_DIR).filter(
  (name) => name.endsWith(".yml") || name.endsWith(".yaml")
)

const violations = workflows.filter((name) => !PENDING_OWNER_DECISION.has(name))

if (violations.length > 0) {
  process.stderr.write(
    [
      ``,
      `INVARIANT VIOLATION — GitHub-hosted CI is not allowed in this repository.`,
      ``,
      ...violations.map((name) => `  ${join(WORKFLOW_DIR, name)}`),
      ``,
      `CI, scheduled jobs, and any recurring automation run on OpenAgents-owned`,
      `infrastructure (our GCE / cloud runners and cron), not on GitHub-hosted`,
      `runners. Do not hand repo automation, secrets, or scheduling to third-party`,
      `compute. See INVARIANTS.md.`,
      ``,
      `If you need the full suite run against a real Postgres, that is:`,
      ``,
      `  pnpm run verify:postgres`,
      ``,
      `which stands up a throwaway Postgres 17 and runs verify against it, on`,
      `whatever machine you invoke it from. Wire that into an owned runner or`,
      `cron job — not into a workflow file.`,
      ``,
    ].join("\n")
  )
  process.exit(1)
}

const pending = workflows.filter((name) => PENDING_OWNER_DECISION.has(name))
if (pending.length > 0) {
  console.log(
    `no-github-actions: no disallowed workflows. ` +
      `${pending.join(", ")} remain(s) pending an owner decision on an ` +
      `owned-infrastructure replacement (see scripts/check-no-github-actions.ts).`
  )
} else {
  console.log("no-github-actions: .github/workflows holds no workflow files — clean.")
}
