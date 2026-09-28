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
});
