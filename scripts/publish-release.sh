#!/usr/bin/env bash
#
# Cut a nostr-effect release from infrastructure we own.
#
# This replaces `.github/workflows/release.yml`, which fired on `v*` tag pushes
# and was the only path that published this package. It cannot run: the
# `OpenAgentsInc` GitHub account is locked for billing, so every workflow in the
# org dies in seconds with "The job was not started because your account is
# locked due to a billing issue." The last Release run that actually completed
# was v0.0.12 on 2025-11-30. Per INVARIANTS.md ("No GitHub-Hosted CI") the
# replacement runs here, on a machine we control, triggered by us — the same
# pattern as `apps/oa-updates/scripts/publish-ota.sh` in the openagents repo,
# which replaced Expo's hosted update service with our own.
#
# What this costs, stated plainly:
#
#   npm trusted publishing (OIDC) issues short-lived credentials only to a
#   fixed set of CI providers, and an arbitrary machine of ours is not one of
#   them. Publishing from here therefore uses a granular npm automation token,
#   and the published tarball carries NO SLSA provenance attestation. Compare
#   nostr-effect@0.0.12 (workflow-published, has `dist.attestations`) with
#   @0.0.13 (published by hand, has none). What a consumer keeps is the npm
#   registry signature over the tarball and its integrity hash, both of which
#   `npm audit signatures` still verifies. What a consumer loses is the
#   cryptographic link from the tarball back to a specific commit and build
#   job. See AGENTS.md ("Releasing") for the full accounting.
#
# Ordering is load-bearing: verification runs BEFORE publish, never after. The
# Postgres gate is the one that matters — `pnpm run verify` alone exits 0
# without ever touching the relay's production storage backend, and a
# tag-encoding defect shipped through exactly that gap and corrupted 3823 rows
# (#170). There is no flag to skip it.
#
# Usage:
#   bash scripts/publish-release.sh --dry-run   # prove the path, publish nothing
#   bash scripts/publish-release.sh             # cut the release for real
#
# Preconditions (all enforced, none assumed):
#   - working tree clean, HEAD identical to origin/main
#   - package.json version not already on the registry
#   - workspace .secrets/npm-publish.env holds NPM_PUBLISH_TOKEN
#   - `gh` authenticated
#   - a Postgres 17 this machine can provision
#
# The token is read from the environment file and written only into a
# mode-0600 temporary npm userconfig that is deleted on exit. It is never
# echoed, never passed as an argument (argv is world-readable via `ps`), never
# committed, and never written to a release note.

set -euo pipefail
# Defensive: a caller exporting SHELLOPTS with xtrace would otherwise trace the
# token into the terminal.
set +x

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

PKG_NAME="$(node -p "require('./package.json').name")"
VERSION="$(node -p "require('./package.json').version")"
TAG="v$VERSION"
REGISTRY="https://registry.npmjs.org"
SECRET_FILE="${NOSTR_EFFECT_NPM_ENV:-$HOME/work/.secrets/npm-publish.env}"

DRY_RUN=0
case "${1:-}" in
  --dry-run) DRY_RUN=1 ;;
  "") ;;
  *) printf 'usage: %s [--dry-run]\n' "$0" >&2; exit 64 ;;
esac

log()  { printf '\n[release] %s\n' "$*"; }
step() { printf '\n[release] ==> %s\n' "$*"; }
die()  { printf '\n[release] ERROR: %s\n\n' "$*" >&2; exit 1; }

TARBALL=""
NPM_USERCONFIG=""
cleanup() {
  local status=$?
  # The userconfig holds the auth token. Remove it whatever happened.
  [ -n "$NPM_USERCONFIG" ] && rm -f "$NPM_USERCONFIG"
  [ -n "$TARBALL" ] && [ -f "$TARBALL" ] && rm -f "$TARBALL"
  exit $status
}
trap cleanup EXIT INT TERM

if [ "$DRY_RUN" -eq 1 ]; then
  log "DRY RUN — every gate runs; nothing is published, tagged, or released."
fi
log "package $PKG_NAME@$VERSION (tag $TAG)"

# ---------------------------------------------------------------- 1. preflight
#
# Everything that can be known before doing work is checked before doing work,
# so a release fails in seconds on a missing credential rather than 4 minutes
# into a test suite.

step "preflight: repository state"

git rev-parse --git-dir >/dev/null 2>&1 || die "not a git repository"

# A dirty tree means the tarball would not correspond to any commit, and the
# tag would point at something that was never built. Parallel agent sessions
# leave WIP in shared checkouts; publish from a clean worktree instead.
if [ -n "$(git status --porcelain)" ]; then
  git status --short >&2
  die "working tree is dirty — refusing to publish.
   The tarball must correspond exactly to the commit the tag names.
   Commit or stash your own work, or cut the release from a clean worktree:
     git worktree add --detach /tmp/nostr-effect-release origin/main"
fi

git fetch --quiet origin main
HEAD_SHA="$(git rev-parse HEAD)"
ORIGIN_SHA="$(git rev-parse origin/main)"
if [ "$HEAD_SHA" != "$ORIGIN_SHA" ]; then
  die "HEAD is not origin/main — refusing to publish.
     HEAD        $HEAD_SHA
     origin/main $ORIGIN_SHA
   Push the version bump to main first; a published tarball must be
   reproducible from a commit that exists on the canonical branch."
fi
log "clean tree at origin/main $HEAD_SHA"

step "preflight: is $PKG_NAME@$VERSION already published?"
REGISTRY_STATUS="$(curl -sS -o /dev/null -w '%{http_code}' "$REGISTRY/$PKG_NAME/$VERSION" || echo 000)"
case "$REGISTRY_STATUS" in
  404)
    ALREADY_PUBLISHED=0
    log "not on the registry — this version is publishable"
    ;;
  200)
    ALREADY_PUBLISHED=1
    # npm forbids republishing a version, so this is not an error: it is the
    # idempotent case. Skip the publish and still reconcile the GitHub Release.
    log "already on the registry — publish will be SKIPPED (npm versions are immutable)"
    ;;
  *)
    die "registry returned HTTP $REGISTRY_STATUS for $PKG_NAME/$VERSION; refusing to guess"
    ;;
esac

step "preflight: credentials"

[ -f "$SECRET_FILE" ] || die "no npm credential at $SECRET_FILE
   Expected NPM_PUBLISH_TOKEN (a granular automation token for the
   'openagentsinc' npm account). See apps/pylon/docs/npm-publishing-runbook.md
   in the openagents repo."

# `set -a` exports what the file defines; the token is never echoed.
set -a
# shellcheck disable=SC1090
. "$SECRET_FILE"
set +a
[ -n "${NPM_PUBLISH_TOKEN:-}" ] || die "$SECRET_FILE does not define NPM_PUBLISH_TOKEN"
log "npm token loaded from $SECRET_FILE (${#NPM_PUBLISH_TOKEN} chars, value not shown)"

NPM_USERCONFIG="$(mktemp "${TMPDIR:-/tmp}/nostr-effect-npmrc.XXXXXX")"
chmod 600 "$NPM_USERCONFIG"
printf '//registry.npmjs.org/:_authToken=%s\n' "$NPM_PUBLISH_TOKEN" >"$NPM_USERCONFIG"
export NPM_CONFIG_USERCONFIG="$NPM_USERCONFIG"

# Prove the token authenticates before running the suite, rather than after.
NPM_USER="$(npm whoami 2>/dev/null || true)"
[ -n "$NPM_USER" ] || die "npm token did not authenticate (npm whoami failed).
   The token may be expired or revoked. Mint a new granular automation token
   for the 'openagentsinc' account and update $SECRET_FILE."
log "authenticated to npm as $NPM_USER"

command -v gh >/dev/null 2>&1 || die "gh CLI not installed; it cuts the GitHub Release"
gh auth status >/dev/null 2>&1 || die "gh is not authenticated (run: gh auth login)"
log "gh authenticated"

# ------------------------------------------------------------- 2. verification
#
# Before publish. Always. `pnpm run verify` alone does not provision a
# database, so PostgresStore.test.ts does not run and the relay's production
# store goes untested while the run reports green. verify:postgres stands up a
# throwaway Postgres 17, runs preflight -> verify -> postflight, and tears it
# down. Exit 2 means this machine could not provide a database. The pre-push
# hook may fall back to plain verify in that case; a RELEASE may not.

step "verify: full suite against a real Postgres (this is the gate)"
set +e
pnpm run verify:postgres
VERIFY_STATUS=$?
set -e

if [ "$VERIFY_STATUS" -eq 2 ]; then
  die "no Postgres 17 on this machine, so the relay's production storage
   backend was NOT covered. A release is not allowed to skip this gate —
   that is the exact gap that shipped the tag-encoding defect in #170.
   Cut the release from a machine with postgresql@17 or a running Docker:
     brew install postgresql@17"
fi
[ "$VERIFY_STATUS" -eq 0 ] || die "verification failed (exit $VERIFY_STATUS) — nothing was published"
log "verification passed with the Postgres suite covered"

# ------------------------------------------------------------------- 3. pack
#
# `pnpm pack`, not `npm pack`: pnpm rewrites `workspace:*` / `catalog:`
# dependency protocols to concrete versions. npm does not, and would publish an
# uninstallable manifest. (apps/pylon/docs/npm-publishing-runbook.md.)

step "pack: building the tarball that will be published"
PACK_OUT="$(pnpm pack --pack-destination "$REPO_ROOT" 2>&1 | tee /dev/stderr | tail -1)"
TARBALL="$(printf '%s' "$PACK_OUT" | tr -d '[:space:]')"
[ -f "$TARBALL" ] || die "pnpm pack did not produce a tarball (got: $PACK_OUT)"
log "packed $(basename "$TARBALL") ($(wc -c <"$TARBALL" | tr -d ' ') bytes)"

# The package ships TypeScript source: `files` is [src, README.md, LICENSE] and
# `main`/`types` point into src/. A tarball missing src/index.ts or the root
# declaration would install and then fail to resolve for every consumer.
step "pack: verifying tarball contents"
TAR_LIST="$(tar -tzf "$TARBALL")"
for required in package/package.json package/src/index.ts package/src/index.d.ts package/README.md package/LICENSE; do
  printf '%s\n' "$TAR_LIST" | grep -qxF "$required" \
    || die "tarball is missing $required"
done
PACKED_VERSION="$(tar -xzOf "$TARBALL" package/package.json | node -p "JSON.parse(require('node:fs').readFileSync(0,'utf8')).version")"
[ "$PACKED_VERSION" = "$VERSION" ] \
  || die "packed manifest says $PACKED_VERSION but package.json says $VERSION"
log "tarball contains $(printf '%s\n' "$TAR_LIST" | wc -l | tr -d ' ') entries; manifest version $PACKED_VERSION matches"

# ------------------------------------------------------------------ 4. publish

if [ "$DRY_RUN" -eq 1 ]; then
  step "publish: DRY RUN — asking npm what it would do, without doing it"
  # A real npm dry-run against the real tarball: it resolves the manifest,
  # contacts the registry, and reports the exact payload, but publishes nothing.
  npm publish "$TARBALL" --access public --dry-run
  log "DRY RUN: npm publish stopped here. Nothing was published."
elif [ "$ALREADY_PUBLISHED" -eq 1 ]; then
  step "publish: SKIPPED — $PKG_NAME@$VERSION is already on the registry"
else
  step "publish: npm publish (granular token; NO provenance — see header)"
  npm publish "$TARBALL" --access public
  log "published $PKG_NAME@$VERSION"

  # Registry-CDN propagation: the full document goes 200 before the abbreviated
  # "corgi" manifest does, and installs use corgi. A fresh publish therefore
  # looks like a 404 to clients for minutes. Poll rather than declare success.
  step "propagation: waiting for the abbreviated (corgi) manifest to carry $VERSION"
  for attempt in $(seq 1 60); do
    if curl -sS -H 'Accept: application/vnd.npm.install-v1+json' "$REGISTRY/$PKG_NAME" \
      | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{try{process.exit(JSON.parse(d).versions?.[process.argv[1]]?0:1)}catch{process.exit(1)}})" "$VERSION"
    then
      log "corgi manifest carries $VERSION after ${attempt} poll(s)"
      break
    fi
    [ "$attempt" -eq 60 ] && die "corgi manifest still lacks $VERSION after 5 minutes.
   The publish likely succeeded; propagation did not finish. Re-run this
   script — it is idempotent and will skip the publish."
    sleep 5
  done
fi

# --------------------------------------------------------------- 5. git tag
#
# The tag is created AFTER a successful publish, not before. A tag that names a
# release which failed to publish is a lie that outlives the failure.

if [ "$DRY_RUN" -eq 1 ]; then
  step "tag: DRY RUN — would create and push $TAG at $HEAD_SHA"
else
  step "tag: $TAG"
  if EXISTING="$(git rev-parse -q --verify "refs/tags/$TAG" 2>/dev/null)"; then
    [ "$EXISTING" = "$HEAD_SHA" ] \
      || die "tag $TAG already exists at $EXISTING but HEAD is $HEAD_SHA"
    log "tag already exists at HEAD — leaving it alone"
  else
    git tag -a "$TAG" -m "$PKG_NAME $VERSION"
    log "created $TAG"
  fi
  git push --quiet origin "$TAG"
  log "pushed $TAG"
fi

# ---------------------------------------------------------- 6. GitHub Release
#
# `gh release create`, replacing softprops/action-gh-release. This is the one
# GitHub interaction that remains, and it is an API call we make — not a
# GitHub-hosted runner executing our build. That distinction is the invariant.

PRERELEASE_FLAG=""
case "$VERSION" in *-*) PRERELEASE_FLAG="--prerelease" ;; esac

if [ "$DRY_RUN" -eq 1 ]; then
  step "github release: DRY RUN — would run: gh release create $TAG --generate-notes $PRERELEASE_FLAG"
elif gh release view "$TAG" >/dev/null 2>&1; then
  step "github release: SKIPPED — $TAG already exists"
else
  step "github release: creating $TAG"
  # --generate-notes reproduces the workflow's generate_release_notes. Release
  # notes are public; nothing from the credential file goes near them.
  # shellcheck disable=SC2086
  gh release create "$TAG" --generate-notes --verify-tag $PRERELEASE_FLAG
  log "created GitHub Release $TAG"
fi

# ------------------------------------------------------------------- summary

if [ "$DRY_RUN" -eq 1 ]; then
  printf '\n[release] DRY RUN COMPLETE — verified, packed, and validated %s@%s.\n' "$PKG_NAME" "$VERSION"
  printf '[release] Nothing was published, tagged, or released. Re-run without --dry-run to ship.\n\n'
else
  printf '\n[release] DONE — %s@%s\n' "$PKG_NAME" "$VERSION"
  printf '[release]   npm:    %s/package/%s/v/%s\n' 'https://www.npmjs.com' "$PKG_NAME" "$VERSION"
  printf '[release]   github: https://github.com/OpenAgentsInc/%s/releases/tag/%s\n' "$PKG_NAME" "$TAG"
  printf '[release]   provenance: none (published off GitHub Actions — see script header)\n\n'
fi
