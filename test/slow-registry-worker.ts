// A registry worker that says hello at once and answers every question after
// `UPM_TEST_SLOW_MS`. Its manifests are marked deprecated "thread".
import process from "node:process";
import { parentPort, workerData } from "node:worker_threads";
import { pickManifest } from "../src/pick.ts";
import { createRegistry } from "../src/registry.ts";
import type { Answer, Question } from "../src/registry-pool.ts";

const port = parentPort!;
const slow = Number(process.env.UPM_TEST_SLOW_MS ?? 0);
const registry = createRegistry(workerData);
port.on("message", (q: Question) => {
  const name = q.op === "pick" ? q.spec.fetchName : q.name;
  const found =
    q.op === "pinned"
      ? registry.pinned(q.name, q.version)
      : q.op === "manifest"
        ? registry.manifest(q.name, q.version)
        : registry.view(name).then((view) => pickManifest(view, q.spec, q.options));
  found.then(
    (found) => {
      if (found) found.deprecated = "thread";
      setTimeout(() => port.postMessage({ id: q.id, found } satisfies Answer), slow);
    },
    (error: { message?: string; code?: string; status?: number }) => {
      const { message, code, status } = error;
      port.postMessage({ id: q.id, failed: { message: String(message ?? error), code, status } });
    },
  );
});
port.postMessage({ id: -1 } satisfies Answer);
