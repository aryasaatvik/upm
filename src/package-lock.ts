import { UpmError } from "./error.ts";
import { normalizeBin } from "./normalize-bin.ts";
import { declaredSpecs, packageMetadata, setPackageMetadata } from "./resolve.ts";
import type { Resolution, ResolvedPackage, RootManifest, RootSpecs } from "./resolve.ts";

export interface PackageLockEntry {
  name?: string;
  version?: string;
  resolved?: string;
  integrity?: string;
  dev?: boolean;
  optional?: boolean;
  devOptional?: boolean;
  peer?: boolean;
  dependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  peerDependenciesMeta?: Record<string, { optional?: boolean }>;
  bin?: string | Record<string, string>;
  engines?: Record<string, string>;
  os?: string[];
  cpu?: string[];
  libc?: string[];
  license?: string | { type: string };
  funding?: string | Record<string, unknown>;
  hasInstallScript?: boolean;
  deprecated?: string;
  link?: boolean;
  inBundle?: boolean;
  bundled?: boolean;
  [key: string]: unknown;
}
export interface PackageLock {
  name?: string;
  version?: string;
  lockfileVersion: 3;
  requires?: boolean;
  packages: Record<string, PackageLockEntry>;
}
export type Placement = Map<string, string>;
export type PackageJson = RootManifest;

const groups = ["dependencies", "devDependencies", "optionalDependencies"] as const;
const metadata = new WeakMap<Resolution, Map<string, PackageLockEntry>>();
const object = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const pathName = (path: string): string => path.slice(path.lastIndexOf("node_modules/") + 13);

/** A Node lookup from a package directory, including scoped package path segments. */
export function lookup(placement: Placement, from: string, name: string): string | undefined {
  for (let dir = from; ;) {
    const hit = placement.get(`${dir ? `${dir}/` : ""}node_modules/${name}`);
    if (hit) return hit;
    if (!dir) return undefined;
    const at = dir.lastIndexOf("/node_modules/");
    dir = at < 0 ? "" : dir.slice(0, at);
  }
}

export function parsePackageLock(text: string): PackageLock {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new UpmError("ELOCK", "package-lock.json is not valid JSON");
  }
  if (!object(raw) || raw.lockfileVersion !== 3 || !object(raw.packages))
    throw new UpmError("ELOCK", "package-lock.json must be a v3 lock with packages");
  if (!object(raw.packages[""])) throw new UpmError("ELOCK", "package-lock.json has no root entry");
  for (const [path, entry] of Object.entries(raw.packages)) {
    if (
      !object(entry) ||
      (path &&
        !/^(?:node_modules\/(?:@[^/]+\/)?[^/]+)(?:\/node_modules\/(?:@[^/]+\/)?[^/]+)*$/.test(path))
    )
      throw new UpmError("ELOCK", `invalid package-lock entry: ${path}`);
    if (path && typeof entry.version !== "string" && entry.link !== true)
      throw new UpmError("ELOCK", `package-lock entry has no version: ${path}`);
    for (const group of [...groups, "peerDependencies"])
      if (
        entry[group] !== undefined &&
        (!object(entry[group]) || Object.values(entry[group]).some((v) => typeof v !== "string"))
      )
        throw new UpmError("ELOCK", `invalid ${group} at ${path}`);
  }
  return raw as unknown as PackageLock;
}

export function fromPackageLock(
  lock: PackageLock,
  manifest: PackageJson,
): { resolution: Resolution; placement: Placement } {
  if (lock.lockfileVersion !== 3 || !object(lock.packages) || !object(lock.packages[""]))
    throw new UpmError("ELOCK", "package-lock.json must be a v3 lock");
  const top = lock.packages[""]!;
  if (
    manifest.workspaces ||
    Object.values(lock.packages).some((e) => e.link || e.inBundle || e.bundled)
  )
    throw new UpmError("ELOCK", "workspace, link, and bundled lock entries are unsupported");
  const sameMap = (a: Record<string, string> | undefined, b: Record<string, string> | undefined) =>
    JSON.stringify(Object.entries(a ?? {}).sort()) ===
    JSON.stringify(Object.entries(b ?? {}).sort());
  if (
    top.name !== manifest.name ||
    top.version !== manifest.version ||
    ([...groups, "peerDependencies"] as const).some((g) => !sameMap(top[g], manifest[g])) ||
    JSON.stringify(top.peerDependenciesMeta ?? {}) !==
      JSON.stringify(manifest.peerDependenciesMeta ?? {})
  )
    throw new UpmError("ELOCKSTALE", "package-lock root differs from package.json");
  const placement: Placement = new Map();
  for (const [path, entry] of Object.entries(lock.packages)) {
    if (!path) continue;
    if (!entry.version) throw new UpmError("ELOCK", `missing version at ${path}`);
    placement.set(path, `${pathName(path)}@${entry.version}`);
  }
  const resolveEdges = (from: string, entry: PackageLockEntry) => {
    const required: Record<string, string> = {};
    const optional: Record<string, string> = {};
    const peers: Record<string, "required" | "optional"> = {};
    for (const [name] of Object.entries(entry.peerDependencies ?? {})) {
      if (name in (entry.dependencies ?? {}) || name in (entry.optionalDependencies ?? {}))
        continue;
      peers[name] = entry.peerDependenciesMeta?.[name]?.optional ? "optional" : "required";
    }
    for (const [name] of Object.entries({
      ...entry.dependencies,
      ...entry.devDependencies,
      ...entry.optionalDependencies,
      ...entry.peerDependencies,
    })) {
      const target = lookup(placement, from, name);
      if (!target) {
        if (name in (entry.optionalDependencies ?? {}) || peers[name] === "optional") continue;
        throw new UpmError("ELOCK", `missing ${name} from ${from || "root"}`);
      }
      const version = target.slice(name.length + 1);
      if (!version) throw new UpmError("ELOCK", `missing version of ${name} from ${from}`);
      (name in (entry.optionalDependencies ?? {}) || peers[name] === "optional"
        ? optional
        : required)[name] = version;
    }
    return { required, optional, peers };
  };
  const packages: Record<string, ResolvedPackage> = {};
  const entries = new Map<string, PackageLockEntry>();
  const firstPath = new Map<string, string>();
  for (const [path, key] of placement) {
    const entry = lock.packages[path]!;
    const edges = resolveEdges(path, entry);
    const pkg: ResolvedPackage = {
      name: pathName(path),
      version: entry.version!,
      resolved: entry.resolved ?? "",
      integrity: entry.integrity ?? "",
      dependencies: edges.required,
      ...(Object.keys(edges.optional).length && { optionalDependencies: edges.optional }),
      optional: !!entry.optional,
      dev: !!entry.dev,
      bin: normalizeBin({ name: entry.name ?? pathName(path), bin: entry.bin }),
      ...(entry.os && { os: entry.os }),
      ...(entry.cpu && { cpu: entry.cpu }),
      ...(entry.libc && { libc: entry.libc }),
      ...(entry.peerDependencies && { peerDependencies: entry.peerDependencies }),
      ...(Object.keys(edges.peers).length && { peers: edges.peers }),
    };
    const prior = packages[key];
    if (
      prior &&
      (JSON.stringify(prior.dependencies) !== JSON.stringify(pkg.dependencies) ||
        JSON.stringify(prior.optionalDependencies ?? {}) !==
          JSON.stringify(pkg.optionalDependencies ?? {}) ||
        JSON.stringify(prior.peers ?? {}) !== JSON.stringify(pkg.peers ?? {}))
    ) {
      const context = prior.peers || pkg.peers ? "peer" : "dependency";
      throw new UpmError(
        "EPLACE",
        `${key} appears in two ${context} contexts at ${firstPath.get(key)} and ${path}`,
        { key, firstPath: firstPath.get(key), secondPath: path },
      );
    }
    packages[key] ??= pkg;
    firstPath.set(key, firstPath.get(key) ?? path);
    entries.set(path, entry);
  }
  const rootEdges = resolveEdges("", top);
  const root: Resolution["root"] = {
    name: manifest.name,
    version: manifest.version,
    ...(declaredSpecs(manifest) && { specs: declaredSpecs(manifest) as RootSpecs }),
    dependencies: { ...rootEdges.required, ...rootEdges.optional },
  };
  const resolution: Resolution = { root, packages, warnings: [] };
  metadata.set(resolution, entries);
  setPackageMetadata(
    resolution,
    new Map([...placement].map(([path, key]) => [key, lock.packages[path]!])),
  );
  return { resolution, placement };
}

/** Original locations are the best stable choice when an npm lock supplied this graph. */
export function npmPlacement(resolution: Resolution): Placement | undefined {
  const entries = metadata.get(resolution);
  if (!entries) return undefined;
  return new Map([...entries].map(([path, entry]) => [path, `${pathName(path)}@${entry.version}`]));
}

export function toPackageLock(
  resolution: Resolution,
  placement: Placement,
  manifest: PackageJson,
): PackageLock {
  const source = metadata.get(resolution);
  const packages: Record<string, PackageLockEntry> = {};
  packages[""] = {
    ...(manifest.name && { name: manifest.name }),
    ...(manifest.version && { version: manifest.version }),
    ...Object.fromEntries(groups.filter((g) => manifest[g]).map((g) => [g, manifest[g]])),
    ...(manifest.peerDependencies && { peerDependencies: manifest.peerDependencies }),
    ...(manifest.peerDependenciesMeta && { peerDependenciesMeta: manifest.peerDependenciesMeta }),
  };
  for (const [path, key] of placement) {
    const pkg = resolution.packages[key];
    if (!pkg) throw new UpmError("EPLACE", `placement refers to absent package ${key}`);
    const original = source?.get(path);
    const extra = packageMetadata(resolution, key);
    if (
      original &&
      key === `${pathName(path)}@${original.version}` &&
      (original.integrity ?? "") === pkg.integrity
    ) {
      packages[path] = original;
      continue;
    }
    const ownDependencies = { ...pkg.dependencies };
    const ownOptionalDependencies = { ...pkg.optionalDependencies };
    for (const name of Object.keys(pkg.peers ?? {})) delete ownDependencies[name];
    for (const name of Object.keys(pkg.peers ?? {})) delete ownOptionalDependencies[name];
    packages[path] = {
      ...(extra?.name && { name: extra.name }),
      version: pkg.version,
      ...(pkg.resolved && { resolved: pkg.resolved }),
      ...(pkg.integrity && { integrity: pkg.integrity }),
      ...(extra?.hasInstallScript && { hasInstallScript: true }),
      ...(pkg.dev && { dev: true }),
      ...(pkg.optional && { optional: true }),
      ...(extra?.deprecated && { deprecated: extra.deprecated }),
      ...(extra?.license && { license: extra.license }),
      ...(Object.keys(ownDependencies).length && { dependencies: ownDependencies }),
      ...(Object.keys(ownOptionalDependencies).length && {
        optionalDependencies: ownOptionalDependencies,
      }),
      ...(pkg.peerDependencies && { peerDependencies: pkg.peerDependencies }),
      ...(extra?.peerDependenciesMeta && { peerDependenciesMeta: extra.peerDependenciesMeta }),
      ...(extra?.engines && { engines: extra.engines }),
      ...(extra?.funding && { funding: extra.funding }),
      ...(Object.keys(pkg.bin).length && { bin: pkg.bin }),
      ...(pkg.os && { os: pkg.os }),
      ...(pkg.cpu && { cpu: pkg.cpu }),
      ...(pkg.libc && { libc: pkg.libc }),
    };
  }
  return {
    ...(manifest.name && { name: manifest.name }),
    ...(manifest.version && { version: manifest.version }),
    lockfileVersion: 3,
    requires: true,
    packages,
  };
}

const preferredKeys = [
  "name",
  "version",
  "lockfileVersion",
  "resolved",
  "integrity",
  "requires",
  "packages",
  "dependencies",
];
export function formatPackageLock(lock: PackageLock): string {
  const isObject = (value: unknown): value is Record<string, unknown> =>
    value !== null && typeof value === "object" && !Array.isArray(value);
  const sort = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(sort);
    if (!isObject(value)) return value;
    const keys = Object.keys(value).sort((a, b) => {
      const ao = isObject(value[a]);
      const bo = isObject(value[b]);
      if (ao !== bo) return ao ? 1 : -1;
      const ai = preferredKeys.indexOf(a);
      const bi = preferredKeys.indexOf(b);
      if (ai >= 0 && bi < 0) return -1;
      if (ai < 0 && bi >= 0) return 1;
      return ai >= 0 && bi >= 0 ? ai - bi : a.localeCompare(b, "en");
    });
    return Object.fromEntries(keys.map((key) => [key, sort(value[key])]));
  };
  return `${JSON.stringify(sort(lock), null, 2)}\n`;
}
