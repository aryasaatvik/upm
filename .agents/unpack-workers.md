# Unpack workers: the tarball path on a cold install

What happens to a tarball between its first byte and its index (`src/store.ts`,
`src/unpack-pool.ts`, `src/unpack-worker.ts`, `src/unpack.ts`, `src/tar.ts`), and the link step
that follows. Traces, tables and the commands: [bench/results/2026-09-16-overnight.md](../bench/results/2026-09-16-overnight.md);
`UPM_TRACE` (perf.md) gives each tarball's path from miss to index.

## What is in the checkout

1. **Big files are spooled while the tarball inflates** (`stream` in `TarOptions`, `split` in
   `src/unpack.ts`). A file of `SHARD_MIN` or more is not buffered: the tar reader hands its
   chunks to a consumer that hashes them and writes them to `files/<pid>-*.tmp` while the inflate
   runs; `writePart` renames it to its blob once the tarball has verified, and a failed tarball, a
   stream that fails after its parse, or a dead helper removes the temps. design.md states the
   rule: nothing is addressable before integrity has passed; `prune` sweeps what a killed process
   leaves.
2. **Tarballs stream to a worker from `STREAM_MIN`** (`src/store.ts`, the same size as
   `SHARD_MIN`); helpers are added per `HELPER_BYTES`. A stream under `HELPER_BYTES` boots a
   thread only when none is alive, otherwise it waits for the next free one: a lower threshold had
   booted a second thread it never used.
3. **Index misses from one shard listing** (`listShards` in `src/store.ts`): a cold store has no
   shard directory for most of what an install asks, and a failing read per miss was main-thread
   time under load. Folded to one case for case-insensitive disks (over-approximates only). A
   shard another process creates mid-install is missed until then (a refetch, correct).
4. **Each entry is linked as its tarball lands** (`awaiting` in `LinkOptions`, `Store.pending`).
   The linker builds the entry list from the keys first, then waits per entry for its own index
   and its direct dependencies' fate (stored or dropped optional), so the tree is what it was; the
   pool is asked with the files landed so far. This is what hides the link once the walk gets
   faster.

On `nuxt`-shaped trees the tarball side is not the critical path; on `next`-shaped ones the tail
is the big tarballs' inflate and the hash of their biggest files. Stores, indexes and trees must
stay identical between builds; compare them, not only the wall time.

## What lost

- Closing the unpack pool right after the fill with the link after it: the teardown landed on
  the main thread while it linked. The close stays only because the link now runs under the
  fill and the close drains gracefully (design.md).
- 12 or 15 unpack workers: a small wall gain for much more RSS and CPU. 8 stays.
- Another file digest: this CPU has no SHA-NI, sha512 is already the best SHA here, and blake2b
  would save little worker CPU. Not worth a store keyed differently.
- Inflate read-ahead (`readableHighWaterMark`): noise. `gunzipSync` in a worker: slower than the
  stream past a few MiB.
- Not done: progressive parts for the biggest tarballs would overlap the hash and write with the
  inflate, but only if helpers write before the tarball's sha512 is checked, against design.md's
  rule (status.md). Index writes on main, a faster pool ramp and the write cost in workers
  (`mkdir -p` per shard per worker, three syscalls per file) are not on the critical path today.

## Untested and risks

- The spool is Node-only (the worker); the portable reader still buffers whole files.
- CPU-limited machines (fewer cores than workers); macOS/Windows (the temp rename follows
  `writeInto`'s path through `adopt`); trees of many tarballs between `STREAM_MIN` and
  `HELPER_BYTES` (each streams).
- A worker killed mid-split leaves its `.tmp` at the `files/` root until `prune` runs.
