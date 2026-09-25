# The metadata walk on a cold install

What holds the end of the walk on a cold install, and what moved it. The timelines, tables and
the commands that made them: [bench/results/2026-09-16-overnight.md](../bench/results/2026-09-16-overnight.md).
`bench/ab.sh lock` is the walk without the install's own main-thread load.

## What is in the checkout

1. **Whole request gate per registry thread** (`shares` in `src/registry-pool.ts`). The walk's
   own 32-slot pick gate already bounds what is in flight; a third of the ceiling per thread only
   made the thread the hash favoured queue names while the others had free slots. The floor
   (`min`) is still split, so a throttled registry is asked for no more than before. The gates
   stay separate (status.md: the throttling herd).
2. **Packument cutoff at 2 MiB** (`HUGE` in `src/registry.ts`). A scoped name's per-version route
   is an origin read where its packument is a CDN hit; the linux `@rolldown/binding-*` `libc`
   reads fell to the route at 1 MiB and ended the walk on `nitro` and `nuxt`.
3. **A booting thread is a home** (`ask` in `src/registry-pool.ts`). A name hashed to a thread
   that has not said hello waits in its port for the boot rather than being asked on the main
   thread, which is busy starting the install; after a grace it is asked here after all, so a
   thread that never speaks does not hold it. `START_AT` says which distinct name starts the
   threads ([thread-topology.md](thread-topology.md)).
4. **Fewer and earlier reads** (`src/registry.ts`, `src/resolve.ts`): a pin reads the document a
   range already asked for (`loadPinned`); `libcOf` runs once per `name@version`, the edge awaits
   it and `onPick` is told once libc is in, so a musl twin is never prefetched; a scoped pin's
   slow peek starts the route as well (`raced`, `LATE_MS`) and the first answer wins.

`upm.lock` must stay byte-identical to the previous build's on every fixture; `bench/ab.sh lock`
fails when it is not. The request count is about bun's for the same name set; what the walk
still pays is per-request latency (main-thread delay on the two hops per pick) and the libc reads.

## What lost

- Gates past 32: a faster `lock`, a slower cold install. Once the walk is faster the install is
  bound by the tarball tail and main's loop delay, and more concurrent metadata makes both worse.
- Depth-priority picks: starve shallow heavy branches.
- Warming `fetch` on main before the first request: no consistent signal.
- Hedged metadata requests (a second request after 100/150 ms): Cloudflare folds a second request
  for a url into the origin fetch in flight, and the big scoped documents take longer than that
  to _read_, so a completion-based hedge only duplicates them.
- Pre-connecting sockets at thread boot: the first batch's cost is the thread's first use of the
  fetch machinery, not the handshake count; h2 measured no better than h1 for a fresh batch.
- Three threads at the first name, or one early and two at the fourth: worse on `nitro` and
  `tiny`.
- Full packument instead of corgi for every scoped pin: several times the decoded bytes,
  rejected on the estimate.

## Untested and risks

- One box and one registry. Slow links: the 2 MiB cutoff reads up to about a quarter of that on
  the wire before giving up, which at 1 MB/s is what the route costs, and worse below that. A
  thread may open up to 32 sockets.
- Private registries: each thread's gate halves on 429/timeouts on its own; the total ceiling
  across threads is the walk's 32 picks plus libc/peek extras, not 3 × 32.
