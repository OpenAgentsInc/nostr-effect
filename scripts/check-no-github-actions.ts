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
 * Mirrors `check:no-github-actions` in the openagents monorepo.
 *
 * THERE IS NO ALLOWLIST, AND ONE MUST NOT BE REINTRODUCED.
 *
 * There used to be. It held exactly one entry: `release.yml`, the tag-triggered
 * workflow that was the only path publishing this package to npm. It was
 * removed on 2026-07-25 on owner direction — *"if that can run without me
 * upgrading billing its fine. otherwise move it to our infra like our updates
 * thing is"* — after it was confirmed that it cannot run. The `OpenAgentsInc`
 * account is locked for billing, so every workflow in the org is killed within
 * seconds, and the last Release run that completed was v0.0.12 on 2025-11-30.
 *
 * Its replacement is `scripts/publish-release.sh`: verify against a real
 * Postgres, pack, publish with a granular npm token, cut the GitHub Release
 * with `gh`. It runs on a machine we control and is triggered by us — the same
 * move as `apps/oa-updates` in the openagents repo, which replaced Expo's
 * hosted update service with our own.
 *
 * If you are reading this because the check is failing and you want somewhere
 * to name your workflow so it passes: that place deliberately no longer exists.
 * The answer is a script in `scripts/` that we invoke.
 */
import { existsSync, readdirSync } from "node:fs"
import { join } from "node:path"

const WORKFLOW_DIR = ".github/workflows"

if (!existsSync(WORKFLOW_DIR)) {
  console.log("no-github-actions: no .github/workflows directory — clean.")
  process.exit(0)
}

const violations = readdirSync(WORKFLOW_DIR).filter(
  (name) => name.endsWith(".yml") || name.endsWith(".yaml")
)

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
      `There is no allowlist to add this to — see the comment at the top of this`,
      `file. The two owned paths that replaced the workflows this repo used to`,
      `have are:`,
      ``,
      `  pnpm run verify:postgres   full suite against a throwaway Postgres 17,`,
      `                             on whatever machine you invoke it from`,
      `  pnpm run release           verify -> pack -> npm publish -> GitHub Release`,
      ``,
      `Wire recurring runs into an owned runner or cron job — not a workflow file.`,
      ``,
    ].join("\n")
  )
  process.exit(1)
}

console.log("no-github-actions: .github/workflows holds no workflow files — clean.")
