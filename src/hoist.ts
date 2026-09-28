import { UpmError } from "./error.ts";
import { lookup, npmPlacement } from "./package-lock.ts";
import type { Placement } from "./package-lock.ts";
import type { Resolution, ResolvedPackage } from "./resolve.ts";

const parentOf = (path: string): string => {
  const at = path.lastIndexOf("/node_modules/");
  return at < 0 ? "" : path.slice(0, at);
};
const nameOf = (key: string, pkg: ResolvedPackage) => pkg.name;
const keyFor = (name: string, version: string): string => `${name}@${version}`;

/** Check every resolved edge with Node's upward lookup, including peer position. */
export function checkPlacement(resolution: Resolution, placement: Placement): void {
  const edge = (from: string, name: string, version: string, peer = false) => {
    const expected = keyFor(name, version);
    const found = lookup(placement, peer ? parentOf(from) : from, name);
    if (found !== expected)
      throw new UpmError(
        "EPLACE",
        `${from || "root"} -> ${name}@${version} resolves to ${found ?? "nothing"}`,
        {
          from,
          name,
          expected,
          found,
        },
      );
  };
  for (const [name, version] of Object.entries(resolution.root.dependencies))
    edge("", name, version);
  for (const [path, key] of placement) {
    const pkg = resolution.packages[key];
    if (!pkg) throw new UpmError("EPLACE", `${path} refers to absent ${key}`);
    if (nameOf(key, pkg) !== path.slice(path.lastIndexOf("node_modules/") + 13))
      throw new UpmError("EPLACE", `${path} has wrong package name for ${key}`);
    for (const [name, version] of Object.entries({
      ...pkg.dependencies,
      ...pkg.optionalDependencies,
    }))
      edge(path, name, version, name in (pkg.peers ?? {}));
  }
}

/** Place root edges first, then each installed node's edges, preferring shared ancestors. */
export function hoist(resolution: Resolution, previous?: Placement): Placement {
  const original = previous ?? npmPlacement(resolution);
  if (original) {
    try {
      checkPlacement(resolution, original);
      return new Map(original);
    } catch {
      /* Rebuild moved graphs. */
    }
  }
  const placed: Placement = new Map();
  const queue: string[] = [];
  const edges: { from: string; name: string; key: string; peer: boolean }[] = [];
  const direct = Object.entries(resolution.root.dependencies);
  for (const [name, version] of direct) {
    const key = keyFor(name, version);
    if (!resolution.packages[key]) throw new UpmError("EPLACE", `missing ${key}`);
    const path = `node_modules/${name}`;
    if (placed.has(path) && placed.get(path) !== key)
      throw new UpmError("EPLACE", `conflicting root ${name}`);
    placed.set(path, key);
    queue.push(path);
    edges.push({ from: "", name, key, peer: false });
  }
  const visited = new Set<string>();
  while (queue.length) {
    const from = queue.shift()!;
    const pkg = resolution.packages[placed.get(from)!]!;
    if (visited.has(from)) continue;
    visited.add(from);
    for (const [name, version] of Object.entries({
      ...pkg.dependencies,
      ...pkg.optionalDependencies,
    })) {
      const key = keyFor(name, version);
      if (!resolution.packages[key])
        throw new UpmError("EPLACE", `missing ${key} required by ${from}`);
      const peer = name in (pkg.peers ?? {});
      const context = peer ? parentOf(from) : from;
      const already = lookup(placed, context, name);
      if (already === key) {
        edges.push({ from, name, key, peer });
        continue;
      }
      const ancestry: string[] = [];
      for (let dir = context; ; dir = parentOf(dir)) {
        ancestry.unshift(dir);
        if (!dir) break;
      }
      let chosen: string | undefined;
      for (const dir of ancestry) {
        const path = `${dir ? `${dir}/` : ""}node_modules/${name}`;
        if (placed.has(path)) continue;
        placed.set(path, key);
        const valid = edges.every(
          (e) => lookup(placed, e.peer ? parentOf(e.from) : e.from, e.name) === e.key,
        );
        placed.delete(path);
        if (valid) {
          chosen = path;
          break;
        }
      }
      if (!chosen) throw new UpmError("EPLACE", `cannot place ${key} for ${from}`, { from, key });
      placed.set(chosen, key);
      queue.push(chosen);
      edges.push({ from, name, key, peer });
    }
  }
  checkPlacement(resolution, placed);
  return placed;
}
