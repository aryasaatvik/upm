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
    it(`matches ${name}`, async () => {
      const manifest = JSON.parse(await fixture(name, "package.json"));
      const { resolution, placement } = fromPackageLock(
        parsePackageLock(await fixture(name, "package-lock.json")),
        manifest,
      );
      expect(hoist(resolution)).toEqual(placement);
      checkPlacement(resolution, placement);
      expect(hoist(resolution, placement)).toEqual(placement);
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
