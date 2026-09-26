// What the playground asks of upm: all of it runs in the browser, from `../src`.
import {
  createRegistry,
  formatLockfile,
  fromLockfile,
  parseLockfile,
  parseSpec,
  resolveTree,
  toLockfile,
  type Manifest,
  type Registry,
  type Resolution,
  type ResolvedPackage,
} from "upm/resolver";
import { createVerifier } from "upm/src/integrity.ts";
import { extractTar, type TarEntry } from "upm/src/tar.ts";
import { readLock, writeLock } from "./locks.ts";

export const DEFAULT_REGISTRY = "https://registry.npmjs.org";

export interface RequestEntry {
  id: number;
  url: string;
  status: number;
  /** `performance.now()` when it was sent. */
  start: number;
  /** From the request to its headers. */
  ms: number;
  /** From the request to its last byte, or its failure; 0 until then. */
  end: number;
  /** Body bytes read so far; the registry client may stop reading early. */
  bytes: number;
  done: boolean;
}

/** The package's own manifest: more than `Manifest` types, since the full route has it all. */
export type FullManifest = Manifest & {
  description?: string;
  license?: string;
  homepage?: string;
  repository?: string | { url?: string };
  keywords?: string[];
};

export interface Resolved {
  resolution: Resolution;
  lockfile: string;
  ms: number;
}

/**
 * One query, as independent promises so each part shows the moment it lands. `top` settles on
 * the resolver's first pick; the manifest and the tarball start from it, alongside the walk.
 */
export interface Run {
  name: string;
  /** The root's dependencies: what the resolve walks, and what an install installs. */
  dependencies: Record<string, string>;
  top: Promise<ResolvedPackage>;
  manifest: Promise<FullManifest>;
  tarball: Promise<Tarball>;
  resolved: Promise<Resolved>;
}

export interface Tarball {
  url: string;
  integrity: string;
  bytes: number;
  files: TarEntry[];
  ms: number;
}

export interface Client {
  registry: Registry;
  requests: RequestEntry[];
  /**
   * `after`: when to start; the parts stay pending until then. `fresh`: walk without the last
   * lockfile, as with no `upm.lock`.
   */
  run(
    spec: string,
    onPick: (pkg: ResolvedPackage, from: string) => void,
    after?: Promise<unknown>,
    fresh?: boolean,
  ): Run;
}

/** A client whose every request lands in `requests`, `onChange` told of each move. */
export function createClient(registryUrl: string, onChange: () => void): Client {
  const requests: RequestEntry[] = [];
  let ids = 0;

  const logged: typeof fetch = async (input, init) => {
    const url = input instanceof Request ? input.url : String(input);
    const start = performance.now();
    const entry: RequestEntry = {
      id: ids++,
      url,
      status: 0,
      start,
      ms: 0,
      end: 0,
      bytes: 0,
      done: false,
    };
    requests.push(entry);
    onChange();
    let response: Response;
    try {
      response = await fetch(input, init);
    } catch (error) {
      entry.done = true;
      entry.ms = entry.end = performance.now() - start;
      onChange();
      throw error;
    }
    entry.status = response.status;
    entry.ms = performance.now() - start;
    onChange();
    if (!response.body) {
      entry.done = true;
      entry.end = entry.ms;
      return response;
    }
    const counted = response.body.pipeThrough(
      new TransformStream<Uint8Array, Uint8Array>({
        transform(chunk, controller) {
          entry.bytes += chunk.byteLength;
          controller.enqueue(chunk);
          onChange();
        },
        flush() {
          entry.done = true;
          entry.end = performance.now() - start;
          onChange();
        },
      }),
    );
    return new Response(counted, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    });
  };

  const registry = createRegistry({ registry: registryUrl, fetch: logged });

  return {
    registry,
    requests,

    run(raw, onPick, after, fresh) {
      const spec = parseSpec(raw.trim());
      if (spec.type === "workspace" || spec.type === "tarball") {
        throw new Error(`Only registry specs here, not ${spec.type}: ${raw}`);
      }
      const range =
        spec.name === spec.fetchName ? spec.fetchSpec : `npm:${spec.fetchName}@${spec.fetchSpec}`;
      const dependencies = { [spec.name]: range };
      let picked!: (pkg: ResolvedPackage) => void;
      let failed!: (error: unknown) => void;
      const top = new Promise<ResolvedPackage>((ok, fail) => {
        picked = ok;
        failed = fail;
      });
      const resolved = (async () => {
        await after;
        const locked = fresh ? undefined : lockedFrom(await readLock(registryUrl, dependencies));
        const start = performance.now();
        const resolution = await resolveTree(
          { name: "playground", version: "0.0.0", dependencies },
          {
            registry,
            locked,
            onPick(pkg, from) {
              if (from === "") picked(pkg);
              onPick(pkg, from);
            },
          },
        );
        const ms = performance.now() - start;
        const lockfile = formatLockfile(toLockfile(resolution, registry.baseFor));
        void writeLock(registryUrl, dependencies, lockfile);
        return { resolution, ms, lockfile };
      })();
      // A walk that fails before its first pick fails the rest with it; after, this is a no-op.
      resolved.catch(failed);
      // The record's name is what it installs as; an alias is asked for by its real name.
      const manifest = top.then(
        (pkg) => registry.manifest(spec.fetchName, pkg.version) as Promise<FullManifest>,
      );
      const tarball = top.then((pkg) => fetchTarball(pkg.resolved, pkg.integrity));
      for (const promise of [top, manifest, tarball, resolved]) promise.catch(() => {});
      return { name: spec.name, dependencies, top, manifest, tarball, resolved };
    },
  };

  /** The last walk's lockfile, to keep what still fits: a tag still asks the registry. */
  function lockedFrom(lockfile: string | undefined) {
    try {
      return lockfile === undefined
        ? undefined
        : fromLockfile(parseLockfile(lockfile), registry.baseFor);
    } catch {
      return undefined;
    }
  }

  async function fetchTarball(url: string, integrity: string): Promise<Tarball> {
    if (!integrity) throw new Error(`${url} has no integrity`);
    // WebCrypto exists only in a secure context; upm hashes with it off Node.
    if (!globalThis.crypto?.subtle) {
      throw new Error(
        `No WebCrypto on ${location.origin}: the integrity check needs https or localhost. ` +
          `Open the playground on http://localhost (forward the port) or serve it over https.`,
      );
    }
    const start = performance.now();
    const response = await logged(url);
    if (!response.ok || !response.body)
      throw new Error(`Registry returned ${response.status} for ${url}`);
    const verifier = createVerifier(integrity);
    const reader = response.body.getReader();
    let bytes = 0;
    const read = async () => {
      const { done, value } = await reader.read();
      if (done) return undefined;
      bytes += value.byteLength;
      verifier.update(value);
      return value;
    };
    async function* body() {
      for (let chunk = await read(); chunk; chunk = await read()) yield chunk;
    }
    const files: TarEntry[] = [];
    for await (const entry of extractTar(body())) files.push(entry);
    // The archive can end before the bytes do; the integrity covers them all.
    while (await read());
    await verifier.verify();
    files.sort((a, b) => a.path.localeCompare(b.path));
    return { url, integrity, bytes, files, ms: performance.now() - start };
  }
}
