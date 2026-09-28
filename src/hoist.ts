import { UpmError } from "./error.ts";
import { satisfies } from "./semver.ts";
import { lookup, npmPlacement } from "./package-lock.ts";
import type { Placement } from "./package-lock.ts";
import type { Resolution, ResolvedPackage } from "./resolve.ts";

const parentOf = (path: string): string => {
  const at = path.lastIndexOf("/node_modules/");
  return at < 0 ? "" : path.slice(0, at);
};
const nameOf = (key: string, pkg: ResolvedPackage) => pkg.name;
const keyFor = (name: string, version: string): string => `${name}@${version}`;

function reachableKeys(resolution: Resolution): Set<string> {
  const seen = new Set<string>();
  const pending = Object.entries(resolution.root.dependencies).map(([name, version]) =>
    keyFor(name, version),
  );
  while (pending.length) {
    const key = pending.pop()!;
    if (seen.has(key)) continue;
    const pkg = resolution.packages[key];
    if (!pkg) throw new UpmError("EPLACE", `missing ${key}`);
    seen.add(key);
    for (const [name, version] of Object.entries({
      ...pkg.dependencies,
      ...pkg.optionalDependencies,
    }))
      pending.push(keyFor(name, version));
  }
  return seen;
}

function lookupPath(placement: Placement, from: string, name: string): string | undefined {
  for (let dir = from; ; dir = parentOf(dir)) {
    const path = `${dir ? `${dir}/` : ""}node_modules/${name}`;
    if (placement.has(path)) return path;
    if (!dir) return undefined;
  }
}

function reachablePaths(resolution: Resolution, placement: Placement): Set<string> {
  const seen = new Set<string>();
  const pending = Object.entries(resolution.root.dependencies).map(
    ([name]) => `node_modules/${name}`,
  );
  while (pending.length) {
    const path = pending.pop()!;
    if (seen.has(path)) continue;
    const key = placement.get(path);
    const pkg = key && resolution.packages[key];
    if (!pkg) continue;
    seen.add(path);
    for (const [name, version] of Object.entries({
      ...pkg.dependencies,
      ...pkg.optionalDependencies,
    })) {
      const target = lookupPath(placement, name in (pkg.peers ?? {}) ? parentOf(path) : path, name);
      if (target && placement.get(target) === keyFor(name, version)) pending.push(target);
    }
  }
  return seen;
}

/** Check every resolved edge with Node's upward lookup, including peer position. */
export function checkPlacement(resolution: Resolution, placement: Placement): void {
  const needed = reachableKeys(resolution);
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
    if (!needed.has(key)) throw new UpmError("EPLACE", `${path} is unreachable`);
    const pkg = resolution.packages[key];
    if (!pkg) throw new UpmError("EPLACE", `${path} refers to absent ${key}`);
    if (nameOf(key, pkg) !== path.slice(path.lastIndexOf("node_modules/") + 13))
      throw new UpmError("EPLACE", `${path} has wrong package name for ${key}`);
    for (const [name, version] of Object.entries({
      ...pkg.dependencies,
      ...pkg.optionalDependencies,
    }))
      edge(path, name, version, name in (pkg.peers ?? {}));
    for (const [name, range] of Object.entries(pkg.peerDependencies ?? {})) {
      if (name in pkg.dependencies && !(name in (pkg.peers ?? {}))) continue;
      const found = lookup(placement, parentOf(path), name);
      if (found && !satisfies(resolution.packages[found]?.version ?? "", range))
        throw new UpmError("EPLACE", `${path} peer ${name}@${range} resolves to ${found}`);
    }
  }
  const placedKeys = new Set(placement.values());
  for (const key of needed)
    if (!placedKeys.has(key)) throw new UpmError("EPLACE", `${key} has no placement`);
}

/** Place root edges first, then each installed node's edges, preferring shared ancestors. */
export function hoist(resolution: Resolution, previous?: Placement): Placement {
  const original = previous ?? npmPlacement(resolution);
  if (original) {
    try {
      checkPlacement(resolution, original);
      // A valid npm lock already records the exact locations to keep.
      return new Map(original);
    } catch {
      // Keep valid locations below while repairing a changed graph.
    }
  }
  const needed = reachableKeys(resolution);
  const placed: Placement = new Map(
    [...(original ?? [])].filter(
      ([path, key]) =>
        needed.has(key) &&
        resolution.packages[key]?.name === path.slice(path.lastIndexOf("node_modules/") + 13),
    ),
  );
  const roots: string[] = [];
  const edges: { from: string; name: string; key: string; peer: boolean }[] = [];
  const direct = Object.entries(resolution.root.dependencies);
  for (const [name, version] of direct) {
    const key = keyFor(name, version);
    if (!resolution.packages[key]) throw new UpmError("EPLACE", `missing ${key}`);
    const path = `node_modules/${name}`;
    placed.set(path, key);
    roots.push(path);
    edges.push({ from: "", name, key, peer: false });
  }
  for (const [path, key] of placed) {
    if (roots.includes(path)) continue;
    const pkg = resolution.packages[key]!;
    const brokenPeer =
      Object.keys(pkg.peers ?? {}).some((name) => {
        const version = pkg.dependencies[name] ?? pkg.optionalDependencies?.[name];
        return version && lookup(placed, parentOf(path), name) !== keyFor(name, version);
      }) ||
      Object.entries(pkg.peerDependencies ?? {}).some(([name, range]) => {
        if (name in pkg.dependencies && !(name in (pkg.peers ?? {}))) return false;
        const found = lookup(placed, parentOf(path), name);
        return !!found && !satisfies(resolution.packages[found]?.version ?? "", range);
      });
    if (brokenPeer) placed.delete(path);
  }
  for (const path of reachablePaths(resolution, placed)) {
    const pkg = resolution.packages[placed.get(path)!]!;
    for (const [name, version] of Object.entries({
      ...pkg.dependencies,
      ...pkg.optionalDependencies,
    })) {
      const peer = name in (pkg.peers ?? {});
      if (lookup(placed, peer ? parentOf(path) : path, name) === keyFor(name, version))
        edges.push({ from: path, name, key: keyFor(name, version), peer });
    }
  }
  const visited = new Set<string>();
  const visit = (from: string): void => {
    const pkg = resolution.packages[placed.get(from)!]!;
    if (visited.has(from)) return;
    visited.add(from);
    const children: string[] = [];
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
        const path = lookupPath(placed, context, name);
        if (path) children.push(path);
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
        const candidate = resolution.packages[key]!;
        const peersFit = Object.entries(candidate.peerDependencies ?? {}).every(
          ([peerName, range]) => {
            if (peerName in candidate.dependencies && !(peerName in (candidate.peers ?? {})))
              return true;
            const found = placed.get(`${dir ? `${dir}/` : ""}node_modules/${peerName}`);
            return !found || satisfies(resolution.packages[found]?.version ?? "", range);
          },
        );
        const valid =
          peersFit &&
          edges.every((e) => lookup(placed, e.peer ? parentOf(e.from) : e.from, e.name) === e.key);
        placed.delete(path);
        if (valid) {
          chosen = path;
          break;
        }
      }
      if (!chosen) throw new UpmError("EPLACE", `cannot place ${key} for ${from}`, { from, key });
      placed.set(chosen, key);
      edges.push({ from, name, key, peer });
      children.push(chosen);
    }
    for (const child of children) visit(child);
  };
  for (const path of roots) visit(path);
  const used = reachablePaths(resolution, placed);
  for (const path of placed.keys()) if (!used.has(path)) placed.delete(path);
  checkPlacement(resolution, placed);
  return placed;
}
