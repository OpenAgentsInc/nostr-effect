import "vite-plus/test/config"

import { defineConfig } from "vite-plus"

/**
 * Canonical Vite Plus configuration for nostr-effect.
 * Matches the openagents monorepo Node 24 / pnpm / Vite Plus stack.
 */
export default defineConfig({
  test: {
    name: "node",
    environment: "node",
    include: ["src/**/*.{test,spec}.ts"],
    exclude: ["**/node_modules/**", "**/dist/**"],
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
  pack: {
    dts: false,
  },
})
