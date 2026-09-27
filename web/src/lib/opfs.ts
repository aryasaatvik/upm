// What this browser keeps on OPFS between visits: upm's store backend, the content every install
// downloaded (`upm-store/`), and the registry documents the resolver read (`upm-docs/`).
//
// A backend key `<dir>/<name>` is the file `upm-store/<dir>/<name>`. A key's value never
// changes, so tabs share them with no lock: a write lands whole on `close()`, and upm sets a
// package's index last, once its blobs are all in.
import { concat, shortHash } from "upm/src/runtime.ts";
import type { StoreBackend } from "upm/src/store-backend.ts";

const DIR = "upm-store";
/** OPFS calls in flight at once, across every package and tab's install. */
const LANES = 32;

let opened: Promise<FileSystemDirectoryHandle | undefined> | undefined;

/** The backend, or undefined where there is no OPFS. Read-only where files cannot be written. */
export async function opfsBackend(): Promise<StoreBackend | undefined> {
  const home = await (opened ??= open());
  if (!home) return undefined;
  const dirs = new Map<string, Promise<FileSystemDirectoryHandle>>();
  /** A key's directory and file name. */
  const at = async (key: string): Promise<[FileSystemDirectoryHandle, string]> => {
    const slash = key.indexOf("/");
    const name = key.slice(slash + 1);
    const dir = key.slice(0, slash);
    let handle = dirs.get(dir);
    if (!handle) dirs.set(dir, (handle = home.getDirectoryHandle(dir, { create: true })));
    return [await handle, name];
  };
  const get = (key: string) => lane(async () => read(...(await at(key))));
  const writable =
    typeof FileSystemFileHandle !== "undefined" &&
    "createWritable" in FileSystemFileHandle.prototype;
  return {
    // Same origin, same disk: as safe from damage as upm's own store would be.
    trusted: true,
    // Local and fast: the lanes, not the package count, are what bound it.
    concurrency: LANES,
    get,
    getMany: (keys) => Promise.all(keys.map(get)),
    set: writable
      ? (key, value) =>
          lane(async () => {
            const [dir, name] = await at(key);
            // One a closed tab cut short is not its size, and is written again.
            if (await find(dir, name, value.length)) return;
            await write(dir, name, value);
          }, LATER)
      : undefined,
  };
}

let asked = false;

/**
 * Ask the browser, once a page, not to evict OPFS when the disk runs low. Chrome decides on
 * its own, Firefox asks the user; either may say no, and the store stays best-effort.
 */
export function persist(): void {
  if (asked) return;
  asked = true;
  const storage = navigator.storage;
  void storage
    ?.persisted?.()
    .then((kept) => kept || storage.persist())
    .catch(() => {});
}

async function open(): Promise<FileSystemDirectoryHandle | undefined> {
  try {
    const root = await navigator.storage.getDirectory();
    // The whole-filesystem snapshot this replaced.
    void root.removeEntry("upm", { recursive: true }).catch(() => {});
    return await root.getDirectoryHandle(DIR, { create: true });
  } catch {
    return undefined;
  }
}

/** A file, or undefined when it is missing or not `size` long. */
async function find(
  dir: FileSystemDirectoryHandle,
  name: string,
  size?: number,
): Promise<File | undefined> {
  try {
    const file = await (await dir.getFileHandle(name)).getFile();
    return size === undefined || file.size === size ? file : undefined;
  } catch {
    return undefined;
  }
}

async function read(dir: FileSystemDirectoryHandle, name: string): Promise<Uint8Array | undefined> {
  const file = await find(dir, name);
  return file && new Uint8Array(await file.arrayBuffer());
}

async function write(
  dir: FileSystemDirectoryHandle,
  name: string,
  data: Uint8Array,
): Promise<void> {
  const stream = await (await dir.getFileHandle(name, { create: true })).createWritable();
  await stream.write(data as FileSystemWriteChunkType);
  await stream.close();
}

// --- Registry documents ---

/**
 * `fetch` for the resolver, answering a registry document from OPFS while the registry's
 * `max-age` lasts, or for a day for a version's own document, which the registry sends with no
 * `max-age` though a published version never changes. After that the request goes out as before: the registry exposes no `etag`
 * to a page, and a conditional request would need a preflight it refuses, so revalidating is
 * left to the browser's HTTP cache. Nor can it read `age`, so a copy a CDN had already aged
 * counts as fresh from when it landed here. A document is kept once it was read to the end: the
 * resolver stops reading some early, once it has the version it wanted.
 */
export function cachedFetch(fetch: typeof globalThis.fetch): typeof globalThis.fetch {
  return async (input, init) => {
    const url = input instanceof Request ? input.url : String(input);
    const accept = new Headers(init?.headers).get("accept") ?? "";
    const dir = init?.method && init.method !== "GET" ? undefined : await (docs ??= openDocs());
    if (!dir) return await fetch(input, init);
    const name = await shortHash(`${accept} ${url}`);
    const kept = await lane(() => readDoc(dir, name, url, accept));
    if (kept) {
      return new Response(kept.body as unknown as BodyInit, {
        headers: { "content-type": kept.type },
      });
    }
    const response = await fetch(input, init);
    const control = response.headers.get("cache-control") ?? "";
    const maxAge = Number(/max-age=(\d+)/i.exec(control)?.[1]) || (pinned(url) ? DAY : 0);
    if (response.status !== 200 || !response.body || !maxAge) return response;
    const type = response.headers.get("content-type") ?? "";
    const head = new TextEncoder().encode(
      `${JSON.stringify({ url, accept, type, at: Date.now(), maxAge })}\n`,
    );
    const keep = (chunks: Uint8Array[]) =>
      void lane(() => write(dir, name, concat([head, ...chunks])), LATER).catch(() => {});
    const { status, statusText, headers } = response;
    // A small one is read to the end here whatever the resolver reads; a big one only as far as
    // the resolver reads it, which is all its early stop saves.
    const size = Number(headers.get("content-length"));
    if (size > 0 && size <= WHOLE) {
      const [mine, theirs] = response.body.tee();
      void new Response(mine).arrayBuffer().then(
        (bytes) => keep([new Uint8Array(bytes)]),
        () => {},
      );
      return new Response(theirs, { status, statusText, headers });
    }
    const chunks: Uint8Array[] = [];
    const body = response.body.pipeThrough(
      new TransformStream<Uint8Array, Uint8Array>({
        transform(chunk, controller) {
          chunks.push(chunk);
          controller.enqueue(chunk);
        },
        flush: () => keep(chunks),
      }),
    );
    return new Response(body, { status, statusText, headers });
  };
}

/** How long a version's own document is kept: published, it never changes but for `deprecated`. */
const DAY = 24 * 60 * 60;
/** Documents up to this size are kept even when the resolver stops reading them early. */
const WHOLE = 256 * 1024;

/** Whether a url is a published version's own document: `/<name>/<version>`. */
function pinned(url: string): boolean {
  const parts = new URL(url).pathname.split("/").filter(Boolean);
  return parts.length === 2 && /^\d+\.\d+\.\d+/.test(parts[1]!);
}

interface Head {
  url: string;
  accept: string;
  type: string;
  at: number;
  maxAge: number;
}

let docs: Promise<FileSystemDirectoryHandle | undefined> | undefined;

async function openDocs(): Promise<FileSystemDirectoryHandle | undefined> {
  const writable =
    typeof FileSystemFileHandle !== "undefined" &&
    "createWritable" in FileSystemFileHandle.prototype;
  if (!writable) return undefined;
  try {
    const dir = await (
      await navigator.storage.getDirectory()
    ).getDirectoryHandle("upm-docs", {
      create: true,
    });
    void sweep(dir);
    return dir;
  } catch {
    return undefined;
  }
}

/** A kept document still fresh, or undefined. A torn or foreign file is a miss. */
async function readDoc(
  dir: FileSystemDirectoryHandle,
  name: string,
  url: string,
  accept: string,
): Promise<{ type: string; body: Uint8Array } | undefined> {
  const data = await read(dir, name);
  const end = data?.indexOf(10) ?? -1;
  if (!data || end < 0) return undefined;
  try {
    const head = JSON.parse(new TextDecoder().decode(data.subarray(0, end))) as Head;
    if (head.url !== url || head.accept !== accept) return undefined;
    if (Date.now() - head.at >= head.maxAge * 1000) return undefined;
    return { type: head.type, body: data.subarray(end + 1) };
  } catch {
    return undefined;
  }
}

/** Once a load, in the background: a document older than any it keeps is dead. */
async function sweep(dir: FileSystemDirectoryHandle): Promise<void> {
  const old = Date.now() - DAY * 1000;
  try {
    const files: FileSystemFileHandle[] = [];
    for await (const handle of dir.values()) if (handle.kind === "file") files.push(handle);
    for (const handle of files) {
      await lane(async () => {
        if ((await handle.getFile()).lastModified < old) await dir.removeEntry(handle.name);
      }, LATER);
    }
  } catch {}
}

// --- Lanes ---

/** What the page waits on goes first; writes behind it. */
const NOW = 0;
const LATER = 1;

let busy = 0;
const waiting: [(() => void)[], (() => void)[]] = [[], []];

/** Run `task` in one of the `LANES`, shared by every call of this module. */
async function lane<T>(task: () => Promise<T>, priority = NOW): Promise<T> {
  if (busy >= LANES) await new Promise<void>((go) => waiting[priority]!.push(go));
  else busy++;
  try {
    return await task();
  } finally {
    const next = waiting[NOW].shift() ?? waiting[LATER].shift();
    if (next) next();
    else busy--;
  }
}
