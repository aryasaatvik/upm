import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { checkPlacement, hoist } from "../src/hoist.ts";
import { fromPackageLock, parsePackageLock } from "../src/package-lock.ts";
import type { Resolution } from "../src/resolve.ts";

const cases = ["alias", "dev-optional", "nested", "optional", "peer", "react", "starter"];
const fixture = (name: string, file: string) =>
  readFile(
    fileURLToPath(new URL(`./fixtures/package-lock/${name}/${file}`, import.meta.url)),
    "utf8",
  );
describe("npm placement", () => {
  for (const name of cases)
    it(`keeps npm's lock-sourced ${name} placement and independently hoists its graph`, async () => {
      const manifest = JSON.parse(await fixture(name, "package.json"));
      const { resolution, placement } = fromPackageLock(
        parsePackageLock(await fixture(name, "package-lock.json")),
        manifest,
      );
      const fromLock = hoist(resolution);
      expect(fromLock).toEqual(placement);
      const withoutLockMetadata = structuredClone(resolution);
      expect(hoist(withoutLockMetadata)).toEqual(placement);
      checkPlacement(resolution, placement);
      expect(hoist(resolution, placement)).toEqual(placement);
    });
  it("keeps unaffected locations when a direct dependency changes version", async () => {
    const manifest = JSON.parse(await fixture("dev-optional", "package.json"));
    const { resolution, placement } = fromPackageLock(
      parsePackageLock(await fixture("dev-optional", "package-lock.json")),
      manifest,
    );
    const changed = structuredClone(resolution);
    const old = changed.packages["is-number@7.0.0"]!;
    delete changed.packages["is-number@7.0.0"];
    changed.packages["is-number@6.0.0"] = { ...old, version: "6.0.0" };
    changed.root.dependencies["is-number"] = "6.0.0";

    const next = hoist(changed, placement);
    expect(next.get("node_modules/is-number")).toBe("is-number@6.0.0");
    for (const [path, key] of placement)
      if (path !== "node_modules/is-number") expect(next.get(path)).toBe(key);
    checkPlacement(changed, next);
  });
  it("drops removed and unreachable packages while keeping unrelated placements", async () => {
    const manifest = JSON.parse(await fixture("dev-optional", "package.json"));
    const { resolution, placement } = fromPackageLock(
      parsePackageLock(await fixture("dev-optional", "package-lock.json")),
      manifest,
    );
    for (const leaveUnreachableRecord of [false, true]) {
      const changed = structuredClone(resolution);
      delete changed.root.dependencies["is-number"];
      if (!leaveUnreachableRecord) delete changed.packages["is-number@7.0.0"];

      const next = hoist(changed, placement);
      expect(next.has("node_modules/is-number")).toBe(false);
      for (const [path, key] of placement)
        if (path !== "node_modules/is-number") expect(next.get(path)).toBe(key);
      checkPlacement(changed, next);
    }
  });
  it("moves a seeded peer when its former host changes", () => {
    const pkg = (name: string, version: string, dependencies: Record<string, string> = {}) => ({
      name,
      version,
      resolved: "",
      integrity: "",
      dependencies,
      optional: false,
      dev: false,
      bin: {},
    });
    const before: Resolution = {
      root: { dependencies: { app: "1.0.0", host: "1.0.0" } },
      warnings: [],
      packages: {
        "app@1.0.0": pkg("app", "1.0.0", { plugin: "1.0.0" }),
        "plugin@1.0.0": {
          ...pkg("plugin", "1.0.0", { host: "1.0.0" }),
          peerDependencies: { host: "^1" },
          peers: { host: "required" },
        },
        "host@1.0.0": pkg("host", "1.0.0"),
      },
    };
    const previous = hoist(before);
    expect(previous.get("node_modules/plugin")).toBe("plugin@1.0.0");
    const changed = structuredClone(before);
    changed.root.dependencies.host = "2.0.0";
    changed.packages["host@2.0.0"] = pkg("host", "2.0.0");

    const next = hoist(changed, previous);
    expect(next.get("node_modules/app")).toBe("app@1.0.0");
    expect(next.get("node_modules/host")).toBe("host@2.0.0");
    expect(next.get("node_modules/app/node_modules/plugin")).toBe("plugin@1.0.0");
    expect(next.get("node_modules/app/node_modules/host")).toBe("host@1.0.0");
    checkPlacement(changed, next);
  });
  it("reports an unrepresentable peer", () => {
    const resolution: Resolution = {
      root: { dependencies: { plugin: "1.0.0", host: "1.0.0" } },
      warnings: [],
      packages: {
        "plugin@1.0.0": {
          name: "plugin",
          version: "1.0.0",
          resolved: "",
          integrity: "",
          dependencies: { host: "2.0.0" },
          peers: { host: "required" },
          optional: false,
          dev: false,
          bin: {},
        },
        "host@1.0.0": {
          name: "host",
          version: "1.0.0",
          resolved: "",
          integrity: "",
          dependencies: {},
          optional: false,
          dev: false,
          bin: {},
        },
        "host@2.0.0": {
          name: "host",
          version: "2.0.0",
          resolved: "",
          integrity: "",
          dependencies: {},
          optional: false,
          dev: false,
          bin: {},
        },
      },
    };
    expect(() => hoist(resolution)).toThrowError(expect.objectContaining({ code: "EPLACE" }));
  });
});
