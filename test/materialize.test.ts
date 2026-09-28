import { describe, expect, it } from "vitest";
import { materialize } from "../src/materialize.ts";
import type { MaterializeInput } from "../src/materialize.ts";
import type { TarballCache } from "../src/tarball-cache.ts";
import { hashOf } from "./hash.ts";
import { makeTarball } from "./tarball.ts";

const archive = makeTarball([
  { path: "index.js", data: "module.exports = 1" },
  { path: "README.md", data: "documentation" },
]);
const integrity = hashOf(archive);
const manifest = { name: "example", version: "1.0.0", dependencies: { a: "1.0.0" } };
const lock = JSON.stringify({
  name: manifest.name,
  version: manifest.version,
  lockfileVersion: 3,
  packages: {
    "": manifest,
    "node_modules/a": { version: "1.0.0", resolved: "https://registry.test/a.tgz", integrity },
  },
});

function setup(overrides: Partial<MaterializeInput> = {}) {
  const calls: string[] = [];
  const fetcher: typeof fetch = async (request) => {
    calls.push(String(request));
    return new Response(Buffer.from(archive));
  };
  return {
    calls,
    input: {
      manifest,
      lock,
      registry: "https://registry.test",
      fetch: fetcher,
      platform: "none" as const,
      ...overrides,
    },
  };
}

describe("materialize", () => {
  it("fetches, verifies and filters files at the locked placement", async () => {
    const { calls, input } = setup({ include: (path) => path.endsWith(".js") });
    const result = await materialize(input);
    expect(calls).toEqual(["https://registry.test/a.tgz"]);
    expect(Object.keys(result.files)).toEqual(["node_modules/a/index.js"]);
    expect(new TextDecoder().decode(result.files["node_modules/a/index.js"])).toBe(
      "module.exports = 1",
    );
    expect(result.packages).toBe(1);
  });

  it("refuses tarballs outside the allowed registry before fetching", async () => {
    for (const resolved of ["https://internal.test/a.tgz", "http://registry.test/a.tgz"]) {
      const graph = JSON.parse(lock);
      graph.packages["node_modules/a"].resolved = resolved;
      const { calls, input } = setup({ lock: JSON.stringify(graph) });
      await expect(materialize(input)).rejects.toMatchObject({
        code: "ELOCK",
        detail: { key: "node_modules/a", resolved },
      });
      expect(calls).toEqual([]);
    }
  });

  it("requires the configured registry path prefix", async () => {
    const { input } = setup({ registries: ["https://registry.test/packages/"] });
    await expect(materialize(input)).rejects.toMatchObject({
      code: "ELOCK",
      detail: { key: "node_modules/a", resolved: "https://registry.test/a.tgz" },
    });
  });

  it("checks each redirect and accepts only listed registry paths", async () => {
    const denied = setup({
      fetch: async (_request, init) => {
        expect(init?.redirect).toBe("manual");
        return new Response(null, {
          status: 302,
          headers: { location: "https://internal.test/a.tgz" },
        });
      },
    });
    await expect(materialize(denied.input)).rejects.toMatchObject({
      code: "ELOCK",
      detail: { key: "node_modules/a", resolved: "https://internal.test/a.tgz" },
    });

    const calls: string[] = [];
    const allowed = setup({
      fetch: async (request, init) => {
        expect(init?.redirect).toBe("manual");
        calls.push(String(request));
        return calls.length === 1
          ? new Response(null, { status: 302, headers: { location: "/tarballs/a.tgz" } })
          : new Response(Buffer.from(archive));
      },
    });
    expect((await materialize(allowed.input)).packages).toBe(1);
    expect(calls).toEqual(["https://registry.test/a.tgz", "https://registry.test/tarballs/a.tgz"]);
  });

  it("allows HTTP only when its registry is explicitly listed", async () => {
    const graph = JSON.parse(lock);
    graph.packages["node_modules/a"].resolved = "http://registry.test/a.tgz";
    const { input } = setup({
      lock: JSON.stringify(graph),
      registries: ["http://registry.test"],
    });
    expect((await materialize(input)).packages).toBe(1);
  });

  it("uses a verified hit and replaces a corrupt hit, ignoring cache write failure", async () => {
    let stored = archive;
    const puts: Uint8Array[] = [];
    const cache: TarballCache = {
      get: async () => stored,
      put: async (_key, bytes) => {
        puts.push(bytes);
        throw new Error("cache unavailable");
      },
    };
    const hit = setup({ tarballCache: cache });
    expect((await materialize(hit.input)).packages).toBe(1);
    expect(hit.calls).toHaveLength(0);
    stored = new Uint8Array([1, 2, 3]);
    const miss = setup({ tarballCache: cache });
    expect((await materialize(miss.input)).packages).toBe(1);
    expect(miss.calls).toHaveLength(1);
    expect(Buffer.from(puts[0]!)).toEqual(Buffer.from(archive));
  });

  it.each([
    ["packages", 0],
    ["downloadBytes", archive.length - 1],
    ["unpackedBytes", 1],
    ["files", 1],
  ] as const)("enforces the %s budget", async (limit, max) => {
    const { input } = setup({ limits: { [limit]: max } });
    await expect(materialize(input)).rejects.toMatchObject({
      code: "ELIMIT",
      detail: { limit, max },
    });
  });

  it("reports abort, registry, download integrity and cache integrity failures", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(materialize(setup({ signal: controller.signal }).input)).rejects.toMatchObject({
      code: "EABORT",
    });
    await expect(
      materialize(setup({ fetch: async () => new Response("no", { status: 503 }) }).input),
    ).rejects.toMatchObject({ code: "EREGISTRY" });
    const corrupt = async () => new Response(new Uint8Array([1, 2, 3]));
    await expect(materialize(setup({ fetch: corrupt }).input)).rejects.toMatchObject({
      code: "EINTEGRITY",
      detail: { phase: "download" },
    });
    await expect(
      materialize(
        setup({
          fetch: corrupt,
          tarballCache: { get: async () => new Uint8Array([4]), put: async () => {} },
        }).input,
      ),
    ).rejects.toMatchObject({ code: "EINTEGRITY", detail: { phase: "cache" } });
    const malformed = JSON.parse(lock);
    malformed.packages["node_modules/a"].integrity = "invalid";
    await expect(
      materialize(setup({ lock: JSON.stringify(malformed) }).input),
    ).rejects.toMatchObject({ code: "EINTEGRITY", detail: { phase: "lock" } });
  });

  it("keeps nested duplicate placements and skips dev or platform-excluded packages", async () => {
    const graph = JSON.parse(lock);
    graph.packages["node_modules/a"].optionalDependencies = { b: "1.0.0" };
    graph.packages["node_modules/a/node_modules/b"] = {
      version: "1.0.0",
      resolved: "https://registry.test/b.tgz",
      integrity,
    };
    const nested = await materialize(setup({ lock: JSON.stringify(graph) }).input);
    expect(nested.files["node_modules/a/node_modules/b/index.js"]).toBeDefined();
    graph.packages["node_modules/a/node_modules/b"].optional = true;
    graph.packages["node_modules/a/node_modules/b"].os = ["darwin"];
    const platform = await materialize(
      setup({ lock: JSON.stringify(graph), platform: { os: "linux", cpu: "x64" } }).input,
    );
    expect(platform.packages).toBe(1);
    const nativeFree = await materialize(
      setup({ lock: JSON.stringify(graph), platform: "none" }).input,
    );
    expect(nativeFree.packages).toBe(1);
    expect(nativeFree.files["node_modules/a/node_modules/b/index.js"]).toBeUndefined();

    // A negated-only list excludes win32, so it still allows the non-native target.
    graph.packages["node_modules/a/node_modules/b"].os = ["!win32"];
    const negated = await materialize(
      setup({ lock: JSON.stringify(graph), platform: "none" }).input,
    );
    expect(negated.packages).toBe(2);
    expect(negated.files["node_modules/a/node_modules/b/index.js"]).toBeDefined();
  });
});
