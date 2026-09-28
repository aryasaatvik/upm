import { UpmError } from "./error.ts";
import { checkPlacement } from "./hoist.ts";
import { createVerifier, parseIntegrity } from "./integrity.ts";
import { fromPackageLock, parsePackageLock, supportedResolved } from "./package-lock.ts";
import type { PackageJson } from "./package-lock.ts";
import { filterPlatformForTarget } from "./resolve.ts";
import type { Platform } from "./resolve.ts";
import { extractTar } from "./tar.ts";
import { noTarballCache } from "./tarball-cache.ts";
import type { TarballCache } from "./tarball-cache.ts";

export interface MaterializeLimits {
  packages: number;
  downloadBytes: number;
  unpackedBytes: number;
  files: number;
}

export interface MaterializeInput {
  manifest: PackageJson;
  lock: string;
  registry?: string;
  /** Allowed tarball registry bases; defaults to registry or the public npm registry. */
  registries?: string[];
  fetch?: typeof fetch;
  tarballCache?: TarballCache;
  include?: (path: string) => boolean;
  limits?: Partial<MaterializeLimits>;
  concurrency?: number;
  /** Omit to keep the lock graph; pass a target to filter it, or "none" for Workers without a native platform. */
  platform?: Platform | "none";
  production?: boolean;
  signal?: AbortSignal;
}

const DEFAULT_LIMITS: MaterializeLimits = {
  packages: 256,
  downloadBytes: 64 * 1024 * 1024,
  unpackedBytes: 128 * 1024 * 1024,
  files: 20_000,
};

export async function materialize(input: MaterializeInput): Promise<{
  files: Record<string, Uint8Array>;
  packages: number;
  unpackedBytes: number;
  warnings: string[];
}> {
  const abort = () => {
    if (input.signal?.aborted) throw new UpmError("EABORT", "materialization aborted");
  };
  abort();
  const limits = { ...DEFAULT_LIMITS, ...input.limits };
  const { resolution, placement } = fromPackageLock(parsePackageLock(input.lock), input.manifest);
  checkPlacement(resolution, placement);
  let selected = resolution;
  try {
    if (input.platform)
      selected = filterPlatformForTarget(
        resolution,
        input.platform === "none" ? { os: "none", cpu: "none", libc: undefined } : input.platform,
      );
  } catch (error) {
    throw new UpmError("EPLATFORM", (error as Error).message);
  }
  const items = [...placement].filter(([, key]) => {
    const pkg = selected.packages[key];
    return pkg !== undefined && (!input.production || !pkg.dev);
  });
  const charge = (limit: keyof MaterializeLimits, value: number, max: number) => {
    if (value > max) throw new UpmError("ELIMIT", `${limit} exceeds ${max}`, { limit, value, max });
  };
  charge("packages", items.length, limits.packages);
  const fetcher = input.fetch ?? globalThis.fetch;
  const cache = input.tarballCache ?? noTarballCache;
  const files: Record<string, Uint8Array> = {};
  let downloadBytes = 0;
  let unpackedBytes = 0;
  let fileCount = 0;
  let next = 0;
  let unpacking: Promise<unknown> = Promise.resolve();
  const fetched = new Map<string, Promise<Uint8Array>>();
  const registries = input.registries ?? [input.registry ?? "https://registry.npmjs.org"];
  const allowedUrl = (key: string, resolved: string) =>
    supportedResolved(key, resolved, registries);
  for (const [path, key] of placement) allowedUrl(path, resolution.packages[key]!.resolved);

  const verified = async (bytes: Uint8Array, integrity: string): Promise<boolean> => {
    try {
      const verifier = createVerifier(integrity);
      verifier.update(bytes);
      await verifier.verify();
      return true;
    } catch {
      return false;
    }
  };

  const archive = (path: string, resolved: string, integrity: string): Promise<Uint8Array> => {
    const url = allowedUrl(path, resolved);
    const existing = fetched.get(integrity);
    if (existing) return existing;
    const task = (async () => {
      abort();
      try {
        parseIntegrity(integrity);
      } catch {
        throw new UpmError("EINTEGRITY", `invalid integrity for ${path}`, {
          phase: "lock",
          key: path,
        });
      }
      let cached: Uint8Array | undefined;
      try {
        cached = await cache.get(integrity);
      } catch {
        /* cache failure is a miss */
      }
      if (cached && (await verified(cached, integrity))) {
        downloadBytes += cached.length;
        charge("downloadBytes", downloadBytes, limits.downloadBytes);
        return cached;
      }
      const corruptCache = cached !== undefined;
      let response: Response;
      let nextUrl = url;
      for (let redirects = 0; ; redirects++) {
        try {
          response = await fetcher(nextUrl, { signal: input.signal, redirect: "manual" });
        } catch (error) {
          abort();
          throw new UpmError("EREGISTRY", `cannot fetch ${path}: ${(error as Error).message}`);
        }
        if (response.status < 300 || response.status >= 400) break;
        const location = response.headers.get("location");
        if (!location || redirects === 5)
          throw new UpmError("EREGISTRY", `cannot follow tarball redirect for ${path}`);
        let target: string;
        try {
          target = new URL(location, nextUrl).href;
        } catch {
          throw new UpmError("ELOCK", `invalid tarball redirect for ${path}`, {
            key: path,
            resolved: location,
          });
        }
        nextUrl = allowedUrl(path, target);
      }
      if (!response.ok)
        throw new UpmError("EREGISTRY", `cannot fetch ${path}: HTTP ${response.status}`);
      const chunks: Uint8Array[] = [];
      let size = 0;
      try {
        if (!response.body) throw new Error("empty tarball response");
        for await (const chunk of response.body) {
          abort();
          size += chunk.length;
          downloadBytes += chunk.length;
          charge("downloadBytes", downloadBytes, limits.downloadBytes);
          chunks.push(chunk);
        }
      } catch (error) {
        if (error instanceof UpmError) throw error;
        abort();
        throw new UpmError("EREGISTRY", `cannot read ${path}: ${(error as Error).message}`);
      }
      const bytes = new Uint8Array(size);
      let offset = 0;
      for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.length;
      }
      if (!(await verified(bytes, integrity))) {
        throw new UpmError("EINTEGRITY", `integrity mismatch for ${path}`, {
          phase: corruptCache ? "cache" : "download",
          key: path,
        });
      }
      try {
        await cache.put(integrity, bytes);
      } catch {
        /* installation does not depend on the cache */
      }
      return bytes;
    })();
    fetched.set(integrity, task);
    return task;
  };

  const install = async ([path, key]: [string, string]) => {
    abort();
    const pkg = selected.packages[key]!;
    const bytes = await archive(path, pkg.resolved, pkg.integrity);
    const turn = unpacking.then(async () => {
      abort();
      async function* source() {
        yield bytes;
      }
      let includeEntry = true;
      for await (const entry of extractTar(source(), {
        onHeader(path, size) {
          abort();
          charge("unpackedBytes", unpackedBytes + size, limits.unpackedBytes);
          includeEntry = input.include?.(path) ?? true;
          if (includeEntry) charge("files", fileCount + 1, limits.files);
        },
      })) {
        abort();
        unpackedBytes += entry.size;
        if (!includeEntry) continue;
        fileCount++;
        files[`${path}/${entry.path}`] = entry.data;
      }
    });
    unpacking = turn.catch(() => undefined);
    await turn;
  };
  const concurrency = Math.max(1, Math.min(6, input.concurrency ?? 4));
  const worker = async () => {
    while (next < items.length) {
      const item = items[next++]!;
      try {
        await install(item);
      } catch (error) {
        next = items.length;
        throw error;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
  return { files, packages: items.length, unpackedBytes, warnings: selected.warnings };
}
