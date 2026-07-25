/**
 * Preflight: confirm DATABASE_URL points at a reachable Postgres of the major
 * version the relay actually runs on.
 *
 * Runs before `pnpm run verify` (see `scripts/verify-with-postgres.sh`) so a
 * missing or mismatched database is reported as itself, rather than as a wall
 * of confusing test failures.
 */
import postgres from "postgres"

const EXPECTED_MAJOR = 17

const url = process.env.DATABASE_URL
if (!url) {
  console.error(
    "DATABASE_URL is unset. Run this through `pnpm run verify:postgres`, " +
      "which provisions Postgres; the PostgresStore suite is not allowed to " +
      "skip here."
  )
  process.exit(1)
}

const sql = postgres(url, { max: 1, onnotice: () => {} })

try {
  const [row] = await sql`SHOW server_version`
  const version = row.server_version
  const major = Number.parseInt(version, 10)
  console.log(`Postgres reachable: server_version=${version}`)

  if (major !== EXPECTED_MAJOR) {
    console.error(
      `Postgres major version ${major} does not match production (${EXPECTED_MAJOR}).\n` +
        `The relay runs on Cloud SQL openagentsgemini:us-central1:khala-sync-pg ` +
        `(POSTGRES_17). Testing against a different major leaves real behaviour ` +
        `unverified. Install the matching major (see EXPECTED_MAJOR in ` +
        `scripts/verify-with-postgres.sh), or update EXPECTED_MAJOR here and ` +
        `there if Cloud SQL genuinely moved.`
    )
    process.exit(1)
  }
} finally {
  await sql.end({ timeout: 5 })
}
