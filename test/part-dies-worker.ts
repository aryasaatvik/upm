// The real unpack worker, except that a thread handed a part of a big tarball dies with it —
// the parse went fine, and the death comes in the write phase, with other parts running.
import process from "node:process";
import { parentPort } from "node:worker_threads";

parentPort?.on("message", (message: { part?: unknown }) => {
  if (message.part) process.exit(1);
});
await import("../src/unpack-worker.ts");
