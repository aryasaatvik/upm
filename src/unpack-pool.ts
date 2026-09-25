// Tar parsing, hashing and writing are CPU work on tarballs that share nothing, and the store
// is content-addressed, so they can run anywhere. This hands tarballs to worker threads and
// keeps the main thread free to drive the network.
import type { Worker } from "node:worker_threads";
import { builtin } from "./builtin.ts";
import { cpus } from "./runtime.ts";
import type { PackageIndex } from "./store.ts";
import type { Part } from "./unpack.ts";
import { assemble, SHARD_MIN } from "./unpack.ts";
import type { Block, Ending, PartTask, UnpackFailure, UnpackTask } from "./unpack-worker.ts";
import { trace } from "./util.ts";
import { unpackWorker } from "./workers.ts";

/** Check a tarball against its integrity, then write its content. */
export type Unpack = (
  integrity: string,
  tarball: Uint8Array[],
  repair: boolean,
) => Promise<PackageIndex>;

export interface PoolOptions {
  /** Workers to run at most; they start as tarballs need them. 0 disables the pool. */
  size?: number;
  /** How many tarballs the caller has in flight; more workers than that would idle. */
  concurrency?: number;
  /**
   * Runs a tarball on this thread. A pool that breaks with tarballs still queued hands them
   * here rather than back: they were taken, and nothing has been done to them yet.
   */
  fallback?: Unpack;
  /** Told once when no thread would start: every tarball is then unpacked here. */
  noThreads?: () => void;
  /** Injectable for tests. */
  entry?: URL;
}

/** A big tarball on its way to a worker, block by block as it downloads. */
export interface Sink {
  push(block: Uint8Array): void;
  /** The last block is in: the index, once the worker has verified and written it all. */
  end(): Promise<PackageIndex>;
  /** The download failed; the worker drops what it had. */
  abort(): void;
}

export interface Pool {
  /**
   * Take a big tarball as it downloads, so its worker inflates it under the network instead
   * of after. Undefined when the pool is broken; a tarball this size is otherwise always worth
   * a thread, so one starts if none is free.
   */
  open(integrity: string, repair: boolean, size: number): Sink | undefined;
  /**
   * A promise when the pool took the tarball, undefined when the caller must unpack it. A
   * taken tarball waits for the next free worker, so every one goes to a thread while there
   * are threads to go to. `behind` is how many tarballs the caller still has to unpack, this
   * one included: it is what a new thread would be started for.
   */
  offer(
    integrity: string,
    tarball: Uint8Array[],
    repair: boolean,
    behind?: number,
  ): Promise<PackageIndex> | undefined;
  /**
   * Stop the threads. Idle ones go now and busy ones once they have answered; what is queued
   * still runs, on them or, with none left, here. Nothing is offered afterwards.
   */
  close(): void;
  /** Stop the threads now. What was taken and not done fails as a dead worker's would. */
  kill(): void;
}

/**
 * Where more threads stop helping. A small tarball is a few ms of work, so past this the pool
 * drains faster than the network fills it: on `nuxt` 8 workers beat 4 by 200 ms and 15 were
 * each half idle for no gain. Threads start on demand, so this is a ceiling `nuxt` reaches in
 * its first burst and a one-package install never comes near.
 */
const MAX_WORKERS = 8;

/**
 * Tarballs behind a tarball for each thread it may start. A thread is ~30 ms to boot, ~40 ms of
 * CPU and ~12 ms to tear down at exit, which is what unpacking eight small tarballs here costs;
 * an install of one or five packages is faster on this thread than any thread is to start.
 */
const PER_WORKER = 8;

/** Losing this many workers is a pool not worth offering to again, whatever is killing them. */
const MAX_DEATHS = 3;

/**
 * Threads one big tarball's files are spread over at most. `next` measured 4 at 270 ms against
 * 8 at 280 and 2 at 400: past four the writes contend for the disk and the shards' directories.
 */
const MAX_PARTS = 4;

/** Compressed bytes of a big tarball per helper thread its parts are worth. */
const HELPER_BYTES = 8 * 1024 * 1024;

/**
 * A worker died with a tarball in flight — an OOM kill is the realistic way. It reported
 * nothing, so the work is simply undone and the caller may redo it. Distinct from a failure the
 * worker reported, which is the work itself saying no and must never be retried into a success.
 */
export const WORKER_DIED = "EWORKERDIED";

interface Reply {
  index?: PackageIndex;
  failed?: UnpackFailure;
  /** A big tarball parsed and packed: each part is hashed and written by whichever thread is free. */
  parts?: Part[];
  /** One part's answer. */
  blobs?: string[];
}

interface Task {
  integrity: string;
  /** Whole, or for a stream the blocks landed before a worker took it. */
  tarball: Uint8Array[];
  repair: boolean;
  resolve: (index: PackageIndex | Promise<PackageIndex>) => void;
  reject: (error: Error) => void;
  /** Compressed bytes, as far as known: what decides how many threads it is worth. */
  size: number;
  /** A stream, and whether its last block is in. */
  stream?: { ended: boolean; worker?: Worker };
  /** Set once the tarball came back as parts. */
  shards?: { parts: Part[]; blobs: string[][]; left: number };
  settled?: boolean;
}

/** What a worker is handed: a whole tarball, or one part of a big one. */
interface Job {
  task: Task;
  part?: number;
}

export function createPool(dir: string, options: PoolOptions = {}): Pool {
  const size = options.size ?? poolSize(options.concurrency);
  let entry = options.entry;
  const idle: Worker[] = [];
  const busy = new Map<Worker, Job>();
  const alive = new Set<Worker>();
  const queue: Job[] = [];
  let deaths = 0;
  let ready = false;
  let first = false;
  let broken = size <= 0;
  let closing = false;
  /** Threads `close` let go: their exit is not a death. */
  const leaving = new Set<Worker>();

  /** More threads, up to the cap. ~40 ms of CPU and ~13 MB each, so only when asked. */
  function grow(count = 1): void {
    for (; count > 0; count--) start();
  }

  function start(): void {
    if (broken || closing || alive.size >= size) return;
    let worker: Worker;
    try {
      entry ??= unpackWorker();
      worker = new builtin.workers.Worker(entry, { workerData: { dir } });
    } catch {
      if (!ready && alive.size === 0) options.noThreads?.();
      giveUp();
      return;
    }
    alive.add(worker);
    trace(`unpack-start-${alive.size}`);
    trace("spawn", { w: worker.threadId, alive: alive.size });
    // Ref'd while it boots: a tarball queued before any thread is up refs nothing itself, and
    // would be an unsettled promise the process exits over. Its first message unrefs it, as
    // an idle worker must not hold the process open; `dispatch` refs a busy one again. Not
    // left to the `message` listener's port ref: a listener added before ours takes that.
    // The first message is the worker saying it loaded, so a thread that cannot start is
    // never handed a tarball — until then the bytes wait in the queue, still ours.
    worker.on("message", (reply: Reply) => {
      if (!idle.includes(worker) && !busy.has(worker)) trace(`unpack-ready-${alive.size}`);
      ready = true;
      const job = busy.get(worker);
      if (job && !first) {
        first = true;
        trace("unpack-first-done");
      }
      trace(job ? "reply" : "up", {
        w: worker.threadId,
        i: job?.task.integrity,
        part: job?.part,
        queue: queue.length,
      });
      busy.delete(worker);
      worker.unref();
      idle.push(worker);
      if (job) answer(job, reply);
      dispatch();
      if (closing && idle.includes(worker)) letGo(worker);
    });
    worker.on("error", () => retire(worker));
    worker.on("exit", () => retire(worker));
  }

  function retire(worker: Worker): void {
    // One death raises both `error` and `exit`; only the first of the two is a death.
    if (!alive.delete(worker)) return;
    const at = idle.indexOf(worker);
    if (at !== -1) idle.splice(at, 1);
    const job = busy.get(worker);
    busy.delete(worker);
    // The last thread dying before any has spoken means the entry itself is unusable (a bad
    // one is not waited on three times over), and one that keeps dying poisons the pool however
    // healthy each replacement looks on arrival. Anything else is replaced, if work waits.
    if (leaving.delete(worker)) {
      if (alive.size === 0) giveUp();
    } else if (!ready && alive.size === 0) {
      if (!broken) options.noThreads?.();
      giveUp();
    } else if (++deaths >= MAX_DEATHS) giveUp();
    else if (queue.length > 0 && !closing) grow();
    else if (alive.size === 0) giveUp();
    if (job) died(job.task);
    dispatch();
  }

  function letGo(worker: Worker): void {
    leaving.add(worker);
    void worker.terminate();
  }

  /** No more threads. What is queued was taken and is still whole, so it runs here instead. */
  function giveUp(): void {
    broken = true;
    const here = options.fallback;
    for (const { task, part } of queue.splice(0)) {
      // A part's bytes are in a buffer no fallback reads, and a stream's may still be on the
      // way; either tarball is refetched instead.
      if (part !== undefined || task.stream) died(task);
      else if (here) task.resolve(here(task.integrity, task.tarball, task.repair));
      else task.reject(rebuild({ message: "Unpack pool has no workers", code: WORKER_DIED }));
    }
  }

  function died(task: Task): void {
    fail(task, rebuild({ message: "Unpack worker died", code: WORKER_DIED }));
  }

  /** Reject once. Parts of it still queued are dropped; ones running finish harmlessly. */
  function fail(task: Task, error: Error): void {
    if (task.settled) return;
    task.settled = true;
    task.reject(error);
    drop(task);
    // Big files a part would have moved into place wait under temp names; nobody will now.
    for (const part of task.shards?.parts ?? []) {
      for (const file of part.files) {
        if (file.temp) builtin.fs.rmSync(file.temp, { force: true });
      }
    }
  }

  /** Forget a task's queued jobs. */
  function drop(task: Task): void {
    for (let at = queue.length - 1; at >= 0; at--) {
      if (queue[at]!.task === task) queue.splice(at, 1);
    }
  }

  function answer(job: Job, reply: Reply): void {
    const { task } = job;
    if (reply.failed) {
      fail(task, rebuild(reply.failed));
    } else if (job.part !== undefined) {
      const shards = task.shards!;
      shards.blobs[job.part] = reply.blobs ?? [];
      if (--shards.left === 0 && !task.settled) {
        task.settled = true;
        task.resolve(assemble(task.integrity, shards.parts, shards.blobs));
      }
    } else if (reply.parts) {
      // Ahead of whole tarballs waiting: the parts are the critical path, and threads for
      // them, up to the cap, are worth starting whatever is behind.
      task.shards = { parts: reply.parts, blobs: [], left: reply.parts.length };
      queue.unshift(...reply.parts.map((_, part) => ({ task, part })));
      grow(reply.parts.length - free());
    } else if (reply.index) {
      task.settled = true;
      task.resolve(reply.index);
    } else {
      fail(task, rebuild(undefined));
    }
  }

  /** Threads idle or still booting: what the queue can count on without starting more. */
  function free(): number {
    return alive.size - busy.size;
  }

  function dispatch(): void {
    while (queue.length > 0 && idle.length > 0) {
      const worker = idle.pop()!;
      const job = queue.shift()!;
      busy.set(worker, job);
      worker.ref();
      trace("dispatch", {
        w: worker.threadId,
        i: job.task.integrity,
        part: job.part,
        queue: queue.length,
        alive: alive.size,
        idle: idle.length,
      });
      send(worker, job, Math.min(size, MAX_PARTS));
      // A big tarball comes back as parts in a few hundred ms; the threads for them boot now.
      // Helpers are shared, so this is a total, not one set per big tarball.
      if (job.part === undefined) grow(1 + helpers(job.task) - alive.size);
    }
  }

  return {
    open(integrity, repair, size) {
      if (broken || closing) return undefined;
      const stream: Task["stream"] & object = { ended: false };
      let task!: Task;
      const index = new Promise<PackageIndex>((resolve, reject) => {
        task = { integrity, tarball: [], repair, resolve, reject, size, stream };
      });
      // Read by `end`; until then a failure has nobody to tell, and must not be an unhandled one.
      index.catch(() => {});
      queue.push({ task });
      dispatch();
      // A thread for it, and its helpers now rather than once its own thread has spoken: the
      // parts of `next`'s 40 MiB waited on one still starting. A stream under HELPER_BYTES is
      // not worth a boot of its own while a thread is alive: it waits for the next free one,
      // as an offered tarball would, and `nitro`'s 7.9 MiB booted a thread it never used.
      const worth = size >= HELPER_BYTES ? 1 + helpers(task) : alive.size === 0 ? 1 : 0;
      grow(worth - free());
      return {
        push(block) {
          if (task.settled) return;
          if (stream.worker) stream.worker.postMessage({ block } satisfies Block, owned([block]));
          else task.tarball.push(block);
        },
        end() {
          stream.ended = true;
          if (stream.worker && !task.settled) {
            stream.worker.postMessage({ end: true } satisfies Ending);
          }
          return index;
        },
        abort() {
          // A worker that already answered (or died) holds no feed for this stream, and by
          // now may hold another's: an abort sent there would cut that one off.
          if (task.settled) return;
          // Whatever the worker answers now is about bytes nobody wants.
          task.settled = true;
          if (stream.worker) stream.worker.postMessage({ abort: true } satisfies Ending);
          else drop(task);
        },
      };
    },
    offer(integrity, tarball, repair, behind = Infinity) {
      if (broken || closing) return undefined;
      // Threads this much work is worth. With none running and none worth starting, the
      // caller unpacks: a one-package install never boots a thread — unless the package is
      // a big tarball, which is worth a thread by itself.
      const worth = Math.min(size, Math.floor(behind / PER_WORKER));
      const compressed = sizeOf(tarball);
      trace("queued", {
        i: integrity,
        bytes: compressed,
        behind,
        worth,
        alive: alive.size,
        idle: idle.length,
        queue: queue.length,
      });
      if (alive.size === 0 && worth === 0 && compressed < SHARD_MIN) return undefined;
      return new Promise<PackageIndex>((resolve, reject) => {
        const task: Task = { integrity, tarball, repair, resolve, reject, size: compressed };
        queue.push({ task });
        dispatch();
        // A tarball no idle worker took starts one, while the work behind it is worth more:
        // `nuxt` is at the cap within its first burst, and a booting thread's tarball stays
        // in the queue until the thread has spoken.
        if (queue.length > 0 && (alive.size < worth || compressed >= SHARD_MIN)) grow();
      });
    },
    // An idle worker is unref'd, so a finished install could simply let the pool go; closing
    // it once the store is full has the isolates gone before exit, which was 8 ms of `nuxt`'s
    // teardown.
    close() {
      closing = true;
      for (const worker of idle.splice(0)) letGo(worker);
      if (alive.size === 0) giveUp();
    },
    kill() {
      // What is queued was taken and would otherwise hang; a busy thread's tarball is answered
      // `WORKER_DIED` by `retire` when the thread goes.
      giveUp();
      for (const worker of alive) void worker.terminate();
    },
  };
}

/** Never more workers than tarballs in flight, and the main thread still needs a core. */
export function poolSize(concurrency = 8): number {
  return Math.max(1, Math.min(concurrency, cpus() - 1, MAX_WORKERS));
}

function send(worker: Worker, { task, part }: Job, parts: number): void {
  if (part !== undefined) {
    const packed = task.shards!.parts[part]!;
    const message: PartTask = { part: packed, repair: task.repair };
    worker.postMessage(message, packed.data);
    return;
  }
  const { integrity, tarball, repair, stream } = task;
  if (stream) {
    // Open, then what landed while it waited; the rest comes straight from the download.
    stream.worker = worker;
    worker.postMessage({ integrity, repair, parts } satisfies UnpackTask);
    for (const block of tarball.splice(0)) {
      worker.postMessage({ block } satisfies Block, owned([block]));
    }
    if (stream.ended) worker.postMessage({ end: true } satisfies Ending);
    return;
  }
  worker.postMessage({ integrity, tarball, repair, parts } satisfies UnpackTask, owned(tarball));
}

/**
 * Buffers to move instead of copy: only a chunk that owns its whole buffer, since a small
 * Buffer is a window onto a shared pool, and transferring that detaches the pool. Distinct
 * buffers only — one ArrayBuffer twice in the list is a DataCloneError.
 */
function owned(chunks: Uint8Array[]): ArrayBuffer[] {
  const move = new Set<ArrayBuffer>();
  for (const chunk of chunks) {
    if (chunk.byteOffset === 0 && chunk.byteLength === chunk.buffer.byteLength) {
      move.add(chunk.buffer as ArrayBuffer);
    }
  }
  return [...move];
}

function sizeOf(tarball: Uint8Array[]): number {
  let compressed = 0;
  for (const block of tarball) compressed += block.byteLength;
  return compressed;
}

/** Threads besides its own a tarball's parts are worth: one per HELPER_BYTES, up to the cap. */
function helpers({ size }: Task): number {
  return Math.min(MAX_PARTS - 1, Math.floor(size / HELPER_BYTES));
}

function rebuild(failed: UnpackFailure | undefined): Error {
  const error = new Error(failed?.message ?? "Unpack worker returned nothing");
  return failed?.code ? Object.assign(error, { code: failed.code }) : error;
}
