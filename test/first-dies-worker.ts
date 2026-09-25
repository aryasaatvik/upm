// The first thread to load dies before it speaks; every later one is the real unpack worker.
// One bad boot among several is a death, not proof that the entry cannot load.
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import process from "node:process";
import { workerData } from "node:worker_threads";

try {
  mkdirSync(join((workerData as { dir: string }).dir, "first-death"));
  process.exit(1);
} catch {
  await import("../src/unpack-worker.ts");
}
