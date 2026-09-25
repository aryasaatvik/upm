import { afterEach, describe, expect, it, vi } from "vitest";
import { builtin } from "../src/builtin.ts";

/** A module instance that has read nothing yet, so its getters are still getters. */
async function fresh(): Promise<typeof builtin> {
  vi.resetModules();
  return (await import("../src/builtin.ts")).builtin;
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe("builtin", () => {
  it("hands back the real modules", () => {
    expect(builtin.path.join("a", "b")).toBe(`a${builtin.path.sep}b`);
    expect(typeof builtin.fsp.readFile).toBe("function");
    expect(typeof builtin.zlib.createGunzip).toBe("function");
  });

  it("loads a module once, then reads it as a plain property", async () => {
    const loaded = await fresh();
    expect(Object.getOwnPropertyDescriptor(loaded, "os")?.get).toBeTypeOf("function");
    const first = loaded.os;
    expect(Object.getOwnPropertyDescriptor(loaded, "os")).toMatchObject({ value: first });
    expect(loaded.os).toBe(first);
  });

  // Nothing is read at import time, so a runtime missing a module only fails where that
  // module is actually needed — which is what makes this the first step off Node.
  it("fails with ENOBUILTIN where the runtime has no such module", async () => {
    const spy = vi.spyOn(globalThis.process, "getBuiltinModule").mockReturnValue(undefined);
    const absent = await fresh();
    expect(() => absent.zlib).toThrow(
      expect.objectContaining({
        code: "ENOBUILTIN",
        message: expect.stringContaining("node:zlib"),
      }),
    );
    // Still a getter, so the same instance works once the module is there.
    spy.mockRestore();
    expect(typeof absent.zlib.createGunzip).toBe("function");
  });

  // A `process` shim without the method (a browser polyfill, an old Node) is the same case,
  // not a TypeError on the call.
  it("fails with ENOBUILTIN where process has no getBuiltinModule", async () => {
    vi.stubGlobal("process", Object.create(process, { getBuiltinModule: { value: undefined } }));
    const absent = await fresh();
    expect(() => absent.fs).toThrow(expect.objectContaining({ code: "ENOBUILTIN" }));
  });
});
