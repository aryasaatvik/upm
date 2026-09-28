import { UpmError } from "./error.ts";
import { checkPlacement } from "./hoist.ts";
import { createVerifier } from "./integrity.ts";
import { fromPackageLock, parsePackageLock } from "./package-lock.ts";
import type { PackageJson } from "./package-lock.ts";
import { filterPlatform } from "./resolve.ts";
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
  fetch?: typeof fetch;
  tarballCache?: TarballCache;
  include?: (path: string) => boolean;
  limits?: Partial<MaterializeLimits>;
  concurrency?: number;
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
    if (input.platform && input.platform !== "none")
      selected = filterPlatform(resolution, input.platform);
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
    const existing = fetched.get(integrity);
    if (existing) return existing;
    const task = (async () => {
      abort();
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
      if (!integrity)
        throw new UpmError("EINTEGRITY", `missing integrity for ${path}`, {
          phase: "lock",
          key: path,
        });
      if (!/^https?:\/\//.test(resolved))
        throw new UpmError("ELOCK", `missing tarball URL for ${path}`);
      let response: Response;
      try {
        response = await fetcher(resolved, { signal: input.signal });
      } catch (error) {
        abort();
        throw new UpmError("EREGISTRY", `cannot fetch ${path}: ${(error as Error).message}`);
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
      for await (const entry of extractTar(source())) {
        abort();
        unpackedBytes += entry.size;
        charge("unpackedBytes", unpackedBytes, limits.unpackedBytes);
        if (input.include && !input.include(entry.path)) continue;
        fileCount++;
        charge("files", fileCount, limits.files);
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
