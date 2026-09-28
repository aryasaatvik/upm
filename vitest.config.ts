import { createRequire } from "node:module";
import { defineConfig } from "vitest/config";
import { cloudflareTest } from "@cloudflare/vitest-pool-workers";

// Windows runners are slow enough to push tests that spawn processes or threads past 5 s.
const workerd = process.argv.some(
  (arg, index, args) =>
    arg === "--project=workerd" || (arg === "--project" && args[index + 1] === "workerd"),
);
if (workerd) {
  // The pool pins an older Miniflare release; use the test project's workerd binary for this date.
  process.env.MINIFLARE_WORKERD_PATH = (
    createRequire(import.meta.url)("workerd") as { default: string }
  ).default;
}
export default defineConfig({
  test: {
    projects: workerd
      ? [
          {
            plugins: [
              cloudflareTest({
                main: "./test/workerd/entry.ts",
                wrangler: { configPath: "./test/workerd/wrangler.jsonc" },
              }),
            ],
            test: { name: "workerd", include: ["test/workerd/*.test.ts"], testTimeout: 120_000 },
          },
        ]
      : [
          {
            test: {
              name: "unit",
              include: ["test/**/*.test.ts"],
              exclude: ["test/workerd/**"],
              // The CLI prefetch ordering test loses its timing window under a full CPU stampede.
              maxWorkers: 4,
              testTimeout: process.platform === "win32" ? 30_000 : 5_000,
            },
          },
        ],
  },
});
