import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { lockProject } from "../src/lock-project.ts";
import { parsePackageLock } from "../src/package-lock.ts";
import { materialize } from "../src/materialize.ts";
import { createRegistry } from "../src/registry.ts";
import { hashOf } from "./hash.ts";
import { makeTarball } from "./tarball.ts";

const fixture = (name: string, file: string) =>
  readFile(new URL(`./fixtures/package-lock/${name}/${file}`, import.meta.url), "utf8");

describe("lockProject", () => {
  it("returns a frozen lock byte for byte and rejects root drift", async () => {
    const manifest = JSON.parse(await fixture("nested", "package.json"));
    const lock = await fixture("nested", "package-lock.json");
    expect(
      await lockProject({ manifest, lock, mode: "frozen", registry: "https://registry.test" }),
    ).toEqual({ text: lock, changed: false, warnings: [] });
    await expect(
      lockProject({ manifest, mode: "frozen", registry: "https://registry.test" }),
    ).rejects.toMatchObject({ code: "ENOLOCK" });
    await expect(
      lockProject({
        manifest: { ...manifest, dependencies: {} },
        lock,
        mode: "frozen",
        registry: "https://registry.test",
      }),
    ).rejects.toMatchObject({ code: "ELOCKSTALE" });
  });

  it("keeps an unchanged update byte for byte", async () => {
    const manifest = JSON.parse(await fixture("nested", "package.json"));
    const lock = await fixture("nested", "package-lock.json");
    const result = await lockProject({
      manifest,
      lock,
      mode: "update",
      registry: "https://registry.npmjs.org",
      fetch: () => {
        throw new Error("unchanged update must use locked versions");
      },
    });
    expect(result).toEqual({ text: lock, changed: false, warnings: [] });
  });

  it("validates a scoped alias against its real package registry", async () => {
    const manifest = { dependencies: { alias: "npm:@scope/pkg@1.0.0" } };
    const lock = JSON.stringify({
      lockfileVersion: 3,
      packages: {
        "": manifest,
        "node_modules/alias": {
          name: "@scope/pkg",
          version: "1.0.0",
          resolved: "https://scope.test/@scope/pkg/-/pkg-1.0.0.tgz",
          integrity: "sha512-locked",
        },
      },
    });
    const registry = createRegistry({
      registry: "https://registry.test",
      scopes: { "@scope": "https://scope.test" },
      fetch: () => {
        throw new Error("locked alias must not fetch");
      },
    });
    const result = await lockProject({ manifest, lock, mode: "update", registry });
    expect(parsePackageLock(result.text).packages["node_modules/alias"]?.resolved).toBe(
      "https://scope.test/@scope/pkg/-/pkg-1.0.0.tgz",
    );
  });

  it.each([
    ["git+ssh://git@github.com/example/a.git", "git", "git dependencies are not supported"],
    ["git+https://github.com/example/a.git", "git", "git dependencies are not supported"],
    ["github:example/a", "git", "git dependencies are not supported"],
    ["file:../a.tgz", "file", "local file dependencies are not supported"],
    ["https://other.test/a.tgz", "tarball", "tarball outside allowed registries"],
  ])("refuses %s in an update before fetching", async (resolved, kind, message) => {
    const manifest = JSON.parse(await fixture("nested", "package.json"));
    const graph = JSON.parse(await fixture("nested", "package-lock.json"));
    const key = "node_modules/ansi-regex";
    graph.packages[key].resolved = resolved;
    let fetched = false;
    await expect(
      lockProject({
        manifest,
        lock: JSON.stringify(graph),
        mode: "update",
        registry: "https://registry.npmjs.org",
        fetch: async () => {
          fetched = true;
          throw new Error("unexpected fetch");
        },
      }),
    ).rejects.toMatchObject({
      code: "ELOCK",
      message: expect.stringContaining(message),
      detail: { key, resolved, kind },
    });
    expect(fetched).toBe(false);
  });

  it("refuses a public npm tarball when only a custom registry is configured", async () => {
    const manifest = JSON.parse(await fixture("nested", "package.json"));
    const lock = await fixture("nested", "package-lock.json");
    const key = "node_modules/ansi-regex";
    const resolved = parsePackageLock(lock).packages[key]!.resolved;
    let fetched = false;
    await expect(
      lockProject({
        manifest,
        lock,
        mode: "update",
        registry: "https://registry.test",
        fetch: async () => {
          fetched = true;
          throw new Error("unexpected fetch");
        },
      }),
    ).rejects.toMatchObject({ code: "ELOCK", detail: { key, resolved, kind: "tarball" } });
    expect(fetched).toBe(false);
    await expect(
      materialize({
        manifest,
        lock,
        registry: "https://registry.test",
        fetch: async () => {
          fetched = true;
          throw new Error("unexpected fetch");
        },
      }),
    ).rejects.toMatchObject({ code: "ELOCK", detail: { key, resolved, kind: "tarball" } });
    expect(fetched).toBe(false);
  });

  it("updates one direct package while keeping unrelated versions and placements", async () => {
    const manifest = JSON.parse(await fixture("nested", "package.json"));
    const lock = await fixture("nested", "package-lock.json");
    manifest.dependencies["ansi-regex"] = "^5.0.0";
    const updated = await lockProject({
      manifest,
      lock,
      mode: "update",
      registry: "https://registry.npmjs.org",
      fetch: () => {
        throw new Error("locked versions should suffice");
      },
    });
    const packages = parsePackageLock(updated.text).packages;
    expect(updated.changed).toBe(true);
    expect(packages["node_modules/ansi-regex"]?.version).toBe("5.0.1");
    expect(packages["node_modules/strip-ansi"]?.version).toBe("6.0.1");
    expect(packages[""]?.dependencies).toEqual(manifest.dependencies);
  });

  it.each(["devDependencies", "dependencies"] as const)(
    "recomputes placement flags when moving a package out of %s",
    async (from) => {
      const to = from === "devDependencies" ? "dependencies" : "devDependencies";
      const archive = makeTarball([{ path: "index.js", data: "export default 1" }]);
      const manifest = { [from]: { a: "1.0.0" } };
      const lock = JSON.stringify({
        lockfileVersion: 3,
        packages: {
          "": manifest,
          "node_modules/a": {
            version: "1.0.0",
            resolved: "https://registry.test/a.tgz",
            integrity: hashOf(archive),
            license: "MIT",
            ...(from === "devDependencies" && { dev: true }),
          },
        },
      });
      const next = { [to]: { a: "1.0.0" } };
      const updated = await lockProject({
        manifest: next,
        lock,
        mode: "update",
        registry: "https://registry.test",
        fetch: () => {
          throw new Error("locked version must suffice");
        },
      });
      const entry = parsePackageLock(updated.text).packages["node_modules/a"]!;
      expect(entry.license).toBe("MIT");
      expect(entry.dev).toBe(to === "devDependencies" ? true : undefined);
      expect(entry.optional).toBeUndefined();
      expect(entry.devOptional).toBeUndefined();
      expect(entry.peer).toBeUndefined();
      const installed = await materialize({
        manifest: next,
        lock: updated.text,
        registry: "https://registry.test",
        production: true,
        fetch: async () => new Response(Buffer.from(archive)),
      });
      expect(installed.packages).toBe(to === "dependencies" ? 1 : 0);
    },
  );

  it("rejects unreadable foreign locks with a typed error", async () => {
    await expect(
      lockProject({
        manifest: {},
        mode: "update",
        registry: "https://registry.test",
        from: { file: "bun.lock", text: "{" },
      }),
    ).rejects.toMatchObject({ code: "EFOREIGNLOCK" });
  });

  it.each([
    ["ETIMEDOUT", "EREGISTRY"],
    ["ETIMEOUT", "EREGISTRY"],
    ["ENETWORK", "EREGISTRY"],
    ["EREGISTRY", "EREGISTRY"],
    ["EJSONPARSE", "EREGISTRY"],
    ["EOFFLINE", "EREGISTRY"],
    ["E404", "ENOTFOUND"],
    ["ETARGET", "ENOTFOUND"],
  ])("maps registry %s to %s", async (code, expected) => {
    const registry = {
      ...createRegistry({ registry: "https://registry.test" }),
      pick: async (): Promise<never> => {
        throw Object.assign(new Error(code), { code });
      },
    };
    await expect(
      lockProject({
        manifest: { dependencies: { a: "^1.0.0" } },
        mode: "update",
        registry,
      }),
    ).rejects.toMatchObject({ code: expected });
  });

  it("aborts an in-flight registry request", async () => {
    const controller = new AbortController();
    const pending = lockProject({
      manifest: { dependencies: { a: "^1.0.0" } },
      mode: "update",
      registry: "https://registry.test",
      signal: controller.signal,
      fetch: (_request, init) =>
        new Promise<Response>((_, reject) => {
          init?.signal?.addEventListener("abort", () => reject(new Error("aborted")), {
            once: true,
          });
        }),
    });
    controller.abort();
    await expect(pending).rejects.toMatchObject({ code: "EABORT" });
  });

  it.each(["bun.lock", "pnpm-lock.yaml"] as const)(
    "converts %s without registry requests",
    async (file) => {
      const manifest = JSON.parse(
        await readFile(new URL("./fixtures/foreign/package.json", import.meta.url), "utf8"),
      );
      const foreign = await readFile(
        new URL(`./fixtures/foreign/${file}`, import.meta.url),
        "utf8",
      );
      const result = await lockProject({
        manifest,
        mode: "update",
        from: { file, text: foreign },
        registry: "https://registry.npmjs.org",
        fetch: () => {
          throw new Error("conversion must use locked versions");
        },
      });
      expect(parsePackageLock(result.text).packages["node_modules/nitro"]?.version).toBe(
        "3.0.260903-beta",
      );
    },
  );
});
