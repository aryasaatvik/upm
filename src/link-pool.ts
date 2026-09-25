// A fixed set of worker threads that run link shards (src/link-worker.ts). Started early, while
// the lockfile and store indexes are still being read, so the 40–80 ms the threads take to
// come up on other cores has passed before the first entry is built. Loaded only when the
// pool is on: `worker_threads` is not resident otherwise.
import type { Worker } from "node:worker_threads";
import { builtin } from "./builtin.ts";
import type { LinkPool, Shard, ShardResult } from "./link.ts";
import type { ShardReply } from "./link-worker.ts";
import { trace } from "./util.ts";
import { linkWorker } from "./workers.ts";

/**
 * A worker died with shards in flight. They reported nothing, so the caller redoes them
 * itself; distinct from a failure a worker reported, which is the work itself saying no.
 * Spelled out rather than imported from link.ts, which would make the bundler split the
 * linker out of `dist/upm.mjs` into a chunk every command then loads.
 */
const WORKER_DIED = "EWORKERDIED";

/**
 * Files a worker may hold unanswered before the next shard waits for another worker. The
 * first thread to come up would otherwise be handed the whole queue — eight thousand-file
 * shards of one package, run one after another on one core — while the other seven boot.
 * Low enough to spread big shards one per worker, high enough that a worker fed eight-file
 * shards has a few milliseconds queued while this thread is busy planning the next entries.
 */
const BUSY = 256;

/**
 * How long a thread may take to say hello. One that loads but never speaks would otherwise
 * hang the install: its message listener refs it and nothing is ever handed to it. A boot is
 * 40–80 ms on a free core; ten seconds is a stuck thread, not a slow one.
 */
const BOOT_MS = 10_000;

interface Job {
  shard: Shard;
  /** Files, so a thousand-file shard and an eight-file one weigh differently. */
  weight: number;
  resolve: (result: ShardResult) => void;
  reject: (error: Error) => void;
}

interface Slot {
  worker: Worker;
  /** It has said hello: a thread still booting is given nothing, whatever its queue. */
  ready: boolean;
  /** Weight in flight on this worker, for choosing the emptiest. */
  load: number;
  pending: Map<number, Job>;
}

/**
 * Undefined when this runtime has no `worker_threads` or a thread cannot be started.
 * `noThreads` is told once when no thread would start, so every entry is built here.
 */
export function startLinkPool(
  size: number,
  entry?: URL,
  bootMs: number = BOOT_MS,
  noThreads?: () => void,
): LinkPool | undefined {
  const slots: Slot[] = [];
  const queue: Job[] = [];
  trace("link-start");
  let seq = 0;
  let broken = false;
  let spoke = false;
  // One timer for the pool, never holding the process open: a thread still silent when it
  // fires is terminated, and its `exit` retires it like any other death. Nothing was ever
  // handed to it, so no shard is lost; with no thread left the queue is refused and the
  // caller builds here.
  const boot = setTimeout(() => {
    for (const slot of slots) if (!slot.ready) void slot.worker.terminate();
  }, bootMs).unref();
  try {
    entry ??= linkWorker();
    for (let i = 0; i < size; i++) {
      const worker = new builtin.workers.Worker(entry);
      const slot: Slot = { worker, ready: false, load: 0, pending: new Map() };
      // Ref'd while it boots, as shards queue for it; a message that leaves it idle unrefs
      // it, and one with work is ref'd in `dispatch`. Not left to the `message` listener's
      // port ref: a listener added before ours takes that.
      worker.on("message", (reply: ShardReply) => {
        // The first message is the worker saying it loaded; a thread that cannot load dies
        // instead, and until one has spoken nothing is handed to it.
        if (!slot.ready) trace("link-ready");
        slot.ready = spoke = true;
        if (slots.every((other) => other.ready)) clearTimeout(boot);
        if (reply.id !== -1) {
          const job = slot.pending.get(reply.id);
          if (!job) return;
          slot.pending.delete(reply.id);
          slot.load -= job.weight;
          if (reply.done) job.resolve(reply.done);
          else job.reject(rebuild(reply.failed));
        }
        if (slot.pending.size === 0) worker.unref();
        pump();
      });
      worker.on("error", () => retire(slot));
      worker.on("exit", () => retire(slot));
      slots.push(slot);
    }
  } catch {
    clearTimeout(boot);
    broken = true;
    for (const { worker } of slots) void worker.terminate();
    noThreads?.();
    return undefined;
  }

  /** One death raises both `error` and `exit`; the second finds nothing pending. */
  function retire(slot: Slot): void {
    const at = slots.indexOf(slot);
    if (at !== -1) slots.splice(at, 1);
    const died = Object.assign(new Error("link worker died"), { code: WORKER_DIED });
    for (const job of slot.pending.values()) job.reject(died);
    slot.pending.clear();
    if (slots.length > 0) {
      pump();
      return;
    }
    if (!broken && !spoke) noThreads?.();
    broken = true;
    for (const job of queue.splice(0)) job.reject(died);
  }

  function dispatch(slot: Slot, job: Job): void {
    const id = seq++;
    slot.pending.set(id, job);
    slot.load += job.weight;
    slot.worker.ref();
    slot.worker.postMessage({ id, shard: job.shard });
  }

  /**
   * Queued shards go to the emptiest ready worker that is not full. While none is ready — the
   * threads are still booting — they wait. Keep the main thread free to dispatch once ready.
   */
  function pump(): void {
    while (queue.length > 0) {
      let least: Slot | undefined;
      for (const slot of slots) {
        if (slot.ready && (!least || slot.load < least.load)) least = slot;
      }
      if (!least || least.load >= BUSY) break;
      dispatch(least, queue.shift()!);
    }
  }

  return {
    size,
    run(shard) {
      if (broken) return undefined;
      return new Promise<ShardResult>((resolve, reject) => {
        queue.push({ shard, weight: shard.paths.length + 1, resolve, reject });
        pump();
      });
    },
    close() {
      broken = true;
      clearTimeout(boot);
      for (const { worker } of slots.splice(0)) void worker.terminate();
    },
  };
}

function rebuild(failed: ShardReply["failed"]): Error {
  const error = new Error(failed?.message ?? "link worker returned nothing");
  return failed?.code ? Object.assign(error, { code: failed.code }) : error;
}
