// A link worker for the failure paths. It loads and says so, then dies the instant it is
// handed the job `UPM_TEST_DIE` names (the shape an OOM kill has), and sleeps
// `UPM_TEST_SLEEP_MS` times the job id before any other, so a sibling shard of the same
// entry is still in flight when the pool lets go of the entry. With `UPM_TEST_MUTE` it
// loads, listens and never says hello — `all` of them, or only the first to load when the
// value is a directory to mark. Links as the real worker does.
import { linkSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { join, sep } from "node:path";
import process from "node:process";
import { parentPort } from "node:worker_threads";
import type { Shard } from "../src/link.ts";
import { linkArgs } from "../src/util.ts";

const port = parentPort;
const die = Number(process.env.UPM_TEST_DIE ?? -1);
const sleep = Number(process.env.UPM_TEST_SLEEP_MS ?? 0);
const mute = process.env.UPM_TEST_MUTE ?? "";
if (port && silent()) {
  port.on("message", () => {});
} else if (port) {
  port.postMessage({ id: -1 });
  port.on("message", ({ id, shard }: { id: number; shard: Shard }) => {
    if (id === die) process.exit(1);
    if (sleep * id > 0) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, sleep * id);
    try {
      port.postMessage({ id, done: run(shard) });
    } catch (error) {
      const { message, code } = error as { message?: string; code?: string };
      port.postMessage({ id, failed: { message: String(message ?? error), code } });
    }
  });
}

function silent(): boolean {
  if (mute === "all") return true;
  if (!mute) return false;
  try {
    mkdirSync(join(mute, "mute"));
    return true;
  } catch {
    return false;
  }
}

function run(shard: Shard): { linked: number; copied: number } {
  let { dirs, paths, blobs } = shard;
  // A small entry comes as its index path, as to the real worker: every directory of it
  // is made, deepest last, which one level of `sort` gives these fixtures.
  if (shard.index !== undefined) {
    const { files } = JSON.parse(readFileSync(shard.index, "utf8")) as {
      files: { path: string; blob: string }[];
    };
    const below = new Set<string>();
    for (const { path } of files) {
      for (let i = path.indexOf("/"); i !== -1; i = path.indexOf("/", i + 1)) {
        below.add(path.slice(0, i));
      }
    }
    dirs = [...dirs, ...[...below].sort().map((p) => `${shard.dir}${sep}${p}`)];
    paths = files.map((file) => file.path);
    blobs = files.map((file) => file.blob);
  }
  for (const dir of dirs) {
    try {
      mkdirSync(dir);
    } catch (error) {
      if ((error as { code?: string }).code !== "EEXIST") throw error;
    }
  }
  for (let i = 0; i < paths.length; i++) {
    const to = `${shard.dir}${sep}${paths[i]}`;
    try {
      linkSync(`${shard.blobDir}${sep}${blobs[i]}`, to);
    } catch (error) {
      const reason = (error as Error).message;
      throw Object.assign(new Error(`cannot link ${to}: ${reason}`), { code: "ELINK" });
    }
  }
  for (let i = 0; i < shard.symlinks.length; i += 2) {
    const at = shard.symlinks[i + 1]!;
    const [to, type] = linkArgs(shard.symlinks[i]!, at);
    symlinkSync(to, at, type);
  }
  const shims = shard.shims ?? [];
  for (let i = 0; i < shims.length; i += 2) writeFileSync(shims[i]!, shims[i + 1]!);
  return { linked: paths.length, copied: 0 };
}
