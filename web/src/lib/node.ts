// Just enough of Node for upm's `install` to run in a tab: a `process` whose `getBuiltinModule`
// hands out an `fs` and `fs/promises`, a posix `path` and `os`, and `worker_threads` on web
// workers. Only the calls upm makes on that path. Crypto, zlib and Buffer stay the web's
// (src/runtime.ts asks for each by name).
//
// The filesystem lives in memory, since upm's sync calls cannot wait for OPFS on this thread.
// `persist()` loads what OPFS kept and saves each change back once writes go quiet.

import type { Boot } from "./thread.ts";

type Entry = File | Dir | Link;
interface Meta {
  ino: number;
  /** Permission bits only. */
  mode: number;
  mtime: number;
  ctime: number;
}
export interface File extends Meta {
  kind: "file";
  /** Never changed in place, so a hardlink or a copy may share it. */
  data: Uint8Array;
}
export interface Dir extends Meta {
  kind: "dir";
  entries: Map<string, Entry>;
}
export interface Link extends Meta {
  kind: "link";
  target: string;
}

export interface ShimOptions {
  cwd?: string;
  home?: string;
  env?: Record<string, string>;
  platform?: string;
  arch?: string;
  /** What `process.report` says on Linux; upm installs the builds for this libc. */
  libc?: "glibc" | "musl";
}

const UMASK = 0o022;
let inodes = 0;
let clock = 0;
let root = dir(0o755);

/** Bumped on every change: a cheap way to tell whether to look again. */
export let changes = 0;

/** A fresh, empty filesystem, on OPFS too. Anything still writing to the old one writes into nothing. */
export function reset(): void {
  root = dir(0o755);
  changed();
}

function changed(): void {
  changes++;
  if (!disk) return;
  clearTimeout(timer);
  timer = setTimeout(() => void flush(), QUIET_MS);
}

/** Every entry under `at`, depth first, links not followed. */
export function* walk(at = "/"): Generator<[path: string, entry: Entry]> {
  const { node } = find(at, true, "scandir");
  if (node?.kind !== "dir") return;
  for (const name of [...node.entries.keys()].sort()) {
    const path = at === "/" ? `/${name}` : `${at}/${name}`;
    const entry = node.entries.get(name)!;
    yield [path, entry];
    if (entry.kind === "dir") yield* walk(path);
  }
}

/**
 * Install the shim as `globalThis.process`. Never over a real one: returns false and leaves it.
 * Linux x64 with glibc unless told otherwise, so optional native builds are the ones most
 * machines would get; there is no Node version, so every `engines.node` passes.
 */
export function installShim(options: ShimOptions = {}): boolean {
  if (globalThis.process) return false;
  (globalThis as { process?: unknown }).process = createProcess(options);
  return true;
}

export function createProcess(options: ShimOptions = {}) {
  const { platform = "linux", arch = "x64", libc = "glibc" } = options;
  const cwd = options.cwd ?? "/project";
  const home = options.home ?? "/home/user";
  const env = { ...options.env };
  const modules: Record<string, unknown> = {
    fs,
    "fs/promises": fsp,
    path,
    os: { homedir: () => home },
    worker_threads: {
      isMainThread: true,
      parentPort: null,
      Worker: class extends Thread {
        constructor(entry: URL | string, options?: { workerData?: unknown }) {
          super(entry, options?.workerData, { platform, arch, env, cwd });
        }
      },
    },
  };
  return {
    platform,
    arch,
    env,
    versions: {},
    // config.ts finds npm's global `.npmrc` beside it.
    execPath: "/usr/local/bin/node",
    cwd: () => cwd,
    umask: () => UMASK,
    getBuiltinModule: (id: string) => modules[id.replace(/^node:/, "")],
    report: {
      getReport: () => ({ header: libc === "glibc" ? { glibcVersionRuntime: "2.39" } : {} }),
    },
  };
}

// --- worker_threads: a web worker per thread ---

let threadIds = 0;

/**
 * A `Worker` on a web worker running ./thread.ts. Only the registry's: it only fetches. The unpack
 * and link workers write files, and a worker cannot reach this thread's filesystem, so those
 * throw here and their pools run on this thread, as they do with no `worker_threads`.
 */
class Thread {
  readonly threadId = ++threadIds;
  #worker: Worker;
  #listeners: Record<string, ((value: unknown) => void)[]> = { message: [], error: [], exit: [] };
  #exited = false;

  constructor(entry: URL | string, workerData: unknown, process: Boot["process"]) {
    // `upm-worker:<name>`, as vite.config.ts spells upm's worker entries.
    const name = String(entry).replace(/^upm-worker:/, "");
    if (name !== "registry") throw new Error(`upm's ${name} worker cannot run in a tab`);
    this.#worker = new Worker(new URL("./thread.ts", import.meta.url), {
      type: "module",
      name: `upm ${name}`,
    });
    this.#worker.onmessage = ({ data }) => this.#emit("message", data);
    this.#worker.onmessageerror = () => this.#fail(new Error("a message could not be read"));
    this.#worker.onerror = (event) => {
      event.preventDefault();
      this.#fail(new Error(event.message || `upm's ${name} worker failed to load`));
    };
    this.#worker.postMessage({ name, workerData, process } satisfies Boot);
  }

  on(type: string, listener: (value: never) => void): this {
    this.#listeners[type]?.push(listener as (value: unknown) => void);
    return this;
  }

  postMessage(message: unknown, transfer?: Transferable[]): void {
    this.#worker.postMessage(message, transfer ?? []);
  }

  /** A tab has no process to hold open. */
  ref(): void {}
  unref(): void {}

  /** As Node's: `exit` follows, a tick later. */
  terminate(): Promise<number> {
    this.#worker.terminate();
    return Promise.resolve().then(() => {
      if (!this.#exited) this.#emit("exit", 1);
      this.#exited = true;
      return 1;
    });
  }

  /** As a Node thread that throws: `error`, then `exit`. */
  #fail(error: Error): void {
    this.#emit("error", error);
    void this.terminate();
  }

  #emit(type: string, value: unknown): void {
    if (this.#exited) return;
    for (const listener of this.#listeners[type]!) listener(value);
  }
}

// --- path: posix, strings only ---

function normalize(p: string): string {
  const absolute = p.startsWith("/");
  const out: string[] = [];
  for (const part of p.split("/")) {
    if (part === "" || part === ".") continue;
    if (part !== "..") out.push(part);
    else if (out.length > 0 && out.at(-1) !== "..") out.pop();
    else if (!absolute) out.push("..");
  }
  return (absolute ? "/" : "") + out.join("/") || (absolute ? "/" : ".");
}

function resolve(...parts: string[]): string {
  let at = "";
  for (let i = parts.length - 1; i >= 0 && !at.startsWith("/"); i--) {
    if (parts[i]) at = at ? `${parts[i]}/${at}` : parts[i]!;
  }
  if (!at.startsWith("/")) at = `${globalThis.process?.cwd?.() ?? "/"}/${at}`;
  return normalize(at);
}

function relative(from: string, to: string): string {
  const a = split(resolve(from));
  const b = split(resolve(to));
  let same = 0;
  while (same < a.length && a[same] === b[same]) same++;
  return [...a.slice(same).map(() => ".."), ...b.slice(same)].join("/");
}

function dirname(p: string): string {
  const trimmed = p.length > 1 ? p.replace(/\/+$/, "") : p;
  const at = trimmed.lastIndexOf("/");
  return at === -1 ? "." : at === 0 ? "/" : trimmed.slice(0, at);
}

function basename(p: string): string {
  return p.replace(/\/+$/, "").split("/").at(-1) ?? "";
}

const split = (p: string) => p.split("/").filter(Boolean);

export const path = {
  sep: "/",
  normalize,
  resolve,
  relative,
  dirname,
  basename,
  join: (...parts: string[]) => normalize(parts.filter(Boolean).join("/") || "."),
  isAbsolute: (p: string) => p.startsWith("/"),
};

// --- fs ---

/** A strictly rising clock, so two changes never share a stamp: upm's install state reads them. */
function now(): number {
  return (clock = Math.max(clock + 0.001, Date.now()));
}

function meta(mode: number): Meta {
  const t = now();
  return { ino: ++inodes, mode, mtime: t, ctime: t };
}

function dir(mode: number): Dir {
  return { kind: "dir", entries: new Map(), ...meta(mode) };
}

function fail(code: string, syscall: string, path: string): Error {
  return Object.assign(new Error(`${code}: ${syscall} '${path}'`), {
    code,
    syscall,
    path,
  });
}

interface Found {
  parent: Dir;
  name: string;
  node: Entry | undefined;
  /** The path with every link on the way resolved. */
  real: string;
}

/** Where `p` is. Links on the way are followed, the last one only when `follow`. */
function find(p: string, follow: boolean, syscall: string): Found {
  let parts = split(resolve(p));
  let at = root;
  let real = "";
  let hops = 0;
  for (let i = 0; i < parts.length; i++) {
    const name = parts[i]!;
    const node = at.entries.get(name);
    const last = i === parts.length - 1;
    if (node?.kind === "link" && (follow || !last)) {
      if (++hops > 40) throw fail("ELOOP", syscall, p);
      parts = [...split(resolve(real || "/", node.target)), ...parts.slice(i + 1)];
      at = root;
      real = "";
      i = -1;
      continue;
    }
    if (last) return { parent: at, name, node, real: `${real}/${name}` };
    if (!node) throw fail("ENOENT", syscall, p);
    if (node.kind !== "dir") throw fail("ENOTDIR", syscall, p);
    at = node;
    real += `/${name}`;
  }
  return { parent: root, name: "", node: root, real: "/" };
}

function existing(p: string, follow: boolean, syscall: string): Found & { node: Entry } {
  const found = find(p, follow, syscall);
  if (!found.node) throw fail("ENOENT", syscall, p);
  return found as Found & { node: Entry };
}

function add(parent: Dir, name: string, node: Entry): void {
  parent.entries.set(name, node);
  parent.mtime = parent.ctime = now();
  changed();
}

function remove(parent: Dir, name: string): void {
  parent.entries.delete(name);
  parent.mtime = parent.ctime = now();
  changed();
}

/** The fields upm reads: its install state stamps a file by size, times and inode. */
function stats(node: Entry, bigint = false) {
  const size =
    node.kind === "file" ? node.data.length : node.kind === "dir" ? 4096 : node.target.length;
  const ns = (ms: number) => BigInt(Math.round(ms * 1e6));
  const fields = bigint
    ? {
        size: BigInt(size),
        ino: BigInt(node.ino),
        mtimeNs: ns(node.mtime),
        ctimeNs: ns(node.ctime),
      }
    : { size, ino: node.ino, mtimeMs: node.mtime, ctimeMs: node.ctime };
  return { ...fields, ...kinds(node) };
}

function kinds(node: Entry) {
  return {
    isFile: () => node.kind === "file",
    isDirectory: () => node.kind === "dir",
    isSymbolicLink: () => node.kind === "link",
  };
}

type Encoding = string | { encoding?: string | null } | undefined;

function decode(data: Uint8Array, options: Encoding): string | Uint8Array {
  const encoding = typeof options === "string" ? options : options?.encoding;
  if (!encoding) return data.slice();
  if (encoding === "latin1") return Array.from(data, (byte) => String.fromCharCode(byte)).join("");
  return new TextDecoder().decode(data);
}

const time = (t: Date | number | string) => (t instanceof Date ? t.getTime() : Number(t) * 1000);

function mkdirp(p: string): string | undefined {
  let found: Found;
  try {
    found = find(p, false, "mkdir");
  } catch (error) {
    if ((error as { code?: string }).code !== "ENOENT") throw error;
    const first = mkdirp(dirname(resolve(p)));
    const made = find(p, false, "mkdir");
    add(made.parent, made.name, dir(0o755));
    return first ?? resolve(p);
  }
  if (!found.node) {
    add(found.parent, found.name, dir(0o755));
    return resolve(p);
  }
  if (find(p, true, "mkdir").node?.kind === "dir") return undefined;
  throw fail("EEXIST", "mkdir", p);
}

const sync = {
  existsSync(p: string): boolean {
    try {
      return find(p, true, "access").node !== undefined;
    } catch {
      return false;
    }
  },
  readFileSync(p: string, options?: Encoding) {
    const { node } = existing(p, true, "open");
    if (node.kind !== "file") throw fail("EISDIR", "read", p);
    return decode(node.data, options);
  },
  statSync: (p: string, options?: { bigint?: boolean }) =>
    stats(existing(p, true, "stat").node, options?.bigint),
  lstatSync: (p: string, options?: { bigint?: boolean }) =>
    stats(existing(p, false, "lstat").node, options?.bigint),
  readdirSync(p: string, options?: { withFileTypes?: boolean }) {
    const { node } = existing(p, true, "scandir");
    if (node.kind !== "dir") throw fail("ENOTDIR", "scandir", p);
    const names = [...node.entries.keys()].sort();
    if (!options?.withFileTypes) return names;
    return names.map((name) => ({
      name,
      parentPath: p,
      path: p,
      ...kinds(node.entries.get(name)!),
    }));
  },
  readlinkSync(p: string): string {
    const { node } = existing(p, false, "readlink");
    if (node.kind !== "link") throw fail("EINVAL", "readlink", p);
    return node.target;
  },
  realpathSync: (p: string): string => existing(p, true, "realpath").real,
  mkdirSync(p: string, options?: { recursive?: boolean }): string | undefined {
    if (options?.recursive) return mkdirp(p);
    const found = find(p, false, "mkdir");
    if (found.node) throw fail("EEXIST", "mkdir", p);
    add(found.parent, found.name, dir(0o755));
    return undefined;
  },
  writeFileSync(
    p: string,
    data: string | Uint8Array,
    options?: string | { mode?: number; flag?: string },
  ): void {
    const { mode = 0o666, flag = "w" } = typeof options === "object" ? options : {};
    let found = find(p, false, "open");
    if (found.node && flag.includes("x")) throw fail("EEXIST", "open", p);
    if (found.node?.kind === "link") found = find(p, true, "open");
    // A copy: the caller may reuse its buffer.
    const bytes = typeof data === "string" ? new TextEncoder().encode(data) : new Uint8Array(data);
    if (found.node) {
      if (found.node.kind === "dir") throw fail("EISDIR", "open", p);
      if (!(found.node.mode & 0o200)) throw fail("EACCES", "open", p);
      Object.assign(found.node, { data: bytes, mtime: now(), ctime: now() });
      changed();
    } else {
      add(found.parent, found.name, { kind: "file", data: bytes, ...meta(mode & ~UMASK) });
    }
  },
  renameSync(from: string, to: string): void {
    const a = existing(from, false, "rename");
    const b = find(to, false, "rename");
    if (a.node === b.node) return;
    if (b.node && a.node.kind === "dir") {
      if (b.node.kind !== "dir") throw fail("ENOTDIR", "rename", to);
      if (b.node.entries.size > 0) throw fail("ENOTEMPTY", "rename", to);
    } else if (b.node?.kind === "dir") throw fail("EISDIR", "rename", to);
    if (a.node.kind === "dir" && `${b.real}/`.startsWith(`${a.real}/`)) {
      throw fail("EINVAL", "rename", from);
    }
    if (b.node) remove(b.parent, b.name);
    remove(a.parent, a.name);
    add(b.parent, b.name, a.node);
    a.node.ctime = now();
  },
  rmSync(p: string, options?: { recursive?: boolean; force?: boolean }): void {
    let found: Found;
    try {
      found = find(p, false, "rm");
    } catch (error) {
      if (options?.force && (error as { code?: string }).code === "ENOENT") return;
      throw error;
    }
    if (!found.node) {
      if (options?.force) return;
      throw fail("ENOENT", "rm", p);
    }
    if (found.node.kind === "dir" && !options?.recursive) {
      throw Object.assign(new Error(`Path is a directory: rm returned EISDIR ${p}`), {
        code: "ERR_FS_EISDIR",
      });
    }
    remove(found.parent, found.name);
  },
  rmdirSync(p: string): void {
    const found = existing(p, false, "rmdir");
    if (found.node.kind !== "dir") throw fail("ENOTDIR", "rmdir", p);
    if (found.node.entries.size > 0) throw fail("ENOTEMPTY", "rmdir", p);
    remove(found.parent, found.name);
  },
  symlinkSync(target: string, p: string): void {
    const found = find(p, false, "symlink");
    if (found.node) throw fail("EEXIST", "symlink", p);
    add(found.parent, found.name, { kind: "link", target, ...meta(0o777) });
  },
  linkSync(from: string, to: string): void {
    const { node } = existing(from, false, "link");
    if (node.kind === "dir") throw fail("EPERM", "link", from);
    const found = find(to, false, "link");
    if (found.node) throw fail("EEXIST", "link", to);
    node.ctime = now();
    add(found.parent, found.name, node);
  },
  utimesSync(p: string, _atime: Date | number, mtime: Date | number): void {
    const { node } = existing(p, true, "utime");
    node.mtime = time(mtime);
    node.ctime = now();
    changed();
  },
};

/** `fs/promises`: each sync call, run a tick later, as a real one lands later. */
const fsp = Object.fromEntries(
  Object.entries(sync)
    .filter(([name]) => name !== "existsSync")
    .map(([name, call]) => [
      name.slice(0, -"Sync".length),
      (...args: unknown[]) =>
        Promise.resolve().then(() => (call as (...a: unknown[]) => unknown)(...args)),
    ]),
);

export const fs = { ...sync, promises: fsp };

// --- OPFS: where the filesystem outlives the tab ---

/**
 * `upm/meta.json` lists every entry, depth first, and `upm/blobs/<ino>` holds each file's bytes:
 * one blob per inode, so hardlinks share it.
 */
type Row = [
  path: string,
  kind: "f" | "d" | "l",
  ino: number,
  mode: number,
  mtime: number,
  ctime: number,
  target?: string,
];

/** How long writes must pause before a save: an install saves once it is done, not per file. */
const QUIET_MS = 300;
/** How long to wait for another tab to let go of OPFS. */
const CLAIM_MS = 2000;
/** OPFS calls in flight at once. */
const LANES = 32;

let disk: { home: FileSystemDirectoryHandle; blobs: FileSystemDirectoryHandle } | undefined;
let timer: ReturnType<typeof setTimeout> | undefined;
let saving = Promise.resolve();
let persisting: Promise<boolean> | undefined;
/** Ino -> the bytes its blob holds. A file's data is replaced, never changed in place. */
const saved = new Map<number, Uint8Array>();

/**
 * Load what OPFS kept from the last visit into memory, and save every change back from now on.
 * Stays in memory only where there is no OPFS or another tab already keeps it: then false.
 */
export function persist(): Promise<boolean> {
  return (persisting ??= load().then(
    () => disk !== undefined,
    () => {
      disk = undefined;
      return false;
    },
  ));
}

/** Save now instead of once writes go quiet. */
export function flush(): Promise<void> {
  clearTimeout(timer);
  // A failed save (a full disk, say) leaves `saved` as it was: the next one tries again.
  return (saving = saving.then(save).catch(() => {}));
}

async function load(): Promise<void> {
  if (
    typeof FileSystemFileHandle === "undefined" ||
    !("createWritable" in FileSystemFileHandle.prototype)
  )
    return;
  if (!(await claim())) return;
  const home = await (
    await navigator.storage.getDirectory()
  ).getDirectoryHandle("upm", { create: true });
  const blobs = await home.getDirectoryHandle("blobs", { create: true });
  let rows: Row[] = [];
  try {
    const file = await (await home.getFileHandle("meta.json")).getFile();
    rows = JSON.parse(await file.text()) as Row[];
  } catch {}
  const wanted = new Set(rows.filter((row) => row[1] === "f").map((row) => row[2]));
  const names: string[] = [];
  for await (const name of blobs.keys()) names.push(name);
  const data = new Map<number, Uint8Array>();
  await each(names, async (name) => {
    const ino = Number(name);
    if (!wanted.has(ino)) return blobs.removeEntry(name);
    const file = await (await blobs.getFileHandle(name)).getFile();
    data.set(ino, new Uint8Array(await file.arrayBuffer()));
  });
  const next = dir(0o755);
  const dirs = new Map<string, Dir>([["/", next]]);
  const nodes = new Map<number, Entry>();
  for (const [path, kind, ino, mode, mtime, ctime, target = ""] of rows) {
    const parent = dirs.get(dirname(path));
    if (!parent || (kind === "f" && !data.has(ino))) continue;
    let node = nodes.get(ino);
    if (!node) {
      const meta = { ino, mode, mtime, ctime };
      node =
        kind === "d"
          ? { kind: "dir", entries: new Map(), ...meta }
          : kind === "l"
            ? { kind: "link", target, ...meta }
            : { kind: "file", data: data.get(ino)!, ...meta };
      nodes.set(ino, node);
      inodes = Math.max(inodes, ino);
      clock = Math.max(clock, mtime, ctime);
    }
    if (node.kind === "dir") dirs.set(path, node);
    else if (node.kind === "file") saved.set(ino, node.data);
    parent.entries.set(basename(path), node);
  }
  root = next;
  changes++;
  disk = { home, blobs };
}

/** Blobs first, then the listing, then blobs nothing lists: a save cut short loses no entry. */
async function save(): Promise<void> {
  if (!disk) return;
  const { home, blobs } = disk;
  const rows: Row[] = [];
  const live = new Map<number, Uint8Array>();
  for (const [path, entry] of walk()) {
    const { ino, mode, mtime, ctime } = entry;
    const kind = entry.kind === "file" ? "f" : entry.kind === "dir" ? "d" : "l";
    rows.push(
      entry.kind === "link"
        ? [path, kind, ino, mode, mtime, ctime, entry.target]
        : [path, kind, ino, mode, mtime, ctime],
    );
    if (entry.kind === "file") live.set(ino, entry.data);
  }
  const fresh = [...live].filter(([ino, data]) => saved.get(ino) !== data);
  await each(fresh, async ([ino, data]) => {
    await write(await blobs.getFileHandle(String(ino), { create: true }), data);
    saved.set(ino, data);
  });
  await write(await home.getFileHandle("meta.json", { create: true }), JSON.stringify(rows));
  const dead = [...saved.keys()].filter((ino) => !live.has(ino));
  await each(dead, async (ino) => {
    saved.delete(ino);
    await blobs.removeEntry(String(ino)).catch(() => {});
  });
}

async function write(handle: FileSystemFileHandle, data: string | Uint8Array): Promise<void> {
  const stream = await handle.createWritable();
  await stream.write(data as FileSystemWriteChunkType);
  await stream.close();
}

/**
 * One tab keeps OPFS: two saving the same listing would drop each other's entries. Waits a
 * little, since on a reload the page before may not have let go yet.
 */
function claim(): Promise<boolean> {
  const locks = globalThis.navigator?.locks;
  if (!locks) return Promise.resolve(true);
  return new Promise((granted) => {
    locks
      .request("upm-fs", { signal: AbortSignal.timeout(CLAIM_MS) }, () => {
        granted(true);
        // Held for as long as the tab is open.
        return new Promise<void>(() => {});
      })
      .catch(() => granted(false));
  });
}

async function each<T>(items: T[], run: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  const lane = async () => {
    while (next < items.length) await run(items[next++]!);
  };
  await Promise.all(Array.from({ length: LANES }, lane));
}
