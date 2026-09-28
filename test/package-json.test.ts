import { describe, expect, it } from "vitest";
import {
  addDeps,
  checkManifest,
  formatManifest,
  parseManifest,
  removeDeps,
  saveRange,
} from "../src/package-json.ts";
import type { RootManifest } from "../src/resolve.ts";
import { parseSpec } from "../src/spec.ts";

describe("saveRange", () => {
  it("saves a range or version as typed", () => {
    expect(saveRange(parseSpec("foo@^1"), "1.4.0")).toBe("^1");
    expect(saveRange(parseSpec("foo@~1.2"), "1.2.9")).toBe("~1.2");
    expect(saveRange(parseSpec("foo@1.2.3"), "1.2.3")).toBe("1.2.3");
    expect(saveRange(parseSpec("foo@1.2.3"), "1.2.3", true)).toBe("1.2.3");
  });

  it("turns a bare name, * or tag into a caret on the resolved version", () => {
    expect(saveRange(parseSpec("foo"), "2.0.1")).toBe("^2.0.1");
    expect(saveRange(parseSpec("foo@*"), "2.0.1")).toBe("^2.0.1");
    expect(saveRange(parseSpec("foo@latest"), "2.0.1")).toBe("^2.0.1");
    expect(saveRange(parseSpec("foo@next"), "3.0.0-beta.1")).toBe("^3.0.0-beta.1");
  });

  it("pins the resolved version under --exact", () => {
    expect(saveRange(parseSpec("foo"), "2.0.1", true)).toBe("2.0.1");
    expect(saveRange(parseSpec("foo@beta"), "3.0.0-beta.1", true)).toBe("3.0.0-beta.1");
  });

  it("keeps an alias an alias", () => {
    expect(saveRange(parseSpec("sw@npm:string-width@^4"), "4.2.3")).toBe("npm:string-width@^4");
    expect(saveRange(parseSpec("sw@npm:string-width"), "4.2.3")).toBe("npm:string-width@^4.2.3");
    expect(saveRange(parseSpec("sw@npm:@scope/w@1.0.0"), "1.0.0")).toBe("npm:@scope/w@1.0.0");
  });

  it("saves a workspace: spec as typed, exact or not", () => {
    expect(saveRange(parseSpec("b@workspace:*"), "1.0.0")).toBe("workspace:*");
    expect(saveRange(parseSpec("b@workspace:^"), "1.0.0", true)).toBe("workspace:^");
    expect(saveRange(parseSpec("b2@workspace:b@^1"), "1.0.0")).toBe("workspace:b@^1");
  });
});

describe("addDeps", () => {
  it("creates the group, and keeps it sorted", () => {
    const manifest: RootManifest = { name: "demo", dependencies: { b: "^1" } };
    addDeps(manifest, [{ name: "a", range: "^2", group: "dependencies" }]);
    expect(Object.keys(manifest.dependencies!)).toEqual(["a", "b"]);
    addDeps(manifest, [{ name: "c", range: "^3", group: "devDependencies" }]);
    expect(manifest.devDependencies).toEqual({ c: "^3" });
  });

  it("moves a name out of any other group", () => {
    const manifest: RootManifest = {
      dependencies: { a: "^1" },
      optionalDependencies: { a: "^1", z: "*" },
    };
    addDeps(manifest, [{ name: "a", range: "^2", group: "devDependencies" }]);
    // A group emptied by the move goes, rather than staying as `{}`.
    expect(manifest).toEqual({ optionalDependencies: { z: "*" }, devDependencies: { a: "^2" } });
  });

  it("replaces the range of a name already in the group", () => {
    const manifest: RootManifest = { dependencies: { a: "^1" } };
    addDeps(manifest, [{ name: "a", range: "1.5.0", group: "dependencies" }]);
    expect(manifest.dependencies).toEqual({ a: "1.5.0" });
  });
});

describe("removeDeps", () => {
  it("removes from every group and reports what was in none", () => {
    const manifest: RootManifest = {
      dependencies: { a: "^1", b: "^1" },
      devDependencies: { a: "^1" },
    };
    expect(removeDeps(manifest, ["a", "nope", "b"])).toEqual(["nope"]);
    expect(manifest).toEqual({});
  });

  it("does not read inherited keys as dependencies", () => {
    expect(removeDeps({ dependencies: {} }, ["constructor"])).toEqual(["constructor"]);
  });
});

describe("formatManifest", () => {
  it("keeps the file's indent and trailing newline", () => {
    const tabs = '{\n\t"name": "demo"\n}\n';
    expect(formatManifest(JSON.parse(tabs), tabs)).toBe(tabs);
    const four = '{\n    "name": "demo"\n}';
    expect(formatManifest(JSON.parse(four), four)).toBe(four);
  });

  it("defaults to two spaces and no trailing newline for a one-line file", () => {
    expect(formatManifest({ name: "demo" }, '{"name":"demo"}')).toBe('{\n  "name": "demo"\n}');
  });

  it("keeps CRLF line endings", () => {
    const crlf = '{\r\n  "name": "demo"\r\n}\r\n';
    expect(formatManifest(JSON.parse(crlf), crlf)).toBe(crlf);
  });
});

describe("checkManifest", () => {
  it("accepts a bare object and string maps", () => {
    expect(() => checkManifest({}, "p")).not.toThrow();
    expect(() => checkManifest({ dependencies: { a: "^1" } }, "p")).not.toThrow();
  });

  it("refuses what an edit could not write back", () => {
    expect(() => checkManifest([], "p")).toThrow("not a JSON object");
    expect(() => checkManifest({ dependencies: "oops" }, "p")).toThrow("dependencies is not a map");
    expect(() => checkManifest({ devDependencies: { a: 1 } }, "p")).toThrow("not a map");
  });
});

describe("parseManifest", () => {
  it("parses and checks, naming the file in every refusal", () => {
    expect(parseManifest('{"dependencies":{"a":"^1"}}', "p")).toEqual({
      dependencies: { a: "^1" },
    });
    let message = "";
    try {
      JSON.parse("{");
    } catch (error) {
      message = (error as Error).message;
    }
    expect(() => parseManifest("{", "p")).toThrow(
      expect.objectContaining({ message: `p is not valid JSON: ${message}`, code: "EMANIFEST" }),
    );
    expect(() => parseManifest("[]", "p")).toThrow(
      expect.objectContaining({ message: "p is not a JSON object", code: "EMANIFEST" }),
    );
    const peers = '{"peerDependencies":{"a":1}}';
    expect(parseManifest(peers, "p")).toEqual({ peerDependencies: { a: 1 } });
    expect(() => parseManifest(peers, "p", ["peerDependencies"])).toThrow(
      "p: peerDependencies is not a map of ranges",
    );
  });
});
