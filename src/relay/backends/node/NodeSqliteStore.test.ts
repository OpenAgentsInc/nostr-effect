/**
 * NodeSqliteStore tests.
 *
 * Bun cannot load `node:sqlite`, so this file spawns Node to run the proof
 * harness. That keeps `bun test` as the gate while verifying the Node store.
 */
import { describe, expect, test } from "bun:test"
import { spawnSync } from "node:child_process"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const here = dirname(fileURLToPath(import.meta.url))
const proofPath = join(here, "NodeSqliteStore.proof.ts")
const repoRoot = join(here, "../../../..")

describe("NodeSqliteStore", () => {
  test("durable append, duplicate, replaceable, parameterized d-key (under Node)", () => {
    const result = spawnSync(
      "node",
      ["--no-warnings", "--import", "tsx", proofPath],
      {
        cwd: repoRoot,
        encoding: "utf8",
        env: { ...process.env },
      }
    )

    if (result.status !== 0) {
      console.error(result.stdout)
      console.error(result.stderr)
    }

    expect(result.status).toBe(0)
    expect(result.stdout).toContain("OK NodeSqliteStore proof")
  })
})
