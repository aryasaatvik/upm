// Where each worker thread starts. In `src/`, the worker's .ts file beside this one. The build
// gives each pool its own copy of this module instead, holding its worker bundled whole and
// started as a `data:` URL (build.config.ts): a bundler that takes upm into an app copies no
// file of ours, and may not even keep `import.meta.url`.
export const unpackWorker = (): URL => new URL("./unpack-worker.ts", import.meta.url);
export const linkWorker = (): URL => new URL("./link-worker.ts", import.meta.url);
export const registryWorker = (): URL => new URL("./registry-worker.ts", import.meta.url);
