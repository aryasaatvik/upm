import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { lockProject } from "../src/lock-project.ts";
import { parsePackageLock } from "../src/package-lock.ts";

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

  it("updates one direct package while keeping unrelated versions and placements", async () => {
    const manifest = JSON.parse(await fixture("nested", "package.json"));
    const lock = await fixture("nested", "package-lock.json");
    manifest.dependencies["ansi-regex"] = "^5.0.0";
    const updated = await lockProject({
      manifest,
      lock,
      mode: "update",
      registry: "https://registry.test",
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
