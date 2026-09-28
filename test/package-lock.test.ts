import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  fromPackageLock,
  formatPackageLock,
  parsePackageLock,
  toPackageLock,
} from "../src/package-lock.ts";

const cases = [
  "alias",
  "dev-optional",
  "nested",
  "optional",
  "peer",
  "react",
  "root-metadata",
  "starter",
];
const fixture = (name: string, file: string) =>
  readFile(
    fileURLToPath(new URL(`./fixtures/package-lock/${name}/${file}`, import.meta.url)),
    "utf8",
  );
describe("npm v3 package locks", () => {
  for (const name of cases)
    it(`round trips ${name} byte for byte`, async () => {
      const text = await fixture(name, "package-lock.json");
      const manifest = JSON.parse(await fixture(name, "package.json"));
      const lock = parsePackageLock(text);
      const { resolution, placement } = fromPackageLock(lock, manifest);
      expect(placement.size).toBe(Object.keys(lock.packages).length - 1);
      expect(formatPackageLock(toPackageLock(resolution, placement, manifest))).toBe(text);
    });
  it("rejects old and malformed locks", () => {
    for (const text of ["{", "{}", '{"lockfileVersion":2,"packages":{}}'])
      expect(() => parsePackageLock(text)).toThrowError(expect.objectContaining({ code: "ELOCK" }));
  });
  it("rejects root drift", async () => {
    const lock = parsePackageLock(await fixture("react", "package-lock.json"));
    const manifest = JSON.parse(await fixture("react", "package.json"));
    manifest.dependencies.react = "^18";
    expect(() => fromPackageLock(lock, manifest)).toThrowError(
      expect.objectContaining({ code: "ELOCKSTALE" }),
    );
  });
  it("writes a changed package at the same path and the current root manifest", async () => {
    const lock = parsePackageLock(await fixture("dev-optional", "package-lock.json"));
    const manifest = JSON.parse(await fixture("dev-optional", "package.json"));
    const { resolution, placement } = fromPackageLock(lock, manifest);
    const old = resolution.packages["is-number@7.0.0"]!;
    delete resolution.packages["is-number@7.0.0"];
    resolution.packages["is-number@6.0.0"] = {
      ...old,
      version: "6.0.0",
      resolved: "https://registry.npmjs.org/is-number/-/is-number-6.0.0.tgz",
      integrity: "sha512-updated",
    };
    placement.set("node_modules/is-number", "is-number@6.0.0");
    manifest.optionalDependencies["is-number"] = "^6.0.0";

    const written = toPackageLock(resolution, placement, manifest);
    expect(written.packages[""]?.optionalDependencies?.["is-number"]).toBe("^6.0.0");
    expect(written.packages["node_modules/is-number"]).toMatchObject({
      version: "6.0.0",
      integrity: "sha512-updated",
    });
    expect(written.packages["node_modules/is-number"]?.resolved).toContain("is-number-6.0.0");
  });
  it("derives root metadata from the current manifest", async () => {
    const lock = parsePackageLock(await fixture("root-metadata", "package-lock.json"));
    const manifest = JSON.parse(await fixture("root-metadata", "package.json"));
    const { resolution, placement } = fromPackageLock(lock, manifest);
    manifest.license = { type: "ISC", url: "https://example.invalid/new-license" };
    manifest.bin = "./bin/next.js";
    manifest.engines.node = ">=22";
    manifest.funding.url = "https://example.invalid/new-fund";
    delete manifest.scripts;

    expect(toPackageLock(resolution, placement, manifest).packages[""]).toEqual({
      name: "fixture-root-metadata",
      version: "1.0.0",
      license: "ISC",
      bin: { "fixture-root-metadata": "bin/next.js" },
      engines: { node: ">=22" },
      funding: { type: "individual", url: "https://example.invalid/new-fund" },
    });
  });
  it("names both locations when one identity has two peer contexts", () => {
    const dependencies = { plugin: "^1", host: "^1", b: "^1" };
    const lock = parsePackageLock(
      JSON.stringify({
        lockfileVersion: 3,
        packages: {
          "": { dependencies },
          "node_modules/plugin": { version: "1.0.0", peerDependencies: { host: ">=1" } },
          "node_modules/host": { version: "1.0.0" },
          "node_modules/b": { version: "1.0.0", dependencies: { plugin: "^1", host: "^2" } },
          "node_modules/b/node_modules/host": { version: "2.0.0" },
          "node_modules/b/node_modules/plugin": {
            version: "1.0.0",
            peerDependencies: { host: ">=1" },
          },
        },
      }),
    );
    expect(() => fromPackageLock(lock, { dependencies })).toThrowError(
      expect.objectContaining({
        code: "EPLACE",
        message: expect.stringMatching(
          /plugin@1\.0\.0 appears in two peer contexts at node_modules\/plugin and node_modules\/b\/node_modules\/plugin/,
        ),
      }),
    );
  });
});
