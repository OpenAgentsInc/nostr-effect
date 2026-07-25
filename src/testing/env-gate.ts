/**
 * Loud environment gates for suites that need real infrastructure.
 *
 * A suite that silently vanishes when its dependency is absent is worse than
 * no suite at all: the run reports green and the layer it was written to
 * protect is untested, so the green is a lie.
 *
 * This is not hypothetical. relay.openagents.com shipped a tag-encoding defect
 * that stored `tags` as a jsonb scalar string, broke every `#p` / `#e` / `#t`
 * filter with `StorageError`, and needed a migration over 3823 corrupted rows.
 * A test that fails against that defect was already in the tree. It never ran:
 * the whole Postgres suite was gated on `DATABASE_URL`, `DATABASE_URL` is
 * unset in CI, and nothing anywhere said so.
 *
 * The rule this module encodes:
 *
 *   - dependency present            -> the suite runs
 *   - dependency missing, in CI     -> the suite FAILS. CI must never be green
 *                                      while a production backend is untested.
 *   - dependency missing, local dev -> the suite skips, and
 *                                      `scripts/check-infra-gates.ts` prints a
 *                                      banner naming exactly what is uncovered.
 *
 * Local dev keeps its convenience. CI loses its ability to lie.
 *
 * ADDING A GATE: register it in `INFRA_GATES` below rather than reaching for
 * `describe.skip` and an ad hoc `process.env` check. Registered gates are
 * enforced in CI and reported locally; unregistered ones are how this happened
 * the first time.
 */
import { describe, test } from "vite-plus/test"

export type EnvGateOptions = {
  /** What the suite covers, in owner-legible terms. */
  readonly covers: string
  /** How a developer gets the dependency locally. */
  readonly howToRun: string
}

/**
 * Every environment-gated test suite in this repo.
 *
 * This is the single registry. `scripts/check-infra-gates.ts` reads it to
 * report or enforce gates before the suite runs, so a gate cannot be added in
 * a way that only shows up as a quiet skip.
 */
export const INFRA_GATES = {
  DATABASE_URL: {
    covers:
      "the PostgresStore EventStore — the relay's production storage backend: " +
      "append, duplicate rejection, NIP-16/NIP-33 replaceable semantics, " +
      "single-letter tag filters (#e/#p/#t/#d), and the startup repair for rows " +
      "whose tags were written as a jsonb scalar string",
    howToRun:
      "CI runs a postgres:17 service container (matching Cloud SQL " +
      "khala-sync-pg behind relay.openagents.com); locally, point DATABASE_URL " +
      "at any throwaway Postgres 17 database.",
  },
} as const satisfies Record<string, EnvGateOptions>

export type InfraGate = keyof typeof INFRA_GATES

/** A `describe`-shaped callable. Narrower than vite-plus's `describe`. */
export type SuiteRunner = (name: string, body: () => void) => void

/**
 * True on GitHub Actions and on every other runner that follows the
 * convention of exporting `CI`.
 */
export const isCi = (): boolean => {
  const ci = process.env["CI"]
  return ci !== undefined && ci !== "" && ci !== "0" && ci.toLowerCase() !== "false"
}

/**
 * Escape hatch for a deliberate, explicit local skip in an environment that
 * happens to set `CI` (a container shell, a pre-push hook on a laptop). It has
 * to be typed out on purpose, which is the point: an unset variable is an
 * accident, this is a decision.
 */
export const skipAcknowledged = (): boolean =>
  process.env["ALLOW_SKIPPED_INFRA_TESTS"] === "1"

/** Whether a registered gate's dependency is present. */
export const gateSatisfied = (variable: InfraGate): boolean => {
  const value = process.env[variable]
  return value !== undefined && value !== ""
}

/** The message shown when a gate is unmet. Shared by the test and the script. */
export const gateMessage = (variable: InfraGate, suiteName: string): string => {
  const options = INFRA_GATES[variable]
  return [
    ``,
    `${suiteName} did not run because ${variable} is unset.`,
    ``,
    `This suite covers: ${options.covers}`,
    ``,
    `A skipped infrastructure suite is being reported as a failure on purpose.`,
    `Silently skipping it is how a production data-corruption defect shipped`,
    `with a test in the tree that would have caught it.`,
    ``,
    `Fix the runner, not this test: provision the dependency and set`,
    `${variable}. ${options.howToRun}`,
    ``,
    `If a skip is genuinely intended here, it must be stated out loud by`,
    `setting ALLOW_SKIPPED_INFRA_TESTS=1.`,
    ``,
  ].join("\n")
}

/**
 * Gate a suite on a registered infrastructure dependency.
 *
 * Returns a `describe` when the dependency is present. When it is absent,
 * returns either a suite that fails loudly (CI) or a skipped suite (local dev,
 * where `scripts/check-infra-gates.ts` has already printed the banner).
 */
export const describeRequiringEnv = (variable: InfraGate): SuiteRunner => {
  if (gateSatisfied(variable)) {
    return (name, body) => {
      describe(name, body)
    }
  }

  if (isCi() && !skipAcknowledged()) {
    return (name, _body) => {
      describe(name, () => {
        test(`${variable} must be set in CI — this suite may not be skipped`, () => {
          throw new Error(gateMessage(variable, name))
        })
      })
    }
  }

  // Register the real body so the reporter names every skipped case rather
  // than collapsing the suite into a single anonymous skip.
  return (name, body) => {
    describe.skip(name, body)
  }
}
