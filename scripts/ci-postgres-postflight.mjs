/**
 * CI postflight: prove the Postgres suite really talked to the database.
 *
 * `pnpm run verify` exiting 0 does not by itself mean the storage layer was
 * covered — that was exactly the failure mode this workflow exists to close.
 * The PostgresStore suite calls `openPostgresStore`, whose `initSchema`
 * creates the `events` table and its indexes. If the suite ran, that table is
 * here. If it was skipped, deleted, or repointed at another database, it is
 * not, and this exits non-zero.
 */
import postgres from "postgres"

const url = process.env.DATABASE_URL
if (!url) {
  console.error("DATABASE_URL is unset; cannot verify the Postgres suite ran.")
  process.exit(1)
}

const sql = postgres(url, { max: 1, onnotice: () => {} })

try {
  const [table] = await sql`
    SELECT to_regclass('public.events') IS NOT NULL AS present
  `
  if (!table.present) {
    console.error(
      "The `events` table does not exist in the CI database.\n" +
        "`pnpm run verify` passed without the PostgresStore suite ever opening " +
        "a store, so the relay's production storage backend went untested and " +
        "this run's green means nothing. Check that the suite still runs and " +
        "still uses DATABASE_URL."
    )
    process.exit(1)
  }

  // The GIN index on tags is what makes tag filters serviceable; its presence
  // confirms initSchema ran in full rather than the table arriving some other way.
  const [index] = await sql`
    SELECT COUNT(*)::int AS n
    FROM pg_indexes
    WHERE schemaname = 'public'
      AND tablename = 'events'
      AND indexname = 'idx_events_tags'
  `
  if (index.n !== 1) {
    console.error(
      "`events` exists but idx_events_tags does not; initSchema did not " +
        "complete. Treating this run as unverified."
    )
    process.exit(1)
  }

  console.log(
    "Postgres suite confirmed: `events` table and idx_events_tags present, " +
      "so PostgresStore ran against a real database."
  )
} finally {
  await sql.end({ timeout: 5 })
}
