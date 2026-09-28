# upm

A minimal, zero-dependency, npm-registry-compatible package manager.

## Rules

- Keep the project small, minimal and fast.
- Zero runtime dependencies. Node builtins only.
- Use simple English. Add short comments only for what the code cannot explain.
- Keep this file current. Use the linked `.agents/` pages for deeper context, not
  source summaries, machine-specific numbers or completed work logs.
- upm installs upm. Dev dependencies come from `upm.lock`, never npm or pnpm installs.
  npm may run repo scripts.
- Do not run e2e tests on web, user will do it via their dev server and manual testing

## Fork conventions

This is the `@aryasaatvik/upm` fork of `unjs/upm`. Keep changes to upstream files small and put new behavior in new modules where practical. To sync, create `chore/upstream-<yyyy-mm-dd>` from `main`, merge `upstream/main`, check the fork diff and tests, then merge the sync branch back to `main`.

## Releases

Write pending release notes in `.tegami/YYYY-MM-DD-<id>.md` with a `packages` entry for `npm:@aryasaatvik/upm` and a patch, minor or major bump. Run `npm run release:check` and `npm run tegami -- publish --dry-run` before release review. Tegami opens a version PR against `main`; after it is merged, `publish.yml` uses npm trusted publishing. The owner makes the first `0.1.0` publish manually and configures the trusted publisher before automated publishing can work.

## Runtime boundary

No runtime `node:` imports. Get builtins lazily through `src/builtin.ts` so a command
loads only what it needs. `import type` from `node:` is fine.

Keep resolver and in-memory graph work usable off Node. Where Node and web APIs differ,
use `src/runtime.ts`, with Node as the fast path. Keep `Buffer` there. Where the call
is shared, use the global directly. On the resolver side, read `globalThis.process?.`
with a fallback. Filesystem installation may assume Node.

The package has two entries: `upm` (`src/index.ts`, the commands in `src/api.ts`) needs Node;
`upm/resolver` (`src/resolver.ts`) must stay portable and never import the commands. Public
functions never print: output belongs to `src/cli.ts`, messages to the caller's `log`.
A worker ships inside its pool's chunk (`src/workers.ts`, filled by `build.config.ts`), never
as a file of its own, so an app that bundles upm still starts its threads.

## Read as needed

- [.agents/status.md](.agents/status.md) — open gaps, scope limits and work worth exploring.
- [.agents/design.md](.agents/design.md) — lasting constraints and why they matter.
- [.agents/maintenance.md](.agents/maintenance.md) — development, validation and doc upkeep.
- [.agents/perf.md](.agents/perf.md) — how to test a performance idea fairly.
- [bench/README.md](bench/README.md) — benchmark runner and result tools.
