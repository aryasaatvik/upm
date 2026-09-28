import { UpmError } from "./error.ts";
import { readForeign } from "./foreign-lock.ts";
import { checkPlacement, hoist } from "./hoist.ts";
import { fromLockfile } from "./lock.ts";
import {
  carryPackageLockEntries,
  formatPackageLock,
  fromPackageLock,
  parsePackageLock,
  supportedResolved,
  toPackageLock,
} from "./package-lock.ts";
import type { PackageJson, PackageLockEntry } from "./package-lock.ts";
import { createRegistry } from "./registry.ts";
import type { Registry } from "./registry.ts";
import { resolveTree } from "./resolve.ts";

export interface LockInput {
  manifest: PackageJson;
  lock?: string;
  mode: "frozen" | "update";
  from?: { file: "bun.lock" | "pnpm-lock.yaml"; text: string };
  registry: string | Registry;
  fetch?: typeof fetch;
  platform?: { os: string; cpu: string; libc?: string } | "none";
  production?: boolean;
  signal?: AbortSignal;
}

const rootManifest = (entry: PackageLockEntry): PackageJson => ({
  name: entry.name,
  version: entry.version,
  dependencies: entry.dependencies,
  devDependencies: entry.devDependencies,
  optionalDependencies: entry.optionalDependencies,
  peerDependencies: entry.peerDependencies,
  peerDependenciesMeta: entry.peerDependenciesMeta,
});

export async function lockProject(
  input: LockInput,
): Promise<{ text: string; changed: boolean; warnings: string[] }> {
  const abort = () => {
    if (input.signal?.aborted) throw new UpmError("EABORT", "lock operation aborted");
  };
  abort();
  if (input.mode === "frozen") {
    if (input.lock === undefined) throw new UpmError("ENOLOCK", "package-lock.json is required");
    const { resolution, placement } = fromPackageLock(parsePackageLock(input.lock), input.manifest);
    checkPlacement(resolution, placement);
    abort();
    return { text: input.lock, changed: false, warnings: resolution.warnings };
  }

  const fetcher: typeof fetch = (request, init) =>
    (input.fetch ?? globalThis.fetch)(request, {
      ...init,
      signal: input.signal
        ? AbortSignal.any([input.signal, ...(init?.signal ? [init.signal] : [])])
        : init?.signal,
    });
  const registry =
    typeof input.registry === "string"
      ? createRegistry({ registry: input.registry, fetch: fetcher, concurrency: 6, start: 6 })
      : input.registry;
  const validateSources = (packages: Record<string, PackageLockEntry>) => {
    for (const [path, entry] of Object.entries(packages)) {
      if (!path || !entry.resolved) continue;
      const name = entry.name ?? path.slice(path.lastIndexOf("node_modules/") + 13);
      supportedResolved(path, entry.resolved, [registry.baseFor(name)]);
    }
  };
  let previous;
  let previousPlacement;
  let warnings: string[] = [];
  if (input.from) {
    try {
      const foreign = readForeign(
        input.from.file,
        input.from.text,
        input.manifest,
        registry.baseFor,
      );
      previous = fromLockfile(foreign.lock, registry.baseFor);
      warnings = foreign.warnings;
    } catch (error) {
      throw new UpmError("EFOREIGNLOCK", `${input.from.file} cannot be converted`, {
        cause: error instanceof Error ? error.message : String(error),
      });
    }
  } else if (input.lock !== undefined) {
    const lock = parsePackageLock(input.lock);
    validateSources(lock.packages);
    const old = fromPackageLock(lock, rootManifest(lock.packages[""]!));
    previous = old.resolution;
    previousPlacement = old.placement;
  }
  abort();
  try {
    const resolving = resolveTree(input.manifest, {
      registry,
      locked: previous,
      concurrency: 6,
    });
    let onAbort: (() => void) | undefined;
    const cancelled = new Promise<never>((_, reject) => {
      onAbort = () => reject(new UpmError("EABORT", "lock operation aborted"));
      input.signal?.addEventListener("abort", onAbort, { once: true });
    });
    let resolution;
    try {
      resolution = await Promise.race([resolving, cancelled]);
    } finally {
      if (onAbort) input.signal?.removeEventListener("abort", onAbort);
    }
    abort();
    const placement = hoist(resolution, previousPlacement);
    if (previous && previousPlacement) carryPackageLockEntries(previous, resolution);
    const next = toPackageLock(resolution, placement, input.manifest);
    validateSources(next.packages);
    const text = formatPackageLock(next);
    return { text, changed: text !== input.lock, warnings: [...warnings, ...resolution.warnings] };
  } catch (error) {
    if (input.signal?.aborted) throw new UpmError("EABORT", "lock operation aborted");
    const code = (error as { code?: string }).code;
    if (code === "E404" || code === "ETARGET")
      throw new UpmError("ENOTFOUND", (error as Error).message);
    if (
      ["EREGISTRY", "ETIMEDOUT", "ETIMEOUT", "ENETWORK", "EJSONPARSE", "EOFFLINE"].includes(
        code ?? "",
      )
    )
      throw new UpmError("EREGISTRY", (error as Error).message);
    throw error;
  }
}
