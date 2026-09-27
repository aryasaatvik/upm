// A store backend: shared storage behind the content store, asked on a miss and handed what
// is downloaded. Loaded only by a store that has one.
import { builtin } from "./builtin.ts";
import { createLimiter } from "./limit.ts";
import type { Limiter } from "./limit.ts";
import { digest, toBase64Url } from "./runtime.ts";
import { authFor } from "./registry.ts";
import type { PackageIndex, StoreOptions, Tarball } from "./store.ts";
import type { Writer } from "./unpack.ts";
import { sizeOfSync, trace } from "./util.ts";

/** A file of a package, named by the sha512 of its bytes: `sha512-<base64url>`. */
export interface BackendFile {
  path: string;
  hash: string;
  size: number;
  exec: boolean;
}

/**
 * A package's files as a backend keeps them. The same on every platform, and one blob per hash
 * serves both file modes. `v` changes when the shape does.
 */
export interface BackendIndex {
  v: 1;
  integrity: string;
  unpackedSize: number;
  files: BackendFile[];
}

/** The package a call is about: its integrity, and the same as a key or file name (base64url). */
export interface BackendPackage {
  integrity: string;
  key: string;
}

/**
 * One call. It is abandoned once it makes no progress for 30 s: `signal` aborts and the store
 * moves on. A call that moves many bytes says it is still going with `alive`.
 */
export interface BackendCall {
  signal: AbortSignal;
  alive(): void;
}

export interface BackendPut extends BackendPackage {
  index: BackendIndex;
  /** A file's bytes, read back from the store. */
  read(file: BackendFile): Promise<Uint8Array>;
  /**
   * Where the tarball came from: its url, none for a file on this machine, and whether it was
   * fetched with credentials. A shared backend should skip what its readers may not see, and
   * resolve: a throw counts as a failure, and a few of them switch the backend off.
   */
  source: { url?: string; authorized: boolean };
}

/**
 * Shared storage behind the store: a remote cache, a team store, a key-value database. The
 * store stays a real directory to link from; the backend is asked on a miss, before a download,
 * and handed each package the store downloads. The caller owns it: upm never closes it.
 *
 * It must be trusted as much as the store itself. A blob is checked against its hash, which
 * catches damage, but nothing can check a file list against the tarball's integrity without the
 * tarball: whoever can write to the backend decides what a package holds.
 */
export interface StoreBackend {
  /** Undefined when it has not got the package. A throw or a timeout is a failure. */
  getIndex(pkg: BackendPackage, call: BackendCall): Promise<BackendIndex | undefined>;
  /** In the order asked, undefined for one it has not got. Asked a window at a time. */
  getBlobs(
    pkg: BackendPackage,
    files: BackendFile[],
    call: BackendCall,
  ): Promise<(Uint8Array | undefined)[]>;
  put?(entry: BackendPut, call: BackendCall): Promise<void>;
  /** Skip hashing blobs on arrival, for a backend as safe from damage as the store's disk. */
  trusted?: boolean;
  /** Packages read at once, and as many written. Default 16 each. */
  concurrency?: number;
}

export interface BackendClient {
  /** A package from the backend, its content written here; undefined on a miss. */
  fetch(integrity: string, repair: boolean): Promise<PackageIndex | undefined>;
  /** Hand a package the store downloaded to the backend, in the background. */
  put(integrity: string, index: PackageIndex, tarball: Tarball): void;
  /** Wait for every put so far, and any started meanwhile. Never rejects. */
  flush(): Promise<void>;
}

/** Content's modes, as `src/unpack.ts` writes them: read-only, since projects link it. */
const FILE_MODE = 0o444;
const EXEC_MODE = 0o555;
const CONCURRENCY = 16;
/** Blob bytes asked for at once per package; a bigger file goes alone. */
const WINDOW = 8 * 1024 * 1024;
/** Failures before the backend is left alone for the rest of the store's life. */
const GIVE_UP = 3;
const HASH = /^sha512-[\w-]{86}$/;

/** An integrity as a key or a file name: base64url, unpadded. */
export function backendKey(integrity: string): string {
  return integrity.replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

/** `stall`: how long a call may make no progress. */
export function createBackendClient(
  options: StoreOptions,
  writer: Writer,
  disk: Limiter,
  stall: number,
): BackendClient {
  const backend = options.backend!;
  // Apart, so puts running in the background never hold up a lookup an install waits on.
  const reads = createLimiter(backend.concurrency ?? CONCURRENCY);
  const writes = createLimiter(backend.concurrency ?? CONCURRENCY);
  const putting = new Set<Promise<void>>();
  let failures = 0;

  function failed(error: unknown): undefined {
    if (failures++ === 0) options.backendFailed?.(error);
    return undefined;
  }

  /** One backend call, abandoned once it makes no progress for `stall`. */
  async function call<T>(run: (call: BackendCall) => Promise<T>): Promise<T> {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let done = false;
    let quiet!: (error: Error) => void;
    const alive = () => {
      if (done) return;
      clearTimeout(timer);
      timer = setTimeout(() => {
        const error = Object.assign(new Error(`store backend went quiet for ${stall} ms`), {
          code: "ETIMEDOUT",
        });
        controller.abort(error);
        quiet(error);
      }, stall);
    };
    alive();
    try {
      // Raced, so a backend that ignores the signal still lets the store move on.
      return await Promise.race([
        run({ signal: controller.signal, alive }),
        new Promise<never>((_, reject) => (quiet = reject)),
      ]);
    } finally {
      done = true;
      clearTimeout(timer);
    }
  }

  async function fetch(integrity: string, repair: boolean): Promise<PackageIndex | undefined> {
    if (failures >= GIVE_UP) return undefined;
    const pkg = { integrity, key: backendKey(integrity) };
    try {
      return await reads(async () => {
        const kept = await call((c) => backend.getIndex(pkg, c));
        if (kept === undefined) return undefined;
        const files = checked(kept, integrity);
        // Each hash once, for every mode it is wanted in, and none the store already has.
        const wanted = new Map<string, { file: BackendFile; blobs: string[] }>();
        for (const [i, file] of kept.files.entries()) {
          const blob = files[i]!.blob;
          if (!repair && sizeOfSync(writer.blobPath(blob)) === file.size) continue;
          const entry = wanted.get(file.hash);
          if (!entry) wanted.set(file.hash, { file, blobs: [blob] });
          else if (!entry.blobs.includes(blob)) entry.blobs.push(blob);
        }
        for (const window of windows([...wanted.values()])) {
          const got = await call((c) =>
            backend.getBlobs(
              pkg,
              window.map((entry) => entry.file),
              c,
            ),
          );
          if (!(await usable(window, got))) return undefined;
          await Promise.all(
            window.flatMap(({ blobs }, i) => blobs.map((blob) => write(blob, got[i]!, repair))),
          );
        }
        trace("backend", { i: integrity, files: files.length });
        return { integrity, files, unpackedSize: kept.unpackedSize };
      });
    } catch (error) {
      return failed(error);
    }
  }

  /** Every blob there at its size and, unless trusted, its hash. A wrong one is a failure. */
  async function usable(
    window: { file: BackendFile }[],
    got: (Uint8Array | undefined)[],
  ): Promise<boolean> {
    if (!Array.isArray(got) || got.length !== window.length) {
      throw new Error("store backend answered for other blobs than it was asked for");
    }
    const checks = window.map(async ({ file }, i) => {
      const data = got[i];
      if (data === undefined) return false;
      if (data.length !== file.size || !(backend.trusted || (await matches(file.hash, data)))) {
        throw new Error(`store backend holds damaged content for ${file.hash}`);
      }
      return true;
    });
    return (await Promise.all(checks)).every(Boolean);
  }

  async function write(blob: string, data: Uint8Array, repair: boolean): Promise<void> {
    const target = writer.blobPath(blob);
    await writer.ensureDir(builtin.path.dirname(target));
    const mode = blob.endsWith("-exec") ? EXEC_MODE : FILE_MODE;
    await disk(() => writer.put(target, data, mode, repair));
  }

  async function send(integrity: string, index: PackageIndex, tarball: Tarball): Promise<void> {
    if (!backend.put || failures >= GIVE_UP) return;
    const url = typeof tarball === "string" ? tarball : undefined;
    const source = { url, authorized: !!(url && options.auth && authFor(options.auth, url)) };
    const paths = new Map<string, string>();
    const files = index.files.map((file) => {
      const { hash, exec } = backendHash(file.blob);
      paths.set(hash, writer.blobPath(file.blob));
      return { path: file.path, hash, size: file.size, exec };
    });
    const kept: BackendIndex = { v: 1, integrity, unpackedSize: index.unpackedSize, files };
    // What every reader would refuse is not worth keeping: a tarball can hold a path the tar
    // reader lets through and `checked` does not, such as `c:name`.
    try {
      checked(kept, integrity);
    } catch {
      return;
    }
    try {
      await writes(() =>
        call((c) =>
          backend.put!(
            {
              integrity,
              key: backendKey(integrity),
              index: kept,
              source,
              // Each read is progress: a big package is slow to hand over, not stuck.
              read: async (file) => {
                c.alive();
                const data = await disk(() => builtin.fsp.readFile(paths.get(file.hash)!));
                c.alive();
                return data;
              },
            },
            c,
          ),
        ),
      );
    } catch (error) {
      failed(error);
    }
  }

  function put(integrity: string, index: PackageIndex, tarball: Tarball): void {
    const task = send(integrity, index, tarball).finally(() => putting.delete(task));
    putting.add(task);
  }

  async function flush(): Promise<void> {
    while (putting.size > 0) await Promise.all(putting);
  }

  return { fetch, put, flush };
}

/**
 * The backend's index as the store's own, or a throw: a path that could leave the package's
 * directory, a hash the store cannot name, another package's integrity.
 */
function checked(kept: BackendIndex, integrity: string): PackageIndex["files"] {
  const bad = (what: string) => new Error(`store backend index for ${integrity}: ${what}`);
  if (kept?.v !== 1 || kept.integrity !== integrity || !Array.isArray(kept.files)) {
    throw bad("not a version 1 index of this package");
  }
  if (!Number.isSafeInteger(kept.unpackedSize) || kept.unpackedSize < 0) {
    throw bad("no unpacked size");
  }
  const seen = new Set<string>();
  return kept.files.map((file) => {
    const { path, hash, size, exec } = file ?? {};
    if (!isSafePath(path) || seen.has(path)) throw bad(`unsafe path ${JSON.stringify(path)}`);
    seen.add(path);
    if (typeof hash !== "string" || !HASH.test(hash)) throw bad(`bad hash for ${path}`);
    if (!Number.isSafeInteger(size) || size < 0) throw bad(`bad size for ${path}`);
    if (typeof exec !== "boolean") throw bad(`bad mode for ${path}`);
    return { path, blob: storeBlob(hash, exec), size };
  });
}

/** What the tar reader lets through: relative, `/`-separated, no `.`, `..` or empty part. */
function isSafePath(path: unknown): path is string {
  if (typeof path !== "string" || path === "" || path.includes("\\")) return false;
  if (path.startsWith("/") || /^[a-z]:/i.test(path)) return false;
  return path.split("/").every((part) => part !== "" && part !== "." && part !== "..");
}

/** Files in windows of at most `WINDOW` bytes, each holding at least one. */
function windows<T extends { file: BackendFile }>(entries: T[]): T[][] {
  const out: T[][] = [];
  let current: T[] = [];
  let bytes = 0;
  for (const entry of entries) {
    if (current.length > 0 && bytes + entry.file.size > WINDOW) {
      out.push(current);
      current = [];
      bytes = 0;
    }
    current.push(entry);
    bytes += entry.file.size;
  }
  if (current.length > 0) out.push(current);
  return out;
}

/** A blob, `<shard><sep><algorithm>-<rest>[-exec]`, as the hash a backend names it by. */
function backendHash(blob: string): { hash: string; exec: boolean } {
  const { sep } = builtin.path;
  const at = blob.indexOf(sep);
  const exec = blob.endsWith("-exec");
  const name = blob.slice(at + sep.length, exec ? -"-exec".length : undefined);
  const dash = name.indexOf("-");
  return { hash: `${name.slice(0, dash)}-${blob.slice(0, at)}${name.slice(dash + 1)}`, exec };
}

/** The store's blob for a checked backend hash. */
function storeBlob(hash: string, exec: boolean): string {
  const rest = hash.slice("sha512-".length);
  const name = `sha512-${rest.slice(2)}`;
  return `${rest.slice(0, 2)}${builtin.path.sep}${exec ? `${name}-exec` : name}`;
}

/** Whether bytes are what a backend's sha512 hash says. */
async function matches(hash: string, data: Uint8Array): Promise<boolean> {
  return `sha512-${toBase64Url(await digest("sha512", data))}` === hash;
}
