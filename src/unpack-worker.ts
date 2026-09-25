// Worker entry for the unpack pool. One tarball in, one index out; the content it writes
// goes straight to the store, which is content-addressed and needs no coordination. A big
// tarball arrives block by block while it downloads, so inflating it overlaps the network,
// and comes back as parts: each is then one message to whichever thread is free, since
// hashing and writing 182 MiB of files is where `next` spent its serial tail.
import { builtin } from "./builtin.ts";
import { createVerifier } from "./integrity.ts";
import type { Part } from "./unpack.ts";
import { assemble, createWriter, SHARD_MIN, verifyTarball } from "./unpack.ts";
import { flushTrace, now, take, tick, trace, tracing } from "./util.ts";

/** A whole tarball, or the opening of one that streams in as `Block`s. */
export interface UnpackTask {
  integrity: string;
  tarball?: Uint8Array[];
  repair: boolean;
  /** Parts the pool can find threads for; 1 means write everything here. */
  parts: number;
}

export interface Block {
  block: Uint8Array;
}

/** The stream is whole, or the download failed and nothing of it is wanted. */
export type Ending = { end: true } | { abort: true };

export interface PartTask {
  part: Part;
  repair: boolean;
}

/** An Error does not survive structured clone, so the two fields callers read travel by hand. */
export interface UnpackFailure {
  message: string;
  code?: string;
}

/** A stream's blocks, hashed as they come, read by the parse as an async iterable. */
interface Feed {
  source: AsyncIterable<Uint8Array>;
  push(block: Uint8Array): void;
  end(): void;
  fail(error: Error): void;
  /** Settles when the last block is in, or the stream is abandoned. */
  landed: Promise<void>;
  verify(): Promise<void>;
}

const port = builtin.workers.parentPort;
if (port) {
  // Before the first task: the tracer is a lazy chunk, loaded only under its env.
  if (tracing) await import("./trace.ts");
  const writer = createWriter((builtin.workers.workerData as { dir: string }).dir, {
    blocking: true,
  });
  let feed: Feed | undefined;
  // The pool counts a worker as usable only once it has spoken, so say so before waiting for
  // work: a thread that cannot load dies instead, and its tarball is unpacked by the caller.
  port.postMessage({});
  port.on("message", (message: UnpackTask | Block | Ending | PartTask) => {
    // A block for a stream this thread already answered (failed, or aborted) has nowhere to go.
    if ("block" in message) return feed?.push(message.block);
    if ("end" in message) return feed?.end();
    if ("abort" in message)
      return feed?.fail(Object.assign(new Error("Aborted"), { code: "EABORT" }));
    const t0 = tracing ? now() : 0;
    run(message).then(
      ({ transfer, ...reply }) => {
        if (tracing) {
          const i = "part" in message ? "part" : message.integrity;
          trace("done", {
            i,
            ms: now() - t0,
            files: reply.index?.files.length ?? reply.parts?.length ?? reply.blobs?.length,
            ...take(),
          });
          flushTrace();
        }
        port.postMessage(reply, transfer ?? []);
      },
      (error: unknown) => {
        const { message, code } = error as { message?: string; code?: string };
        port.postMessage({ failed: { message: String(message ?? error), code } });
      },
    );
  });

  async function run(task: UnpackTask | PartTask) {
    if ("part" in task) return { blobs: await writer.writePart(task.part, task.repair) };
    const { integrity, tarball, repair } = task;
    let parts: Part[] | undefined;
    if (tarball) {
      await verifyTarball(integrity, tarball);
      let compressed = 0;
      for (const block of tarball) compressed += block.byteLength;
      if (task.parts <= 1 || compressed < SHARD_MIN) {
        return { index: await writer.unpack(integrity, tarball, repair) };
      }
      parts = await writer.split(each(tarball), task.parts);
    } else {
      // Hashed as the blocks land and parsed as they inflate; the hash is checked once the
      // last one is in, before a byte is written. A parse that stops at the archive's end
      // marker leaves the trailing blocks unread, so the feed hashes, not the parse.
      feed = createFeed(integrity);
      const split = writer.split(feed.source, task.parts);
      try {
        [parts] = await Promise.all([split, feed.landed]);
        await feed.verify();
      } catch (error) {
        // Big files were spooled to temp names as they inflated; a tarball that failed leaves
        // none. The split may have finished before the stream failed: its parts hold the names.
        writer.discard(await split.catch(() => []));
        throw error;
      } finally {
        feed = undefined;
      }
    }
    // One part is this thread's own work; more go back, their buffers moved rather than copied.
    if (parts.length === 1) {
      return { index: assemble(integrity, parts, [await writer.writePart(parts[0]!, repair)]) };
    }
    return { parts, transfer: parts.flatMap((part) => part.data) };
  }
}

function createFeed(integrity: string): Feed {
  const verifier = createVerifier(integrity);
  const blocks: Uint8Array[] = [];
  let done = false;
  let error: Error | undefined;
  let wake: (() => void) | undefined;
  let settle!: { resolve: () => void; reject: (error: Error) => void };
  const landed = new Promise<void>((resolve, reject) => (settle = { resolve, reject }));
  // The parse may have stopped reading before the stream failed; nobody is left to hear it.
  landed.catch(() => {});
  async function* source(): AsyncGenerator<Uint8Array> {
    for (;;) {
      if (blocks.length > 0) yield blocks.shift()!;
      else if (error) throw error;
      else if (done) return;
      else await new Promise<void>((resolve) => (wake = resolve));
    }
  }
  return {
    source: source(),
    landed,
    verify: () => verifier.verify(),
    push(block) {
      verifier.update(block);
      blocks.push(block);
      wake?.();
    },
    end() {
      done = true;
      if (tracing) tick("lastBlockAt", now());
      wake?.();
      settle.resolve();
    },
    fail(failure) {
      error = failure;
      wake?.();
      settle.reject(failure);
    },
  };
}

async function* each(blocks: Uint8Array[]): AsyncGenerator<Uint8Array> {
  for (const block of blocks) yield block;
}
