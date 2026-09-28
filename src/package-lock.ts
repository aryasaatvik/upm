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
  engines?: Record<string, string> | string[];
  os?: string[] | string;
  cpu?: string[] | string;
  libc?: string[] | string;
  license?: string | { type: string };
  funding?: string | Record<string, unknown>;
  hasInstallScript?: boolean;
  deprecated?: string;
  bundleDependencies?: string[];
  acceptDependencies?: Record<string, string>;
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
const platformList = (value: string[] | string): string[] =>
  typeof value === "string" ? [value] : value;
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

/** Only registry tarballs can be installed from the portable npm lock API. */
export function supportedResolved(key: string, resolved: string, registries: string[]): string {
  let kind = /^(?:git(?:\+[^:]+)?:|github:)/i.test(resolved)
    ? "git"
    : /^file:/i.test(resolved)
      ? "file"
      : "tarball";
  const refusal = (message: string): never => {
    throw new UpmError("ELOCK", `${message} for ${key}`, { key, resolved, kind });
  };
  if (kind === "git") refusal("git dependencies are not supported");
  if (kind === "file") refusal("local file dependencies are not supported");
  let url: URL;
  try {
    url = new URL(resolved);
  } catch {
    return refusal("invalid tarball URL");
  }
  const allowed = registries.some((base) => {
    const registry = new URL(base);
    const prefix = registry.pathname.endsWith("/") ? registry.pathname : `${registry.pathname}/`;
    return (
      (url.protocol === "https:" || (url.protocol === "http:" && registry.protocol === "http:")) &&
      url.origin === registry.origin &&
      url.pathname.startsWith(prefix)
    );
  });
  if (!allowed) {
    if (url.origin === "https://registry.npmjs.org") kind = "registry";
    refusal("tarball outside allowed registries");
  }
  return url.href;
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
        if (name in (entry.optionalDependencies ?? {}))
          throw new UpmError(
            "ELOCK",
            `missing optional dependency ${name} from ${from || "root"}; npm ci would reject the lock`,
          );
        if (peers[name] === "optional") continue;
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
      ...(entry.os && { os: platformList(entry.os) }),
      ...(entry.cpu && { cpu: platformList(entry.cpu) }),
      ...(entry.libc && { libc: platformList(entry.libc) }),
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

/** Carry npm's static path metadata, leaving topology flags to the new resolution. */
export function carryPackageLockEntries(from: Resolution, to: Resolution): void {
  const entries = metadata.get(from);
  if (!entries) return;
  metadata.set(
    to,
    new Map(
      [...entries].map(([path, entry]) => {
        const staticEntry = { ...entry };
        delete staticEntry.dev;
        delete staticEntry.optional;
        delete staticEntry.devOptional;
        delete staticEntry.peer;
        return [path, staticEntry];
      }),
    ),
  );
}

/** Original locations are the best stable choice when an npm lock supplied this graph. */
export function npmPlacement(resolution: Resolution): Placement | undefined {
  const entries = metadata.get(resolution);
  if (!entries) return undefined;
  return new Map([...entries].map(([path, entry]) => [path, `${pathName(path)}@${entry.version}`]));
}

type DependencyFlags = Required<
  Pick<PackageLockEntry, "dev" | "optional" | "devOptional" | "peer">
>;

/** npm marks a placement by every root-to-package route, including peer and optional edges. */
function dependencyFlags(
  resolution: Resolution,
  placement: Placement,
  manifest: PackageJson,
): Map<string, Partial<DependencyFlags>> {
  const full = (): DependencyFlags => ({
    dev: true,
    optional: true,
    devOptional: true,
    peer: true,
  });
  const flags = new Map([...placement.keys()].map((path) => [path, full()]));
  const root: DependencyFlags = { dev: false, optional: false, devOptional: false, peer: false };
  const location = (from: string, name: string, peer: boolean): string | undefined => {
    const parent = from.lastIndexOf("/node_modules/");
    const start = peer ? (parent >= 0 ? from.slice(0, parent) : "") : from;
    for (let dir = start; ;) {
      const path = `${dir ? `${dir}/` : ""}node_modules/${name}`;
      if (placement.has(path)) return path;
      if (!dir) return undefined;
      const at = dir.lastIndexOf("/node_modules/");
      dir = at < 0 ? "" : dir.slice(0, at);
    }
  };
  const queue = [""];
  while (queue.length > 0) {
    const from = queue.pop()!;
    const current = from ? flags.get(from)! : root;
    const pkg = from ? resolution.packages[placement.get(from)!] : undefined;
    const edges = from
      ? { ...pkg?.dependencies, ...pkg?.optionalDependencies }
      : resolution.root.dependencies;
    for (const [name, version] of Object.entries(edges)) {
      const rootDev = name in (manifest.devDependencies ?? {});
      const rootOptional = !rootDev && name in (manifest.optionalDependencies ?? {});
      const rootPeer =
        !rootDev &&
        !rootOptional &&
        !(name in (manifest.dependencies ?? {})) &&
        name in (manifest.peerDependencies ?? {});
      const peer = from ? name in (pkg?.peers ?? {}) : rootPeer;
      const dev = !from && rootDev;
      const optional = from
        ? name in (pkg?.optionalDependencies ?? {})
        : rootOptional || (rootPeer && manifest.peerDependenciesMeta?.[name]?.optional === true);
      const path = location(from, name, peer);
      if (!path || placement.get(path) !== `${name}@${version}`) continue;
      const target = flags.get(path)!;
      let changed = false;
      if (target.dev && !current.dev && !dev) {
        target.dev = false;
        changed = true;
      }
      if (target.optional && !current.optional && !optional) {
        target.optional = false;
        changed = true;
      }
      if (
        target.devOptional &&
        !current.devOptional &&
        !current.dev &&
        !current.optional &&
        !dev &&
        !optional
      ) {
        target.devOptional = false;
        changed = true;
      }
      if (target.peer && !current.peer && !peer) {
        target.peer = false;
        changed = true;
      }
      if (changed) queue.push(path);
    }
  }
  return new Map(
    [...flags].map(([path, flag]) => {
      if (flag.dev || flag.optional) flag.devOptional = false;
      return [
        path,
        {
          ...(flag.dev && { dev: true }),
          ...(flag.optional && { optional: true }),
          ...(flag.devOptional && { devOptional: true }),
          ...(flag.peer && { peer: true }),
        },
      ];
    }),
  );
}

export function toPackageLock(
  resolution: Resolution,
  placement: Placement,
  manifest: PackageJson,
): PackageLock {
  const source = metadata.get(resolution);
  const flags = dependencyFlags(resolution, placement, manifest);
  const packages: Record<string, PackageLockEntry> = {};
  const bin = normalizeBin(manifest);
  const license =
    manifest.license && typeof manifest.license === "object"
      ? manifest.license.type
      : manifest.license;
  const present = (value: unknown): boolean =>
    !!value && (typeof value !== "object" || Object.keys(value).length > 0);
  packages[""] = {
    ...(manifest.name && { name: manifest.name }),
    ...(manifest.version && { version: manifest.version }),
    ...Object.fromEntries(groups.filter((g) => present(manifest[g])).map((g) => [g, manifest[g]])),
    ...(present(manifest.peerDependencies) && { peerDependencies: manifest.peerDependencies }),
    ...(present(manifest.peerDependenciesMeta) && {
      peerDependenciesMeta: manifest.peerDependenciesMeta,
    }),
    ...(present(manifest.bundleDependencies) && {
      bundleDependencies: manifest.bundleDependencies,
    }),
    ...(present(manifest.acceptDependencies) && {
      acceptDependencies: manifest.acceptDependencies,
    }),
    ...(present(manifest.funding) && { funding: manifest.funding }),
    ...(present(manifest.engines) && { engines: manifest.engines }),
    ...(present(manifest.os) && { os: manifest.os }),
    ...(present(manifest.cpu) && { cpu: manifest.cpu }),
    ...(present(manifest.libc) && { libc: manifest.libc }),
    ...(manifest.hasInstallScript ||
    manifest.scripts?.preinstall ||
    manifest.scripts?.install ||
    manifest.scripts?.postinstall
      ? { hasInstallScript: true }
      : {}),
    ...(license && { license }),
    ...(Object.keys(bin).length && { bin }),
    ...(manifest.deprecated && { deprecated: manifest.deprecated }),
  };
  for (const group of [...groups, "peerDependencies", "peerDependenciesMeta"] as const)
    if (!manifest[group]) delete packages[""][group];
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
      const staticEntry = { ...original };
      delete staticEntry.dev;
      delete staticEntry.optional;
      delete staticEntry.devOptional;
      delete staticEntry.peer;
      packages[path] = { ...staticEntry, ...flags.get(path) };
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
      ...flags.get(path),
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
