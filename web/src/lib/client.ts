// What the playground asks of upm: all of it runs in the browser, from `../src`.
import {
  createRegistry,
  formatLockfile,
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
import { storedFiles } from "./install.ts";

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
  /** Bytes downloaded; 0 when the files came from the store. */
  bytes: number;
  /** Read from upm's store, which an earlier install filled: no request was made. */
  stored: boolean;
  files: TarEntry[];
  ms: number;
}

export interface Client {
  registry: Registry;
  requests: RequestEntry[];
  /** `after`: when to start; the parts stay pending until then. */
  run(
    spec: string,
    onPick: (pkg: ResolvedPackage, from: string) => void,
    after?: Promise<unknown>,
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

    run(raw, onPick, after) {
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
        const start = performance.now();
        const resolution = await resolveTree(
          { name: "playground", version: "0.0.0", dependencies },
          {
            registry,
            onPick(pkg, from) {
              if (from === "") picked(pkg);
              onPick(pkg, from);
            },
          },
        );
        const ms = performance.now() - start;
        const lockfile = formatLockfile(toLockfile(resolution, registry.baseFor));
        return { resolution, ms, lockfile };
      })();
      // A walk that fails before its first pick fails the rest with it; after, this is a no-op.
      resolved.catch(failed);
      // What an earlier install left in the store answers both, with no request.
      const stored = top.then((pkg) => (pkg.integrity ? storedFiles(pkg.integrity) : undefined));
      // The record's name is what it installs as; an alias is asked for by its real name.
      const manifest = top.then(async (pkg) => {
        const files = await stored;
        return (
          (files && manifestOf(files)) ??
          (registry.manifest(spec.fetchName, pkg.version) as Promise<FullManifest>)
        );
      });
      const tarball = top.then((pkg) => fetchTarball(pkg.resolved, pkg.integrity, stored));
      for (const promise of [top, stored, manifest, tarball, resolved]) promise.catch(() => {});
      return { name: spec.name, dependencies, top, manifest, tarball, resolved };
    },
  };

  /**
   * The package's own package.json, as the panel shows it. What only the registry adds is not
   * in it: `deprecated`, and `hasInstallScript`, which is worked out here as npm does.
   */
  function manifestOf(files: TarEntry[]): FullManifest | undefined {
    const file = files.find((f) => f.path === "package.json");
    if (!file) return undefined;
    try {
      const manifest = JSON.parse(new TextDecoder().decode(file.data)) as FullManifest & {
        scripts?: Record<string, string>;
      };
      const scripts = manifest.scripts ?? {};
      manifest.hasInstallScript = !!(
        scripts.preinstall ||
        scripts.install ||
        scripts.postinstall ||
        files.some((f) => f.path === "binding.gyp")
      );
      return manifest;
    } catch {
      return undefined;
    }
  }

  async function fetchTarball(
    url: string,
    integrity: string,
    fromStore: Promise<TarEntry[] | undefined>,
  ): Promise<Tarball> {
    if (!integrity) throw new Error(`${url} has no integrity`);
    const start = performance.now();
    // The store is keyed by integrity and every file by its own hash: nothing to check again.
    const stored = await fromStore;
    if (stored) {
      stored.sort((a, b) => a.path.localeCompare(b.path));
      return {
        url,
        integrity,
        bytes: 0,
        stored: true,
        files: stored,
        ms: performance.now() - start,
      };
    }
    // WebCrypto exists only in a secure context; upm hashes with it off Node.
    if (!globalThis.crypto?.subtle) {
      throw new Error(
        `No WebCrypto on ${location.origin}: the integrity check needs https or localhost. ` +
          `Open the playground on http://localhost (forward the port) or serve it over https.`,
      );
    }
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
    return { url, integrity, bytes, stored: false, files, ms: performance.now() - start };
  }
}
