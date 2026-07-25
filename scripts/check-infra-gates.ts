/**
 * Report or enforce every environment-gated test suite BEFORE the suite runs.
 *
 * `pnpm run verify` used to be able to exit 0 while the relay's production
 * storage backend went completely untested, because the Postgres suite skipped
 * itself on an unset `DATABASE_URL` and the reporter said nothing a reader
 * would notice. A defect shipped through that gap and corrupted 3823 rows.
 *
 * This runs at the top level, where output is actually visible (a `console`
 * call inside a skipped test file is swallowed by the reporter), and:
 *
 *   - in CI: exits non-zero for any unmet gate, before spending a minute on a
 *     suite whose result would be meaningless anyway;
 *   - locally: prints a banner naming exactly which production layer this run
 *     will not cover, then lets the run continue.
 *
 * Registry lives in `src/testing/env-gate.ts`.
 */
import {
  INFRA_GATES,
  gateMessage,
  gateSatisfied,
  isCi,
  skipAcknowledged,
  type InfraGate,
} from "../src/testing/env-gate.js"

const gates = Object.keys(INFRA_GATES) as Array<InfraGate>
const unmet = gates.filter((gate) => !gateSatisfied(gate))

if (unmet.length === 0) {
  console.log(
    `infra gates: all ${gates.length} satisfied (${gates.join(", ")}) — ` +
      `every environment-gated suite will run.`
  )
  process.exit(0)
}

if (isCi() && !skipAcknowledged()) {
  for (const gate of unmet) {
    process.stderr.write(gateMessage(gate, `The ${gate} suite`))
  }
  process.stderr.write(
    `\nCI refuses to run a suite set that silently omits ` +
      `${unmet.length} infrastructure gate(s): ${unmet.join(", ")}.\n` +
      `A green run that skipped a production backend is worse than a red one.\n\n`
  )
  process.exit(1)
}

const rule = "=".repeat(78)
process.stderr.write(
  [
    ``,
    rule,
    `  ${unmet.length} INFRASTRUCTURE GATE(S) UNMET — THIS RUN IS NOT A FULL VERIFY`,
    rule,
    ...unmet.flatMap((gate) => [
      ``,
      `  ${gate} is unset.`,
      `  NOT COVERED: ${INFRA_GATES[gate].covers}`,
      `  TO COVER IT: ${INFRA_GATES[gate].howToRun}`,
    ]),
    ``,
    `  A pass below does not mean the layer(s) above were verified.`,
    `  In CI this is a hard failure, not a warning.`,
    rule,
    ``,
    ``,
  ].join("\n")
)
