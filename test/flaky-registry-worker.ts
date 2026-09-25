// A registry worker for the failure paths. It answers as the real one does, but dies the
// instant it is asked about the package `UPM_TEST_DIE_NAME` names (the shape an OOM kill
// has), rejects with a bare string for the package `UPM_TEST_THROW_NAME` names, and with
// `UPM_TEST_MUTE` it loads, listens and never says hello, and with `UPM_TEST_DEAF` it loads
// and never speaks at all. Every manifest it answers is marked
// deprecated "thread", so a test can tell its answers from the main thread's; for the package
// `gate` it answers with its share of the request gate as the version.
import process from "node:process";
import { parentPort, workerData } from "node:worker_threads";
import { pickManifest } from "../src/pick.ts";
import { createRegistry } from "../src/registry.ts";
import type { Answer, Question } from "../src/registry-pool.ts";
import type { Manifest } from "../src/types.ts";

const port = parentPort!;
const die = process.env.UPM_TEST_DIE_NAME ?? "";
const raw = process.env.UPM_TEST_THROW_NAME ?? "";
const registry = createRegistry(workerData);
port.on("message", (q: Question) => {
  if (process.env.UPM_TEST_DEAF) return;
  const name = q.op === "pick" ? q.spec.fetchName : q.name;
  if (name === die) process.exit(1);
  const found: Promise<Manifest | undefined> =
    name === raw
      ? Promise.reject("not an Error")
      : name === "gate"
        ? Promise.resolve({
            name,
            version: `${workerData.concurrency}/${workerData.start}/${workerData.min}`,
            dist: {},
          } as Manifest)
        : q.op === "pinned"
          ? registry.pinned(q.name, q.version)
          : q.op === "manifest"
            ? registry.manifest(q.name, q.version)
            : registry.view(name).then((view) => pickManifest(view, q.spec, q.options));
  found.then(
    (found) => {
      if (found) found.deprecated = "thread";
      port.postMessage({ id: q.id, found } satisfies Answer);
    },
    (error: { message?: string; code?: string; status?: number }) => {
      const { message, code, status } = error;
      const failed = { message: String(message ?? error), code, status };
      port.postMessage({ id: q.id, failed } satisfies Answer);
    },
  );
});
if (!process.env.UPM_TEST_MUTE && !process.env.UPM_TEST_DEAF) {
  port.postMessage({ id: -1 } satisfies Answer);
}
