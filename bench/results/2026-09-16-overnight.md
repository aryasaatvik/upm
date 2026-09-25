# 2026-09-16: the four install-time streams, measured

Raw numbers behind the four `.agents` topic pages ([walk-critical-path](../../.agents/walk-critical-path.md),
[thread-topology](../../.agents/thread-topology.md), [unpack-workers](../../.agents/unpack-workers.md),
[warm-link](../../.agents/warm-link.md)) and their merge. Every table is `bench/ab.sh` output
unless it says otherwise: paired runs, alternating order, medians; Δ = new − base, with the
count of pairs that favoured new in brackets. Under ~5% is a wash.

Environment: one machine, 16 cores, Node 24.20.0, ext4 under `bench/.work`, live
registry.npmjs.org (~2 ms to its Cloudflare edge, `/etc/resolv.conf` a public resolver with no
local stub), 2026-09-15 and 2026-09-16. `base` is `dist` built from `main` at 5b9e7d6; `new` is
`dist` of the branch under test, or of the merged build. `taskset -c 0-3` rows are the same
commands under four cores.

## The merged build

```sh
bench/ab.sh cold 10 base:<dist of 5b9e7d6> new:dist -- nitro nuxt next
bench/ab.sh warm 12 base:<dist of 5b9e7d6> new:dist -- nitro nuxt next
bench/ab.sh repeat 20 base:<dist of 5b9e7d6> new:dist -- nitro nuxt next
bench/ab.sh cold 10 base:<dist of 5b9e7d6> new:dist -- tiny
taskset -c 0-3 bench/ab.sh cold 6 base:<dist of 5b9e7d6> new:dist -- nitro nuxt
```

| fixture | mode          | pairs |    base |     new |       Δ wall (wins) |    ΔRSS |    ΔCPU |
| ------- | ------------- | ----: | ------: | ------: | ------------------: | ------: | ------: |
| nitro   | cold          |    10 |  882 ms |  563 ms | **−314 ms (10/10)** |  −10 MB | +152 ms |
| nuxt    | cold          |    10 | 1492 ms | 1290 ms | **−220 ms (10/10)** |  +24 MB | +245 ms |
| next    | cold          |    10 | 1349 ms |  978 ms | **−304 ms (10/10)** | −239 MB | +311 ms |
| tiny    | cold, no lock |    10 |  165 ms |  155 ms |        −6 ms (6/10) |   +1 MB |   −1 ms |
| nitro   | warm          |    12 |   68 ms |   65 ms |       −4 ms (10/12) |   +1 MB |   −2 ms |
| nuxt    | warm          |    12 |  181 ms |  180 ms |        −7 ms (9/12) |   −6 MB |  +31 ms |
| next    | warm          |    12 |  127 ms |  113 ms |  **−15 ms (10/12)** |   −1 MB |   −7 ms |
| nitro   | repeat        |    20 |   47 ms |   37 ms |  **−11 ms (19/20)** |    0 MB |  −11 ms |
| nuxt    | repeat        |    20 |   70 ms |   38 ms |  **−32 ms (20/20)** |   −6 MB |  −42 ms |
| next    | repeat        |    20 |   48 ms |   38 ms |  **−10 ms (20/20)** |    0 MB |  −10 ms |
| nitro   | cold, 4 cores |     6 |  874 ms |  575 ms |       −300 ms (6/6) |   +8 MB |  +68 ms |
| nuxt    | cold, 4 cores |     6 | 1741 ms | 1664 ms |        −97 ms (5/6) |  +21 MB | +123 ms |

The build under test predates the dns lookup hedge, which does nothing under a second. The same
code before the registry thread start decision (below) read nitro −309, nuxt −191, next −379,
all 10/10. Cold CPU is up 150–310 ms: the registry threads doing what main did, the late routes,
the link pool under the tail. Cold RSS on `next` is down 239 MB: the 40 MiB tarball's big files
are spooled, not held.

After the review fixes (6 pairs, `bench/ab.sh cold 6 ...`): next cold 1275 → 1000 ms, −298 (5/6;
one new run stalled +2.5 s), RSS −287 MB, CPU +159 ms; nitro cold 849 → 541, −300 (6/6), RSS
−2 MB, CPU +93 ms. The reviewer's own reproduction read cold −292/−200/−340, repeat 20/20 on all
three, tiny a wash. Cold `next` store after the prefetch fix: 22 indexes / 9,792 blobs in 4 of 4
runs (24 / 9,813 in 3 of 4 before it), 4 address lookups per install.

Streams' own cold sums were nitro −362, nuxt −300, next −453; the merged build keeps 70–85% of
that. The overlap is the two ways of getting the registry threads up early.

### Registry thread start: at creation (0) against the fourth name (4)

Same commands, the merged build with `START_AT` in `src/registry-pool.ts` set each way:

| fixture | mode          | pairs | `START_AT=0` | `START_AT=4` |                            Δ (4 − 0) |
| ------- | ------------- | ----: | -----------: | -----------: | -----------------------------------: |
| nitro   | cold          |    10 |       531 ms |       551 ms |                        +14 ms (4/10) |
| nuxt    | cold          |    10 |      1255 ms |      1292 ms |                        +45 ms (3/10) |
| tiny    | cold, no lock |    10 |       250 ms |       147 ms | −100 ms (10/10), −58 MB, −246 ms CPU |

`main`'s tiny was 150 ms. Waiting for the dns agent before the first request took tiny from
178 to 147 ms (9/10).

### Stall check, cold `next`

Not `ab.sh`: N cold runs per build, alternating; a run over 3 s is a stall. 20 runs cannot tell
1/30 from 0.

```sh
export npm_config_min_release_age= npm_config_ignore_scripts=
for i in $(seq 1 20); do for d in <dist of 5b9e7d6> ./dist; do
  rm -rf w && mkdir -p w/p w/store && cp bench/fixtures/next/package.json w/p/
  ( cd w/p && perl ../../bench/measure.pl ../m.txt node $d/cli.mjs install --store ../store >/dev/null 2>&1 )
  echo "$d $(cut -d' ' -f1 w/m.txt)"; done; done
```

| build  | runs | runs > 3 s |  min | median |  p90 |  max |
| ------ | ---: | ---------: | ---: | -----: | ---: | ---: |
| base   |   20 |          1 | 1168 |   1413 | 1493 | 5400 |
| merged |   20 |          0 |  949 |    973 | 1039 | 1117 |

Before the lookup hedge the merged build read 1/20 (max 5535): one of the four remaining
lookups (main + 3 registry threads) sat 5019 ms in `getaddrinfo`, every connect on that thread
behind it (24 runs under an undici `--import` logger). With the hedge, 30 hooked runs saw the
event once as a 1.03 s connect wait; the reviewer's 30 runs still had one 5.25 s run. About 1/30
against 4/30 before. The same 30 runs had one 59.8 s run: the 40 MiB `next` tarball arriving at
~700 KB/s for 59 s, no 30 s silence, main thread 1.4% busy, no slow lookup.

### Equivalence

One cold install per build per fixture into private stores:

```sh
cmp base/p/upm.lock new/p/upm.lock
diff <(cd base/p && find node_modules -printf '%y %m %p %l\n' | sort) <(cd new/p && find node_modules -printf '%y %m %p %l\n' | sort)
diff <(cd base/store && find files -type f -printf '%m %s %P\n' | sort) <(cd new/store && find files -type f -printf '%m %s %P\n' | sort)
find new/store/index -type f | wc -l     # over several runs: the platform's tree, 22 on next
```

`upm.lock` byte-identical from a no-lock resolve on all three; the tree listing identical (1,856
/ 18,283 / 11,133 lines for nitro / nuxt / next); store blob mode/size/path sets identical (1,380
/ 12,123 / 9,792); index counts equal; no `.tmp` left at the `files/` root.

## Stream: the metadata walk (`walk-critical-path`)

```sh
bench/ab.sh lock 10 base:<dist of 5b9e7d6> new:dist -- nitro nuxt next
bench/ab.sh cold 10 base:<dist of 5b9e7d6> new:dist -- nitro nuxt
bench/ab.sh cold 6 base:<dist of 5b9e7d6> new:dist -- next
```

| fixture | mode | pairs |                Δ wall (wins) |   ΔRSS |    ΔCPU |
| ------- | ---- | ----: | ---------------------------: | -----: | ------: |
| nitro   | lock |    10 |              −129 ms (10/10) | +13 MB |   +5 ms |
| nuxt    | lock |    10 |              −151 ms (10/10) | +14 MB |  +84 ms |
| next    | lock |    10 |                −79 ms (9/10) | +36 MB | +131 ms |
| nitro   | cold |    10 |              −218 ms (10/10) |  +6 MB | +109 ms |
| nuxt    | cold |    10 |                −24 ms (6/10) |  +7 MB | +145 ms |
| next    | cold |     6 | −210 ms (4/6, one 4 s stall) | +20 MB | +451 ms |

`nuxt` is a wash in install mode: its walk is ~950 ms in `lock`, but the install's tarball tail
and main-thread loop delay hide it.

Timeline of cold `nuxt` on `main` (`UPM_TRACE` plus an undici `--import` request log):

- 38 ms: first request (`node -e 0` is 20 ms).
- 38→146: the first document (25 ms fetch machinery, 45–50 connect+TLS, 28 TTFB).
- 143: the 59 direct dependencies asked; pool started at the 4th name, ready 192–200. The 55
  names asked before that ran on main at p50 129 ms slot→answer.
- 300→1100: throughput-bound at 26–30 of 32 pick slots, 100–180 picks waiting.
- 1100→1270: a chain 12 deep and the five linux `@rolldown/binding-*` libc routes.
- Along the chain that ends the walk: gate wait 585–720 ms + request time 456–528 ms; ~60% of
  the chain waits for a pick slot, ~40% is request latency (~45 ms a hop). Floor at today's
  per-request latency ~550 ms.

Requests: `nuxt` 618 (580 names) against bun's 580 (580): 30 full packument reads for `libc`,
1 second version of a name, 7 duplicates (removed). Per request 41 ms against bun's 26. After
the change: 611–619 / 39 / 76 requests on nuxt / nitro / next. Every thread ran a third of the
32-slot gate: a mean 7 ms of every 41 ms pick was gate wait on `nuxt`. A scoped name's
per-version route is an origin read (220–250 ms) where its packument is a CDN hit (30–60 ms).

Negative results, in numbers: gates 24/40/48/64 with whole per-thread gates: lock nuxt
−90..−116 but cold nuxt at 48 +108 ms (2/10). Hedged metadata requests after 100/150 ms: nuxt
+3..+34 lock, cold ±, next +61 (2/6) with 4.7 MB carried by losers. Pre-connecting sockets at
thread boot: +24..+43 ms, CPU +110–230. Three threads at the first name: one-package project
+12 ms, +57 MB, +0.2 s CPU; one thread early and two at the fourth: nitro +64 ms (0/10).
Depth-priority picks: `rolldown` waited 238 ms for a slot. Full packument for every scoped pin:
~2.3× on 20 MB of decoded scoped reads (estimate).

## Stream: thread topology and the resolver stall (`thread-topology`, `dns-stall`)

```sh
bench/ab.sh cold 10 base:<dist of 5b9e7d6> new:dist -- nuxt next nitro
```

Topology alone (start at creation, link pool at the 200th pick, close-per-phase and exit):
nuxt −145 (9/10), next −101 (7/10), nitro −73 (10/10). Isolated on cold `nuxt`: threads at
creation −118..−196 ms; link pool at the 200th pick −50 ms (7/10); close-per-phase and exit
−57 ms (8/10), teardown 44–49 → 36–40 ms. The dns cache alone was within noise on medians
(nitro −25 (5/10), nuxt +32 (3/10), next −102 (7/10)); the stall table decided it, 30 cold runs
per build alternating (the loop above):

| fixture | build     | runs > 3 s |  min | median |  p90 |  max |
| ------- | --------- | ---------: | ---: | -----: | ---: | ---: |
| next    | without   |          4 | 1128 |   1242 | 5462 | 5733 |
| next    | dns cache |          0 | 1087 |   1188 | 1338 | 1370 |
| nuxt    | without   |          0 | 1254 |   1433 | 1574 | 1711 |
| nuxt    | dns cache |          0 | 1259 |   1417 | 1506 | 1633 |

Lookups per cold install before the cache: 46 on `next`, 64 on `nuxt`, most in the first 300 ms.
A background probe at 2 lookups/s for 25 min saw no slow lookup: the stall is load-triggered.
A fixed address list instead of a per-connection turn pinned the sockets: nuxt +48 ms.

Where the CPU goes, cold `nuxt` on `main` (OS-thread sampler, one run, 7.36 s CPU): main 1.19 s
(73% busy; undici tarball fetch its top item) · 3 registry threads 1.75 s · 8 unpack threads
2.34 s (35–45% busy) · 4 link threads 0.28 s · 4 V8 platform threads 1.35 s (concurrent
recompilation + GC for 16 isolates) · 4 libuv threads 0.44 s. 169 scavenges = 116 ms over 16
isolates. Event-loop lag on main p50 1.1 ms, p99 6–9, max 32–37. Teardown after the exit event
44–49 ms with 12 idle isolates alive; the kernel freeing ~700 MB is about half of it.

Negative results, in numbers (cold `nuxt`): `--min-semi-space-size=32` cuts scavenges 170 → 12
at RSS +500 MB; pre-booting 2 unpack threads at creation +13 ms (4/10); unpack threads 12 / 15 a
wash at CPU +285 / +472 ms; fewer threads (unpack 4 / 6, registry 2) save 200–570 ms CPU at
+9..+25 ms wall (3–4/8); `UV_THREADPOOL_SIZE=16` −23 ms (3/6); draining the 9 oversized
`@next/swc-*` packuments instead of cancelling them keeps 9 keep-alive sockets (48 → 37
connects), next −64 ms (7/10), RSS +30 MB. Four cores: nuxt cold −97 (5/6), nitro −300 (6/6),
above.

## Stream: unpack workers (`unpack-workers`)

```sh
bench/ab.sh cold 10 base:<dist of 5b9e7d6> new:dist -- nuxt next nitro
```

| fixture | pairs |      Δ wall (wins) |   Δ RSS |   Δ CPU |
| ------- | ----: | -----------------: | ------: | ------: |
| nitro   |    10 |  **−71 ms (8/10)** |  −19 MB |  −36 ms |
| next    |    10 | **−142 ms (7/10)** | −242 MB | +153 ms |
| nuxt    |     6 |      −131 ms (6/6) |  −23 MB |  +65 ms |

Earlier 10-pair runs of the same code on `nuxt` said −32 (8/10) and −57 (7/10). Stores identical
between the builds (9,792 blobs on next, 12,123 on nuxt, same modes and sizes).

What the trace showed on `main` (`UPM_TRACE`):

- Cold `nuxt` (559 tarballs, p50 8 KB, max 7.9 MB): every index written within 35 ms of the
  `lock`; per tarball after its last byte p50 11 ms. Worker time on small tarballs: write 52%
  (sync open/write/close + mkdir per shard). Eight workers each ~25–30% busy; the eighth boots
  ~530–745 ms in. Each unpack worker ~37 MB RSS.
- Cold `next` (22 tarballs): `next` 41.7 MB → 191 MB, 8527 files, inflate bound (265 ms), index
  517–560 ms after the last byte; `@next/swc` 33.8 MB → one 97 MB file, index 262 ms after the
  last byte, serial in one thread. With the spool: last block → index 208 → 64 ms.
- Cold `nitro`: `@rolldown/binding-linux-x64-gnu` 7.97 MB, asked at the end of the walk, 91 ms
  behind its last byte. Streaming it from 4 MiB with no second thread booted: nitro CPU −52 ms.
- A failing shard read cost ~100 µs under load, 55 ms of `nuxt`'s main thread.

Negative results, in numbers: closing the unpack pool right after the fill with the link after
it, nuxt +79 ms (2/10); 12 or 15 unpack workers −30..−37 ms (4/8), RSS +76 MB, CPU +405 ms;
blake2b instead of sha512 would save ~25 ms of worker CPU on nuxt (this CPU has no SHA-NI,
sha512 900 MB/s); inflate read-ahead (`readableHighWaterMark` 4 MiB) ~10 ms on the 40 MiB
split; `gunzipSync` 402 ms against the stream's 265 for 191 MB. Not done: progressive parts for
the 40 MiB tarball would overlap ~200 ms of hash+write with the inflate; index writes on main are
~60 ms of main CPU on nuxt, a sync write+rename would block ~35 ms; queue waits p50 8–12 ms
under the pool ramp.

## Stream: warm and repeat (`warm-link`, `warm-link-2`)

```sh
bench/ab.sh repeat 10 base:<dist of 5b9e7d6> new:dist -- nitro nuxt next
bench/ab.sh warm 12 base:<dist of 5b9e7d6> new:dist -- nitro nuxt next
```

| fixture | mode   |         Δ median |  wins |  ΔRSS |   ΔCPU |
| ------- | ------ | ---------------: | ----: | ----: | -----: |
| nitro   | repeat |    −8 ms (46→37) | 10/10 |     0 | −10 ms |
| nuxt    | repeat |   −32 ms (71→38) | 10/10 | −7 MB | −43 ms |
| next    | repeat |   −10 ms (47→38) |  9/10 |     0 | −11 ms |
| nitro   | warm   |     −2 ms (wash) |  9/12 |     0 |  −1 ms |
| nuxt    | warm   | −19 ms (195→176) | 11/12 | −8 MB | −21 ms |
| next    | warm   | −11 ms (129→120) | 10/12 | −1 MB |  +3 ms |

The reviewer saw warm nuxt at −7..−13 with CPU +15..+20. Trees compared with
`find node_modules -printf '%y %m %p %l\n' | sort` plus per-file sizes and md5: identical.

Where the time went on `main`, warm (`UPM_PHASES=1`, medians of 7, ms):

| phase                            | nitro (20 entries, 1,446 files) | nuxt (561, 13,578) | next (22, 10,174) |
| -------------------------------- | ------------------------------: | -----------------: | ----------------: |
| process start → cli entry        |                            25.7 |               24.8 |              26.7 |
| project found + `.npmrc`         |                             7.5 |                8.0 |               8.6 |
| lockfile read + parse + validate |                             3.6 |               12.1 |               3.8 |
| `fromCheckedLockfile` + filter   |                             1.8 |               13.6 |               2.0 |
| `stateHash`                      |                             3.0 |                5.7 |               3.2 |
| fill (index reads)               |                             1.8 |               17.6 |               7.4 |
| `storeKeys`                      |                             1.3 |               16.3 |               1.4 |
| materialize                      |                            17.6 |               56.2 |              59.6 |
| exit event                       |                            69.2 |              175.9 |             125.1 |

Repeat (no-op) on `main`: 46.6 / 67.8 / 52.9 ms at the exit event. 561 packages take 12 ms to
validate (cold code). `node:crypto` ~3.5 ms to load; `process.stdout` ~2 ms. Worker boot
~25–35 ms. Materialize on nuxt: main ~80% busy (plan, `postMessage`, renames), workers ~90%
busy; raw `link()` scales to 8 threads on this fs. Per change: `shortHash` sync, `storeKeys` on
nuxt 13.2 → 9.5 ms; fewer chunks, `--help` −2 ms; small entries by index path, fill 17.5 → 3.6 ms
on nuxt; compile cache, `--help` 31.8 → 27.7 ms; spelled paths, 15 ms of nuxt's link.

Negative results, in numbers: 8 link workers against 4 a wash on wall, +58 MB, +255 ms CPU; 2
workers +16..+32 ms; linker concurrency 32/64/128 no better than 16; a pool for nitro-size trees
materialize 30–40 ms against 17.6 on main; speculative pool start at the state read nitro
+5–7 ms; main running shards while workers boot next +20 ms; one chunk for everything, workers
load 90 KB each.
