import { describe, expect, it } from "vitest";
import { normalizeBin } from "../src/normalize-bin.ts";

describe("normalizeBin", () => {
  describe("no usable bin", () => {
    it.each([
      ["missing", { name: "foo" }],
      ["null", { name: "foo", bin: null }],
      ["number", { name: "foo", bin: 42 }],
      ["empty object", { name: "foo", bin: {} }],
      ["empty array", { name: "foo", bin: [] }],
      ["string bin without a package name", { bin: "cli.js" }],
    ])("%s", (_label, pkg) => {
      expect(normalizeBin(pkg)).toEqual({});
    });
  });

  describe("string form", () => {
    it("keys on the package name", () => {
      expect(normalizeBin({ name: "foo", bin: "cli.js" })).toEqual({ foo: "cli.js" });
    });

    it("keys a scoped package on the part after the slash", () => {
      expect(normalizeBin({ name: "@scope/foo", bin: "./cli.js" })).toEqual({ foo: "cli.js" });
    });
  });

  describe("array form", () => {
    it("keys each entry by its own basename", () => {
      expect(normalizeBin({ name: "foo", bin: ["./bin/a.js", "./bin/b.js"] })).toEqual({
        "a.js": "bin/a.js",
        "b.js": "bin/b.js",
      });
    });

    it("de-roots traversal in an entry", () => {
      expect(normalizeBin({ name: "foo", bin: ["../../evil.js"] })).toEqual({
        "evil.js": "evil.js",
      });
    });

    it("skips non-string entries", () => {
      expect(normalizeBin({ name: "foo", bin: ["a.js", 42, null] })).toEqual({ "a.js": "a.js" });
    });
  });

  describe("object form", () => {
    it("keeps clean entries", () => {
      expect(normalizeBin({ name: "foo", bin: { foo: "./bin/foo.js" } })).toEqual({
        foo: "bin/foo.js",
      });
    });

    it("normalizes interior traversal in a target", () => {
      expect(normalizeBin({ name: "foo", bin: { a: "./x/../y.js" } })).toEqual({ a: "y.js" });
    });
  });

  describe("attacks", () => {
    it.each([
      ["traversal in the key", { "../../evil": "x.js" }, { evil: "x.js" }],
      ["traversal in the target", { a: "../../../etc/passwd" }, { a: "etc/passwd" }],
      ["slash in the key", { "a/b": "y.js" }, { b: "y.js" }],
      ["backslash in the key", { "a\\b": "y.js" }, { b: "y.js" }],
      ["colon in the key", { "a:b": "y.js" }, { b: "y.js" }],
      ["backslash traversal in the target", { a: "..\\..\\evil.js" }, { a: "evil.js" }],
      ["absolute target", { a: "/etc/passwd" }, { a: "etc/passwd" }],
      ["scoped key", { "@other/bar": "z.js" }, { bar: "z.js" }],
      ["key is ..", { "..": "x.js" }, {}],
      ["key is .", { ".": "x.js" }, {}],
      ["key is empty", { "": "x.js" }, {}],
      ["target is ..", { a: ".." }, {}],
      ["target is empty", { a: "" }, {}],
      ["target is not a string", { a: 42 }, {}],
    ])("%s", (_label, bin, expected) => {
      expect(normalizeBin({ name: "foo", bin })).toEqual(expected);
    });

    it("keeps a bad entry from dropping a good one", () => {
      expect(normalizeBin({ name: "foo", bin: { "..": "x.js", ok: "./ok.js" } })).toEqual({
        ok: "ok.js",
      });
    });

    it("makes __proto__ an own property, not a prototype", () => {
      // A computed key is an ordinary own property; a literal one would set the prototype.
      const out = normalizeBin({ name: "foo", bin: { ["__proto__"]: "x.js" } });
      expect(Object.hasOwn(out, "__proto__")).toBe(true);
      expect(Object.getPrototypeOf(out)).toBe(Object.prototype);
    });
  });

  it("ignores directories.bin", () => {
    expect(normalizeBin({ name: "foo", directories: { bin: "./bin" } })).toEqual({});
  });
});
