// The real unpack worker, leaving a mark per thread started so a test can count them. The
// first mark is on disk before the thread has said it loaded, the second after.
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { threadId, workerData } from "node:worker_threads";

mkdirSync(join((workerData as { dir: string }).dir, "workers", String(threadId)), {
  recursive: true,
});
await import("../src/unpack-worker.ts");
// Loading posted the hello, so a thread marked here is one the pool can count as idle.
mkdirSync(join((workerData as { dir: string }).dir, "loaded", String(threadId)), {
  recursive: true,
});
