import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { fromPackageLock, parsePackageLock } from "../src/package-lock.ts";

const cases = ["alias", "dev-optional", "nested", "optional", "peer", "react", "starter"];
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
      expect(Object.keys(resolution.packages).length).toBeGreaterThan(0);
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
});
