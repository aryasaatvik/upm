// A worker entry that takes its time to load: the pool must keep the process alive for a
// tarball it queued before any thread has spoken, and let it go once the reply is in.
import { parentPort } from "node:worker_threads";

const port = parentPort;
if (port) {
  setTimeout(() => {
    port.postMessage({});
    port.on("message", () => port.postMessage({ index: { files: [], bin: {}, unpackedSize: 0 } }));
  }, 300);
}
