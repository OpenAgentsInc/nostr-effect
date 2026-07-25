#!/usr/bin/env bash
#
# Full verify against a real Postgres, on infrastructure we own.
#
# `pnpm run verify` alone can exit 0 while the relay's production storage
# backend goes completely untested: PostgresStore.test.ts needs DATABASE_URL,
# and with it unset the suite does not run. A tag-encoding defect shipped
# through that gap to relay.openagents.com and corrupted 3823 rows while a test
# that catches it sat in the tree, never once executed (#170).
#
# This script closes that gap without handing CI to a third-party runner:
#
#   1. stands up a throwaway Postgres of the production MAJOR version,
#   2. exports DATABASE_URL at it,
#   3. runs the preflight (reachable? right major?), `pnpm run verify`, and the
#      postflight (did the suite really touch the database?),
#   4. tears the database down again, pass or fail.
#
# It runs where we run it: a developer's machine, an agent's session, or an
# OpenAgents-owned runner or cron job. Per INVARIANTS.md ("No GitHub-Hosted CI")
# this must never be moved into a GitHub Actions workflow.
#
# Usage:
#   pnpm run verify:postgres
#
# Environment:
#   DATABASE_URL             If already set, it is used as-is and nothing is
#                            provisioned or torn down. Point this at a
#                            throwaway database, never at production.
#   NOSTR_EFFECT_PG_BINDIR   Directory holding a Postgres 17 initdb/pg_ctl,
#                            when it is somewhere this script does not look.
#   NOSTR_EFFECT_PG_MODE     `local` or `docker` to force a provisioning mode
#                            instead of preferring a local install.
#
# Exit codes:
#   0  verify passed with the Postgres suite covered
#   1  verify failed
#   2  no Postgres available to provision — nothing was run

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

EXPECTED_MAJOR=17

log() { printf '\n[verify:postgres] %s\n' "$*"; }
die() { printf '\n[verify:postgres] ERROR: %s\n' "$*" >&2; exit 1; }

# ---------------------------------------------------------------- provisioning

PG_DATA_ROOT=""
DOCKER_CONTAINER=""
PG_BINDIR=""

cleanup() {
  local status=$?
  if [ -n "$DOCKER_CONTAINER" ]; then
    log "removing throwaway Postgres container"
    docker rm -f "$DOCKER_CONTAINER" >/dev/null 2>&1 || true
  fi
  if [ -n "$PG_DATA_ROOT" ]; then
    log "stopping throwaway Postgres cluster"
    "$PG_BINDIR/pg_ctl" -D "$PG_DATA_ROOT/data" -m immediate stop >/dev/null 2>&1 || true
    rm -rf "$PG_DATA_ROOT"
  fi
  exit $status
}

free_port() {
  node -e "const net=require('node:net');const s=net.createServer();s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>console.log(p))})"
}

# Locate a Postgres server binary of the production major version.
resolve_bindir() {
  local candidates=(
    "${NOSTR_EFFECT_PG_BINDIR:-}"
    "/opt/homebrew/opt/postgresql@${EXPECTED_MAJOR}/bin"
    "/usr/local/opt/postgresql@${EXPECTED_MAJOR}/bin"
    "/usr/lib/postgresql/${EXPECTED_MAJOR}/bin"
    "/usr/pgsql-${EXPECTED_MAJOR}/bin"
  )
  local dir
  for dir in "${candidates[@]}"; do
    if [ -n "$dir" ] && [ -x "$dir/initdb" ] && [ -x "$dir/pg_ctl" ]; then
      echo "$dir"
      return 0
    fi
  done

  # Fall back to whatever is on PATH, but only if it is the right major.
  if command -v initdb >/dev/null 2>&1; then
    dir="$(dirname "$(command -v initdb)")"
    if [ -x "$dir/pg_ctl" ] && "$dir/initdb" --version | grep -qE "\) ${EXPECTED_MAJOR}\."; then
      echo "$dir"
      return 0
    fi
  fi

  return 1
}

docker_available() {
  command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1
}

start_local_cluster() {
  PG_BINDIR="$1"
  local port
  port="$(free_port)"
  PG_DATA_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/nostr-effect-pg.XXXXXX")"

  log "provisioning throwaway Postgres $("$PG_BINDIR/postgres" --version | awk '{print $3}') from $PG_BINDIR on port $port"
  "$PG_BINDIR/initdb" -D "$PG_DATA_ROOT/data" -U postgres -A trust --no-locale -E UTF8 >"$PG_DATA_ROOT/initdb.log" 2>&1 \
    || { cat "$PG_DATA_ROOT/initdb.log" >&2; die "initdb failed"; }

  # fsync off: this cluster exists for the length of this script and is deleted
  # afterwards, so durability buys nothing and costs test time.
  "$PG_BINDIR/pg_ctl" -D "$PG_DATA_ROOT/data" -l "$PG_DATA_ROOT/server.log" -w \
    -o "-p $port -h 127.0.0.1 -k $PG_DATA_ROOT -c fsync=off -c full_page_writes=off" start >/dev/null \
    || { cat "$PG_DATA_ROOT/server.log" >&2; die "could not start Postgres"; }

  "$PG_BINDIR/createdb" -h 127.0.0.1 -p "$port" -U postgres nostr_effect_verify
  export DATABASE_URL="postgres://postgres@127.0.0.1:$port/nostr_effect_verify"
}

start_docker_container() {
  local port
  port="$(free_port)"
  DOCKER_CONTAINER="nostr-effect-verify-$$"

  log "provisioning throwaway postgres:${EXPECTED_MAJOR} container on port $port"
  docker run --rm -d \
    --name "$DOCKER_CONTAINER" \
    -e POSTGRES_USER=postgres \
    -e POSTGRES_PASSWORD=nostr_effect_verify \
    -e POSTGRES_DB=nostr_effect_verify \
    -p "127.0.0.1:$port:5432" \
    "postgres:${EXPECTED_MAJOR}" \
    -c fsync=off >/dev/null

  local i
  for i in $(seq 1 60); do
    if docker exec "$DOCKER_CONTAINER" pg_isready -U postgres -d nostr_effect_verify >/dev/null 2>&1; then
      break
    fi
    sleep 1
    if [ "$i" -eq 60 ]; then die "Postgres container never became ready"; fi
  done

  export DATABASE_URL="postgres://postgres:nostr_effect_verify@127.0.0.1:$port/nostr_effect_verify"
}

trap cleanup EXIT INT TERM

if [ -n "${DATABASE_URL:-}" ]; then
  log "using the DATABASE_URL already in the environment; provisioning nothing"
else
  mode="${NOSTR_EFFECT_PG_MODE:-auto}"
  bindir=""
  if [ "$mode" != "docker" ]; then
    bindir="$(resolve_bindir || true)"
  fi

  if [ -n "$bindir" ]; then
    start_local_cluster "$bindir"
  elif [ "$mode" != "local" ] && docker_available; then
    start_docker_container
  else
    printf '%s\n' \
      "" \
      "no Postgres ${EXPECTED_MAJOR} available to provision." \
      "" \
      "The relay's production store is Cloud SQL POSTGRES_${EXPECTED_MAJOR}" \
      "(openagentsgemini:us-central1:khala-sync-pg), so the suite must run" \
      "against that major version. Get one of:" \
      "" \
      "  macOS:   brew install postgresql@${EXPECTED_MAJOR}" \
      "  Debian:  apt-get install postgresql-${EXPECTED_MAJOR}" \
      "  Docker:  start the daemon (the script will pull postgres:${EXPECTED_MAJOR})" \
      "" \
      "Or set NOSTR_EFFECT_PG_BINDIR to a directory containing a Postgres" \
      "${EXPECTED_MAJOR} initdb and pg_ctl, or DATABASE_URL to a throwaway" \
      "database." \
      "" >&2
    # Exit 2, distinct from a test failure (1), so callers such as the pre-push
    # hook can tell "no database here" from "the suite went red".
    exit 2
  fi
fi

# ----------------------------------------------------------------- the actual run

log "preflight: is the database reachable, and is it Postgres ${EXPECTED_MAJOR}?"
node scripts/postgres-preflight.mjs

log "verify: typecheck + infra gates + full test suite, Postgres included"
pnpm run verify

log "postflight: did the suite really exercise the database?"
node scripts/postgres-postflight.mjs

log "PASS — verify ran with the relay's production storage backend covered."
