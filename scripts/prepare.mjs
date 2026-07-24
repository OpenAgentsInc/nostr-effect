#!/usr/bin/env node
// Lifecycle `prepare` guard.
//
// `prepare` runs in three situations:
//   1. local dev install inside this source repo (`pnpm install` here)
//   2. `npm publish` / packing of this package
//   3. a CONSUMER installing this package as a git dependency
//      (e.g. `github:OpenAgentsInc/nostr-effect#<sha>`), which is how
//      `@openagentsinc/nip90` -> `@openagentsinc/pylon` pull it in.
//
// Cases (2) and (3) must NOT run our dev-only setup: patching the local
// TypeScript (`effect-language-service patch`) and installing a git
// pre-push hook (`setup:hooks`). Doing so previously hard-required `bun`
// and crashed `npx @openagentsinc/pylon` on any machine without bun
// preinstalled (e.g. a clean Ubuntu/Node box).
//
// This script runs under plain Node and only performs the dev-only setup
// when we are genuinely in the source working tree. In every other case it
// exits 0 silently so consumer installs always succeed.

import { existsSync } from "node:fs"
import { spawnSync } from "node:child_process"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(here, "..")

const log = (msg) => process.stdout.write(`[nostr-effect prepare] ${msg}\n`)

// 1) Only run dev setup from inside this package's own source checkout.
//    A consumer git-dep install runs `prepare` from a temp cache dir that
//    lacks our pre-push hook source, and a packed tarball has no `.git`.
const prePushSource = join(repoRoot, "scripts", "pre-push")
const gitDir = join(repoRoot, ".git")
const inSourceRepo = existsSync(gitDir) && existsSync(prePushSource)

// 2) An install nested under node_modules is a consumer install, never dev.
const nestedInNodeModules = repoRoot.split(/[\\/]/).includes("node_modules")

if (!inSourceRepo || nestedInNodeModules) {
  // Consumer install or packed tarball: nothing to do. Exit cleanly so
  // `npm install` / `npx` succeed without a package manager bootstrap.
  process.exit(0)
}

// In-repo dev install: run the real dev setup, but never let a failure
// here break `pnpm install`.
const run = (cmd, args) => {
  const r = spawnSync(cmd, args, {
    stdio: "inherit",
    cwd: repoRoot,
    shell: process.platform === "win32",
  })
  if (r.status !== 0) {
    log(`'${cmd} ${args.join(" ")}' exited ${r.status ?? "null"} (non-fatal; continuing).`)
  }
}

run("pnpm", ["exec", "effect-language-service", "patch"])
run("pnpm", ["run", "setup:hooks"])

process.exit(0)
