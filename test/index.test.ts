import { describe, expect, it } from "vitest";
import * as upm from "../src/index.ts";
import * as resolver from "../src/resolver.ts";

describe("public api", () => {
  it("exports the commands", () => {
    expect(Object.keys(upm).sort()).toEqual([
      "add",
      "dedupe",
      "exec",
      "fetchLockfile",
      "fetchPackages",
      "install",
      "listScripts",
      "lock",
      "prune",
      "remove",
      "resolve",
      "run",
    ]);
  });

  it("exports the portable resolver", () => {
    expect(Object.keys(resolver).sort()).toEqual([
      "UpmError",
      "checkPlacement",
      "createRegistry",
      "formatLockfile",
      "formatPackageLock",
      "fromLockfile",
      "fromPackageLock",
      "hoist",
      "parseLockfile",
      "parsePackageLock",
      "parseSpec",
      "resolveTree",
      "toLockfile",
      "toPackageLock",
    ]);
  });
});
