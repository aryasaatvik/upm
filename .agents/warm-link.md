# Warm and repeat install time (link phase, startup, exit)

What a warm install (lock and store kept, `node_modules` gone) and a repeat install (nothing to
do) pay, and what moved it. Phase tables, numbers and the commands:
[bench/results/2026-09-16-overnight.md](../bench/results/2026-09-16-overnight.md); `UPM_PHASES=1`
(perf.md) prints the marks. Single-fixture medians drift between sessions, so quote only paired
differences.

## What is in the checkout

1. **`shortHash` is sync on Node** (`src/runtime.ts`): `crypto.hash` directly, no encode and
   await per call, which cost an order of magnitude more than the hash itself.
2. **Fewer chunks** (`build.config.ts`): shared code in `limit`, `unpack`, `registry`, `resolve`
   and `main` rather than one chunk per module; workers still load only their chunk, and
   `test/dist.test.ts` fails if a worker or `resolver.mjs` ever imports `main`.
3. **The link pool starts off what the tree will need** (`linkPool` and `neutral` in `src/api.ts`,
   `Store.indexSize`): on a fresh tree by the walk's on-platform picks (cold), by the lockfile's
   neutral package count or a file count estimated from each index file's size (warm), or by the
   linker's real file count — once with every index in hand, or per landed count under a filling
   store. The module is preloaded at the state read so the start does not wait on a busy main
   thread. The thresholds are the `--experimental-link-pool` defaults in `src/cli.ts`.
4. **Repeat fast path** (`inputsHash` in `src/state.ts`, `inputsOf` in `src/api.ts`,
   `treeStanding` in `src/link.ts`): the state records a hash over what the resolution is a
   function of (design.md lists it) plus the install summary, the root's direct links and bins,
   and the two files' stat stamps. An install with the same stamps (or, failing that, the same
   hash) checks the root links, `.bin` and `.store` entries and returns: no lockfile parse,
   resolution or `stateHash`. Not with workspaces, `add`/`remove`/`dedupe` or `--verify`.
5. **Small entries go to the pool by index path** (`SMALL_INDEX` in `src/link.ts`, `Shard.index`,
   `Store.ensure`): an entry whose index is at most `SHARD_FILES` files by size is sent as its
   index path and the worker reads it, so the main thread no longer reads every index in the
   fill. A torn required index now fails in the worker and is repaired by the verifying refill
   (status.md has the cost); an optional's is still read in the fill and dropped as before.
6. **Compile cache in the bin** (`src/upm.ts` is the bootstrap, the program is `src/cli.ts`):
   `module.enableCompileCache` before the dynamic import; `NODE_DISABLE_COMPILE_CACHE=1` gives
   the old startup. Paths spelled rather than `join`ed in `plan`; `Store.indexPath` memoized.

Everything on a warm install is cold code: validation of a big lockfile is the interpreter
running each function once. Materialize on a big tree is bound by main-thread coordination
(plan, `postMessage`, renames), not by syscalls: raw `link()` scales across threads on ext4. A
small tree's materialize is at the single-thread syscall floor, so a pool cannot help it.

## What lost

- More link workers: 8 against 4 a wash on wall for much more RSS and CPU; 2 slower. Linker
  concurrency past 16: no better.
- Batched link dispatch with worker-side rename: a wash at four workers; reverted.
- A pool for small trees: slower than the main thread. A speculative pool start at the state
  read, and the main thread running shards while workers boot: both slower.
- V8 flags (`--always-sparkplug`, `--min-semi-space-size`, `--no-lazy`): all slower.
- One chunk for everything: workers then load the whole program.

## Untested and risks

- Windows and macOS: the state's `root.links` are compared as `readLink` returns them;
  index-path shards use `sep` as the worker did before.
- The compile cache writes under `~/.upm/compile-cache` on the first run of each build; no
  eviction.
- `Store.ensure` trusts an index file's presence when not verifying; `--verify` still parses.
- A new input to the resolution (say a new `.npmrc` key that changes hosts) must be added to
  `inputsOf` in `src/api.ts`, or the short check lies.
