import { createWorker, type Files } from "@cloudflare/worker-bundler";
import { describe, expect, it } from "vitest";
import { materialize } from "../../src/worker.ts";
import manifest from "../fixtures/package-lock/starter/package.json" with { type: "json" };
import lock from "../fixtures/package-lock/starter/package-lock.json?raw";

describe("workerd email starter", () => {
  it("materializes locked packages and bundles the renderer without bare imports", async () => {
    const start = Date.now();
    const installed = await materialize({
      manifest,
      lock,
      production: true,
      platform: "none",
      include: (path) => /\.(?:[cm]?js|[cm]?ts|json|css)$/.test(path),
    });
    const files: Files = {
      ...installed.files,
      "package.json": JSON.stringify({
        name: "starter-workerd-proof",
        type: "module",
        dependencies: {},
      }),
      "wrangler.json": JSON.stringify({
        compatibility_date: "2025-01-01",
        compatibility_flags: ["nodejs_compat"],
      }),
      "src/index.js": `
        import { Email, Section, Button } from "@samva/markup/email/components";
        import { jsonSchema } from "@samva/markup/input-schema";
        import { defineEmail } from "@samva/markup/template";
        export default { fetch() { return new Response(String(Email && Section && Button && jsonSchema && defineEmail)); } };
      `,
    };
    const built = await createWorker({
      files,
      entryPoint: "src/index.js",
      bundle: true,
      target: "es2022",
      conditions: ["workerd", "worker", "browser", "import", "module"],
    });
    const module = built.modules[built.mainModule];
    const code = typeof module === "string" ? module : module?.js;
    expect(typeof code).toBe("string");
    const unresolved = [
      ...(code ?? "").matchAll(
        /(?:from\s*|import\s*\(|require\s*\()["'](?!\.|\/|node:)([^"']+)["']/g,
      ),
    ].map((match) => match[1]);
    expect(unresolved).toEqual([]);
    console.log(
      JSON.stringify({
        packages: installed.packages,
        files: Object.keys(installed.files).length,
        unpackedBytes: installed.unpackedBytes,
        bundleBytes: code?.length,
        unresolved,
        elapsedMs: Date.now() - start,
      }),
    );
  }, 120_000);
});
