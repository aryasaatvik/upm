# Thread topology, boot order, exit, and the resolver stall

Which threads a cold install starts, when, how they go away, and why one dropped address lookup
could hold an install for glibc's 5 s. Numbers, the stall tables and the commands:
[bench/results/2026-09-16-overnight.md](../bench/results/2026-09-16-overnight.md). Under ~5% is a wash.

## What is in the checkout

- **Registry threads start at the fourth distinct name** (`START_AT` in `src/registry-pool.ts`,
  `startAt` in `PoolOptions`; 0 starts them at pool creation). With the walk's "booting thread is a
  home" routing the two starts are equivalent on `nitro` and within noise on `nuxt`, and creation
  start costs a one-package install most of its time (design.md). What would make 0 free is a
  cheaper thread boot: most of it is the worker's first load of the fetch machinery.
- **Link pool started by the walk** (`picked` in `linkPool`, `src/api.ts`): on a fresh tree, not
  under production, the pool starts at the configured package count of on-platform picks, since
  the lockfile is written only at the end of the walk. [warm-link.md](warm-link.md) has the other
  two triggers.
- **Pools close when their phase ends; the bin exits once the output is out** (`Store.close`, the
  unpack pool's `close()` drains and lets idle threads go, `exit` in `src/cli.ts`). The exit is a
  turn after the empty writes call back and carries no code of its own, so a write that failed
  (`> /dev/full`) sets the exit code first (`test/cli.test.ts`). Through the library nothing exits.
- **One address lookup per host per thread** (`src/dns.ts`). Node's `fetch` looked the host up
  per socket, dozens of times per cold install; with no local stub each is a UDP query with
  glibc's 5 s timeout, and one dropped query held every connect on its libuv thread. The answer
  is asked once and handed to an undici `Agent` of upm's own as `connect.lookup`, turned per
  connection so the sockets still spread over the edge addresses (a fixed list pinned them). A
  lookup unanswered after `HEDGE_MS` is asked again on another libuv thread and the first answer
  wins; a refusal is final at once. The agent goes with each request (`fetching()`) and the
  global dispatcher is never written (design.md). It is made only where a request is next, and
  the first request waits for it so its socket lands on the agent it will keep
  (`test/dns.test.ts`: symbol missing, another dispatcher, no `fetch`, the host's init surviving).

## What lost or was a wash (cold `nuxt` unless said)

- V8 flags: `--max-semi-space-size` (runtime or worker `resourceLimits`) changed nothing; a
  bigger `--min-semi-space-size` cut scavenges at hundreds of MB of RSS; every JIT tier flag and
  `--single-threaded*` cost wall and saved no CPU. GC pauses are not the cost.
- Pre-booting unpack threads at pool creation: slower. Unpack threads 12 / 15: a wash for a lot
  of CPU. Fewer threads (unpack 4 / 6, registry 2) save CPU at a small wall cost: an option for
  CPU-limited machines, untested there. One shared pool: boot CPU is off the critical path.
- `UV_THREADPOOL_SIZE=16`: noise. Draining the oversized `@next/swc-*` packuments instead of
  cancelling them keeps their sockets: under 5% on `next`, more RSS.
- The dns cache alone moved no median; the stall rate decided it. A slow lookup never showed
  under a background probe: it is load-triggered, so only many alternating cold runs can see it.

## Untested and risks

- macOS and Windows: the flush-then-exit relies on the empty write's callback; stdout to a pipe
  is asynchronous off Linux. `process.exit` cuts what nothing awaits: a prefetched tarball the
  tree dropped may be left half-written under a temp name (never indexed; `prune` sweeps it).
- CPU-limited machines beyond a `taskset -c 0-3` check of a few pairs.
- A resolver that answers differently per query is what the per-connection turn replaces; a host
  with one address gains nothing and loses nothing. Neither the cache nor the hedge can remove
  every stall, and a table of 20 runs cannot tell 1 in 30 from 0.
