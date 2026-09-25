#!/usr/bin/env node
// `upx <command>` is `upm exec <command>`, as `npx` is `npm exec`. An entry of its own, not
// a check of argv[1]'s name: npm's Windows shims start `node upm.mjs` and lose the name.
// Imported, not `import`ed at the top, so that `cli.ts` stays out of this entry's static graph.
const { main } = await import("./cli.ts");
const code = await main(["exec", ...(globalThis.process?.argv?.slice(2) ?? [])]);
if (globalThis.process) globalThis.process.exitCode = code;
