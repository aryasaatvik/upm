// A worker entry that loads, says so, then dies the instant it is handed a tarball — the shape
// an OOM kill has: no reply, no error, the thread simply gone with the work in it.
import process from "node:process";
import { parentPort } from "node:worker_threads";

const port = parentPort;
if (port) {
  port.postMessage({});
  port.on("message", () => process.exit(1));
}
