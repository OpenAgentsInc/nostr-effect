/**
 * SARAH-NR-01b exit smoke:
 * 1) static import graph of nostr-effect/relay has no bun: / Bun.
 * 2) bundle the barrel for Node and start MemoryEventStoreLive under Node.
 */
import { spawnSync } from "node:child_process"
import fs from "node:fs"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

const root = join(dirname(fileURLToPath(import.meta.url)), "..")
const relayEntry = join(root, "src/relay/index.ts")
const visited = new Set()
const bunHits = []

const resolveImport = (fromFile, spec) => {
  if (!spec.startsWith(".")) return null
  const base = join(dirname(fromFile), spec)
  const withoutJs = base.endsWith(".js") ? base.slice(0, -3) : base
  for (const candidate of [
    base,
    withoutJs + ".ts",
    withoutJs + ".js",
    withoutJs,
    join(withoutJs, "index.ts"),
  ]) {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate
  }
  return null
}

const walk = (file) => {
  if (visited.has(file)) return
  visited.add(file)
  const text = fs.readFileSync(file, "utf8")
  // Detect real Bun coupling, not prose that mentions the migration.
  if (
    /(?:^|\n)\s*import\s+[^;]*["']bun:[^"']+["']/.test(text) ||
    /(?:^|\n)[^/\n]*\bBun\./.test(text)
  ) {
    bunHits.push(file)
  }
  for (const match of text.matchAll(
    /(?:import|export)\s+(?:type\s+)?(?:[^"'{}]*\{[^}]*\}|[^"'{}]+)\s+from\s+["']([^"']+)["']|export\s+\*\s+from\s+["']([^"']+)["']/g
  )) {
    const spec = match[1] ?? match[2]
    const next = resolveImport(file, spec)
    if (next) walk(next)
  }
}

walk(relayEntry)

if (bunHits.length > 0) {
  console.error("bun: / Bun. references still reachable from nostr-effect/relay:")
  for (const hit of bunHits) console.error(" -", hit)
  process.exit(1)
}

const outDir = mkdtempSync(join(tmpdir(), "nostr-effect-relay-smoke-"))
try {
  const build = spawnSync(
    "bun",
    ["build", relayEntry, "--outdir", outDir, "--target", "node"],
    { encoding: "utf8", cwd: root }
  )
  if (build.status !== 0) {
    console.error(build.stdout)
    console.error(build.stderr)
    process.exit(1)
  }

  const mod = await import(pathToFileURL(join(outDir, "index.js")).href)
  const { Effect } = await import("effect")
  const count = await Effect.runPromise(
    Effect.gen(function* () {
      const store = yield* mod.EventStore
      return yield* store.count()
    }).pipe(Effect.provide(mod.MemoryEventStoreLive))
  )
  if (count !== 0) {
    console.error("Expected empty memory store, got", count)
    process.exit(1)
  }
  if (!mod.RelayServer) {
    console.error("Expected RelayServer export")
    process.exit(1)
  }

  console.log(
    JSON.stringify({
      ok: true,
      visitedFiles: visited.size,
      bunHits: 0,
      memoryStoreCount: count,
      exports: ["RelayServer", "MemoryEventStoreLive", "EventStore"],
    })
  )
} finally {
  rmSync(outDir, { recursive: true, force: true })
}
