import { cloudflareTest } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [cloudflareTest({ main: "./entry.ts", wrangler: { configPath: "./wrangler.jsonc" } })],
  test: { include: ["*.test.ts"], testTimeout: 120_000 },
});
