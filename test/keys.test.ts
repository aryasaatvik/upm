import { describe, expect, it } from "vitest";
import { graphHash, storeKey, storeKeys } from "../src/keys.ts";
import { keyOf } from "../src/resolve.ts";
import type { Resolution, ResolvedPackage } from "../src/resolve.ts";

type Spec = Record<string, string[]>;

/** `@scope/pkg@1.0.0` -> name and version. */
function split(id: string): { name: string; version: string } {
  const at = id.lastIndexOf("@");
  return { name: id.slice(0, at), version: id.slice(at + 1) };
}

/** Build a `packages` record from `id -> dep ids`. `integrity` overrides a package's content. */
function build(
  spec: Spec,
  integrity: Record<string, string> = {},
): Record<string, ResolvedPackage> {
  const out: Record<string, ResolvedPackage> = {};
  for (const [id, deps] of Object.entries(spec)) {
    const { name, version } = split(id);
    const dependencies: Record<string, string> = {};
    for (const dep of deps) {
      const child = split(dep);
      dependencies[child.name] = child.version;
    }
    out[id] = {
      name,
      version,
      resolved: `https://registry.test/${name}/-/${version}.tgz`,
      integrity: integrity[id] ?? `sha512-${name}${version}`,
      dependencies,
      optional: false,
      dev: false,
      bin: {},
    };
  }
  return out;
}

function resolution(spec: Spec, root: Record<string, string> = {}): Resolution {
  return { root: { dependencies: root }, packages: build(spec), warnings: [] };
}

/** The 22-char digest at the end of a store key. */
function digest(key: string): string {
  return key.slice(-22);
}

function shuffle<T>(list: T[], seed: number): T[] {
  const out = [...list];
  let state = seed;
  for (let i = out.length - 1; i > 0; i--) {
    state = (state * 1_103_515_245 + 12_345) % 2_147_483_648;
    const j = state % (i + 1);
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

/** Same logical graph, different object insertion order everywhere. */
function reorder(
  packages: Record<string, ResolvedPackage>,
  seed: number,
): Record<string, ResolvedPackage> {
  const out: Record<string, ResolvedPackage> = {};
  for (const [key, found] of shuffle(Object.entries(packages), seed)) {
    out[key] = {
      ...found,
      dependencies: Object.fromEntries(shuffle(Object.entries(found.dependencies), seed + 1)),
    };
  }
  return out;
}

describe("shape", () => {
  it("is empty for an empty graph", async () => {
    expect(await storeKeys({})).toEqual({});
  });

  it("keys a single package with no deps", async () => {
    const packages = build({ "a@1.0.0": [] });
    const key = await storeKey(packages, "a@1.0.0");
    expect(key).toMatch(/^a@1\.0\.0-[\w-]{22}$/);
    expect(await storeKeys(packages)).toEqual({ "a@1.0.0": key });
  });

  it("throws ENOKEY for a package that is not in the resolution", async () => {
    await expect(storeKey(build({}), "ghost@1.0.0")).rejects.toThrow(
      expect.objectContaining({ code: "ENOKEY" }),
    );
  });

  it("produces a filesystem-safe segment: no / + or = in the digest", async () => {
    const packages = build({ "a@1.0.0": [], "b@2.0.0-beta.1": [] });
    for (const key of Object.values(await storeKeys(packages))) {
      expect(digest(key)).toMatch(/^[A-Za-z0-9_-]{22}$/);
    }
  });

  it("escapes a scoped name to one path segment", async () => {
    const packages = build({ "@scope/pkg@1.2.3": ["a@1.0.0"], "a@1.0.0": [] });
    const key = (await storeKeys(packages))["@scope/pkg@1.2.3"]!;
    expect(key).toMatch(/^@scope\+pkg@1\.2\.3-[\w-]{22}$/);
    expect(key).not.toContain("/");
  });

  it("does not confuse an escaped scoped name with a flat one", async () => {
    const scoped = await storeKey(build({ "@scope/pkg@1.0.0": [] }), "@scope/pkg@1.0.0");
    const flat = await storeKey(build({ "@scope+pkg@1.0.0": [] }), "@scope+pkg@1.0.0");
    expect(scoped.slice(0, -22)).toBe(flat.slice(0, -22));
    expect(digest(scoped)).not.toBe(digest(flat)); // the hash sees the real name
  });
});

describe("closure", () => {
  it("hashes the transitive closure, not just direct deps", async () => {
    const shallow = build({ "a@1.0.0": ["b@1.0.0"], "b@1.0.0": [] });
    const deep = build({ "a@1.0.0": ["b@1.0.0"], "b@1.0.0": ["c@1.0.0"], "c@1.0.0": [] });
    expect(await storeKey(shallow, "a@1.0.0")).not.toBe(await storeKey(deep, "a@1.0.0"));
  });

  it("handles a diamond and agrees between storeKey and storeKeys", async () => {
    const packages = build({
      "a@1.0.0": ["b@1.0.0", "c@1.0.0"],
      "b@1.0.0": ["d@1.0.0"],
      "c@1.0.0": ["d@1.0.0"],
      "d@1.0.0": [],
    });
    const all = await storeKeys(packages);
    for (const id of Object.keys(packages)) expect(all[id]).toBe(await storeKey(packages, id));
    expect(all["b@1.0.0"]).not.toBe(all["c@1.0.0"]); // same closure, different identity
    expect(digest(all["b@1.0.0"]!)).not.toBe(digest(all["c@1.0.0"]!));
  });

  it("a deep change moves every ancestor and leaves an unrelated sibling alone", async () => {
    const spec: Spec = {
      "root-a@1.0.0": ["mid@1.0.0"],
      "mid@1.0.0": ["deep@1.0.0"],
      "deep@1.0.0": [],
      "sibling@1.0.0": ["other@1.0.0"],
      "other@1.0.0": [],
    };
    const before = await storeKeys(build(spec));
    const after = await storeKeys(build(spec, { "deep@1.0.0": "sha512-republished" }));
    expect(after["root-a@1.0.0"]).not.toBe(before["root-a@1.0.0"]);
    expect(after["mid@1.0.0"]).not.toBe(before["mid@1.0.0"]);
    expect(after["deep@1.0.0"]).not.toBe(before["deep@1.0.0"]);
    expect(after["sibling@1.0.0"]).toBe(before["sibling@1.0.0"]);
    expect(after["other@1.0.0"]).toBe(before["other@1.0.0"]);
  });

  it("ignores edges to packages the resolver dropped", async () => {
    const packages = build({ "a@1.0.0": [] });
    packages["a@1.0.0"]!.dependencies = {}; // an absent optional leaves no edge behind
    await expect(storeKeys(packages)).resolves.toBeDefined();
  });
});

describe("discrimination", () => {
  it("separates the same name@version with different resolved deps", async () => {
    const withOne = build({ "x@1.0.0": ["d@1.0.0"], "d@1.0.0": [] });
    const withTwo = build({ "x@1.0.0": ["d@2.0.0"], "d@2.0.0": [] });
    expect(await storeKey(withOne, "x@1.0.0")).not.toBe(await storeKey(withTwo, "x@1.0.0"));
    expect((await storeKey(withOne, "x@1.0.0")).startsWith("x@1.0.0-")).toBe(true);
  });

  it("separates two entries of one name@version inside a single record", async () => {
    // The resolver cannot make this shape yet; peer duplication or overrides will.
    const packages = build({ "d@1.0.0": [], "d@2.0.0": [] });
    packages["x@1.0.0"] = build({ "x@1.0.0": ["d@1.0.0"] })["x@1.0.0"]!;
    packages["x@1.0.0::peer"] = build({ "x@1.0.0": ["d@2.0.0"] })["x@1.0.0"]!;
    const all = await storeKeys(packages);
    expect(all["x@1.0.0"]).not.toBe(all["x@1.0.0::peer"]);
    expect(all["x@1.0.0"]!.slice(0, -22)).toBe(all["x@1.0.0::peer"]!.slice(0, -22));
  });
});

describe("agreement", () => {
  /** Seeded random graph, dense enough that cycles are the norm and not the exception. */
  function random(count: number, seed: number): Record<string, ResolvedPackage> {
    let state = seed;
    const next = () => {
      state ^= state << 13;
      state ^= state >>> 17;
      state ^= state << 5;
      return state >>> 0;
    };
    const spec: Spec = {};
    for (let i = 0; i < count; i++) {
      const deps = new Set<string>();
      for (let k = next() % 4; k > 0; k--) deps.add(`p${next() % count}@1.0.0`);
      spec[`p${i}@1.0.0`] = [...deps];
    }
    return build(spec);
  }

  it("storeKey matches storeKeys on every node of every graph", async () => {
    for (const seed of [1, 17, 404, 90_210]) {
      const packages = random(120, seed);
      const all = await storeKeys(packages);
      for (const id of Object.keys(packages)) expect(await storeKey(packages, id)).toBe(all[id]);
    }
  });

  it("agrees on a chain, a cycle and a self loop", async () => {
    const chain = build({ "a@1.0.0": ["b@1.0.0"], "b@1.0.0": ["c@1.0.0"], "c@1.0.0": [] });
    const loop = build({ "a@1.0.0": ["a@1.0.0", "b@1.0.0"], "b@1.0.0": ["a@1.0.0"] });
    for (const packages of [chain, loop]) {
      const all = await storeKeys(packages);
      for (const id of Object.keys(packages)) expect(await storeKey(packages, id)).toBe(all[id]);
    }
  });
});

describe("determinism", () => {
  const spec: Spec = {
    "a@1.0.0": ["b@1.0.0", "c@1.0.0", "@scope/d@1.0.0"],
    "b@1.0.0": ["c@1.0.0", "e@1.0.0"],
    "c@1.0.0": ["@scope/d@1.0.0"],
    "@scope/d@1.0.0": ["e@1.0.0"],
    "e@1.0.0": [],
  };

  it("is stable across insertion orders", async () => {
    const base = await storeKeys(build(spec));
    for (const seed of [1, 2, 3, 99]) {
      expect(await storeKeys(reorder(build(spec), seed))).toEqual(base);
    }
  });

  it("does not depend on which node the walk starts from", async () => {
    const packages = build(spec);
    const all = await storeKeys(packages);
    for (const id of shuffle(Object.keys(packages), 7)) {
      expect(await storeKey(packages, id)).toBe(all[id]);
    }
  });

  it("gives the same graphHash regardless of order", async () => {
    const base = await graphHash(resolution(spec, { a: "1.0.0" }));
    const mixed: Resolution = {
      root: { dependencies: { a: "1.0.0" } },
      packages: reorder(build(spec), 42),
      warnings: ["noise"],
    };
    expect(await graphHash(mixed)).toBe(base);
  });
});

describe("cycles", () => {
  // A hang is a failure, so each of these is time-boxed.
  const limit = { timeout: 2000 };

  it("terminates on a self cycle", limit, async () => {
    const packages = build({ "a@1.0.0": ["a@1.0.0"] });
    expect(await storeKey(packages, "a@1.0.0")).toMatch(/^a@1\.0\.0-[\w-]{22}$/);
    expect((await storeKeys(packages))["a@1.0.0"]).toBe(await storeKey(packages, "a@1.0.0"));
  });

  it("terminates on a two-node cycle", limit, async () => {
    const packages = build({ "a@1.0.0": ["b@1.0.0"], "b@1.0.0": ["a@1.0.0"] });
    const all = await storeKeys(packages);
    expect(Object.keys(all)).toHaveLength(2);
    for (const id of Object.keys(packages)) expect(all[id]).toBe(await storeKey(packages, id));
    // Both see the same closure, so only their identity differs.
    expect(digest(all["a@1.0.0"]!)).toBe(digest(all["b@1.0.0"]!));
  });

  it("terminates on a three-node cycle", limit, async () => {
    const packages = build({
      "a@1.0.0": ["b@1.0.0"],
      "b@1.0.0": ["c@1.0.0"],
      "c@1.0.0": ["a@1.0.0"],
    });
    const all = await storeKeys(packages);
    for (const id of Object.keys(packages)) expect(all[id]).toBe(await storeKey(packages, id));
    expect(digest(all["a@1.0.0"]!)).toBe(digest(all["c@1.0.0"]!));
  });

  it("terminates on a cycle reached from two different roots", limit, async () => {
    const packages = build({
      "r1@1.0.0": ["a@1.0.0"],
      "r2@1.0.0": ["b@1.0.0"],
      "a@1.0.0": ["b@1.0.0"],
      "b@1.0.0": ["a@1.0.0"],
    });
    const all = await storeKeys(packages);
    for (const id of Object.keys(packages)) expect(all[id]).toBe(await storeKey(packages, id));
    // Each root sees itself plus the whole cycle, so the two differ only by their own line.
    expect(digest(all["r1@1.0.0"]!)).not.toBe(digest(all["r2@1.0.0"]!));
    expect(digest(all["a@1.0.0"]!)).toBe(digest(all["b@1.0.0"]!));
  });

  it("terminates on a cycle entered mid-chain", limit, async () => {
    const packages = build({
      "top@1.0.0": ["a@1.0.0"],
      "a@1.0.0": ["b@1.0.0"],
      "b@1.0.0": ["c@1.0.0"],
      "c@1.0.0": ["b@1.0.0", "d@1.0.0"],
      "d@1.0.0": [],
    });
    const all = await storeKeys(packages);
    for (const id of Object.keys(packages)) expect(all[id]).toBe(await storeKey(packages, id));
    expect(digest(all["b@1.0.0"]!)).toBe(digest(all["c@1.0.0"]!));
  });

  it("walks a 20k-deep chain without blowing the stack", limit, async () => {
    const depth = 20_000;
    const spec: Spec = {};
    for (let i = 0; i < depth; i++) spec[`p${i}@1.0.0`] = i < depth - 1 ? [`p${i + 1}@1.0.0`] : [];
    // One closure spanning every node: proves `reach` is iterative.
    expect(await storeKey(build(spec), "p0@1.0.0")).toMatch(/^p0@1\.0\.0-[\w-]{22}$/);
  });

  it("runs Tarjan iteratively on a 20k-deep cycle", limit, async () => {
    const depth = 20_000;
    const spec: Spec = {};
    for (let i = 0; i < depth; i++) spec[`p${i}@1.0.0`] = [`p${(i + 1) % depth}@1.0.0`];
    // One giant strongly connected component, so every node shares a single closure.
    const all = await storeKeys(build(spec));
    expect(Object.keys(all)).toHaveLength(depth);
    expect(digest(all["p0@1.0.0"]!)).toBe(digest(all["p1@1.0.0"]!));
  });
});

describe("graphHash", () => {
  const spec: Spec = { "a@1.0.0": ["b@1.0.0"], "b@1.0.0": [], "c@1.0.0": [] };

  it("changes when a direct dependency is added or removed", async () => {
    const one = await graphHash(resolution(spec, { a: "1.0.0" }));
    const two = await graphHash(resolution(spec, { a: "1.0.0", c: "1.0.0" }));
    expect(one).not.toBe(two);
    expect(await graphHash(resolution(spec, {}))).not.toBe(one);
  });

  it("changes when any package in the graph changes", async () => {
    const before = await graphHash(resolution(spec, { a: "1.0.0" }));
    const moved = resolution(spec, { a: "1.0.0" });
    moved.packages["b@1.0.0"]!.integrity = "sha512-republished";
    expect(await graphHash(moved)).not.toBe(before);
  });

  it("ignores which registry served the same bytes", async () => {
    // The lockfile stores the url only when it is not derivable, so a mirror must not give
    // one project a second store entry for a tarball it already has.
    const before = await graphHash(resolution(spec, { a: "1.0.0" }));
    const mirrored = resolution(spec, { a: "1.0.0" });
    for (const pkg of Object.values(mirrored.packages)) {
      pkg.resolved = pkg.resolved.replace("registry.test", "mirror.internal");
    }
    expect(await graphHash(mirrored)).toBe(before);
    expect(await storeKeys(mirrored.packages)).toEqual(
      await storeKeys(resolution(spec, {}).packages),
    );
  });

  it("ignores the root's own name and version", async () => {
    const base = resolution(spec, { a: "1.0.0" });
    const named: Resolution = { ...base, root: { ...base.root, name: "app", version: "9.9.9" } };
    expect(await graphHash(named)).toBe(await graphHash(base));
  });

  it("is a filesystem-safe digest too", async () => {
    expect(await graphHash(resolution(spec, { a: "1.0.0" }))).toMatch(/^[A-Za-z0-9_-]{22}$/);
  });
});

describe("workspaces", () => {
  /** A workspace at `path`, depending on `deps` the way the resolver writes the edges. */
  function local(name: string, path: string, deps: Record<string, string> = {}): ResolvedPackage {
    return {
      name,
      version: "1.0.0",
      resolved: "",
      integrity: "",
      local: path,
      dependencies: deps,
      optional: false,
      dev: false,
      bin: {},
    };
  }

  function monorepo(aDeps: Record<string, string>): Resolution {
    return {
      root: { dependencies: { a: "link:packages/a" } },
      packages: {
        ...build({ "x@1.0.0": ["y@1.0.0"], "y@1.0.0": [] }),
        "a@link:packages/a": local("a", "packages/a", aDeps),
        "b@link:packages/b": local("b", "packages/b"),
      },
      warnings: [],
    };
  }

  it("gives a workspace no store key", async () => {
    const { packages } = monorepo({ x: "1.0.0", b: "link:packages/b" });
    expect(Object.keys(await storeKeys(packages)).sort()).toEqual(["x@1.0.0", "y@1.0.0"]);
    await expect(storeKey(packages, "a@link:packages/a")).rejects.toThrow(
      expect.objectContaining({ code: "ENOKEY" }),
    );
  });

  it("keeps a registry package's key when a workspace's own deps change", async () => {
    const one = monorepo({ x: "1.0.0", b: "link:packages/b" }).packages;
    const two = monorepo({ x: "1.0.0" }).packages;
    expect(await storeKeys(one)).toEqual(await storeKeys(two));
    expect(await storeKey(one, "x@1.0.0")).toBe(
      await storeKey(build({ "x@1.0.0": ["y@1.0.0"], "y@1.0.0": [] }), "x@1.0.0"),
    );
  });

  it("moves graphHash when a workspace's own deps change, or a workspace moves", async () => {
    const base = await graphHash(monorepo({ x: "1.0.0", b: "link:packages/b" }));
    expect(await graphHash(monorepo({ x: "1.0.0" }))).not.toBe(base);
    expect(await graphHash(monorepo({ x: "1.0.0", b: "link:packages/b" }))).toBe(base);

    const moved = monorepo({ x: "1.0.0", b: "link:packages/b" });
    moved.packages["b@link:packages/b"]!.local = "libs/b";
    expect(await graphHash(moved)).not.toBe(base);
  });
});

describe("performance", () => {
  /** A layered DAG, fanout 3 into the next layer: the shape a real dependency tree has. */
  function layered(count: number, width = 20): Record<string, ResolvedPackage> {
    const spec: Spec = {};
    for (let i = 0; i < count; i++) {
      const deps: string[] = [];
      const base = (Math.floor(i / width) + 1) * width;
      for (let k = 0; k < 3; k++) {
        const child = base + ((i + 7 * k) % width);
        if (child < count) deps.push(`p${child}@1.0.0`);
      }
      spec[`p${i}@1.0.0`] = deps;
    }
    return build(spec);
  }

  function chain(count: number): Record<string, ResolvedPackage> {
    const spec: Spec = {};
    for (let i = 0; i < count; i++) spec[`p${i}@1.0.0`] = i < count - 1 ? [`p${i + 1}@1.0.0`] : [];
    return build(spec);
  }

  async function timed(
    packages: Record<string, ResolvedPackage>,
  ): Promise<{ ms: number; keys: string[] }> {
    const started = performance.now();
    const all = await storeKeys(packages);
    return { ms: performance.now() - started, keys: Object.values(all) };
  }

  // Bound: ~1s, against 30-60ms measured. Wide enough to survive a loaded machine, tight enough
  // that the quadratic version it replaced (seconds at this size) cannot pass it.
  const budget = 1000;

  it("keys 5000 layered packages fast", { timeout: 30_000 }, async () => {
    const { ms, keys } = await timed(layered(5000));
    expect(keys).toHaveLength(5000);
    expect(new Set(keys).size).toBe(5000);
    expect(ms).toBeLessThan(budget);
  });

  it("keys a 5000-deep chain fast", { timeout: 30_000 }, async () => {
    const { ms, keys } = await timed(chain(5000));
    expect(keys).toHaveLength(5000);
    expect(new Set(keys).size).toBe(5000);
    expect(ms).toBeLessThan(budget);
  });

  it("keys a 20k-deep chain without hoarding memory", { timeout: 30_000 }, async () => {
    const packages = chain(20_000);
    const before = process.memoryUsage().rss;
    const all = await storeKeys(packages);
    const grewMb = (process.memoryUsage().rss - before) / 1024 / 1024;
    expect(Object.keys(all)).toHaveLength(20_000);
    // ~26MB measured, and the graph itself is already allocated before the baseline is taken.
    // The closure-per-node version needed gigabytes for this one.
    expect(grewMb).toBeLessThan(400);
  });
});

describe("keyOf", () => {
  it("keys a workspace by its path, and a package by its version", () => {
    const pkg = {
      name: "a",
      version: "1.0.0",
      resolved: "",
      integrity: "",
      dependencies: {},
      optional: false,
      dev: false,
      bin: {},
    };
    expect(keyOf({ ...pkg, local: "packages/a" })).toBe("a@link:packages/a");
    expect(keyOf(pkg)).toBe("a@1.0.0");
  });
});
