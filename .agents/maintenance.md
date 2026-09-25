# Working on upm

## Start small

1. Read [status.md](status.md) for open work and [design.md](design.md) for constraints.
2. Follow the relevant source and tests. Docs are not a second API reference.
3. Pick one observable outcome and a regression test. Separate a correctness fix
   from a performance experiment so each can be judged on its own.

Use a current Node LTS with TypeScript stripping. Bootstrap with
`node ./upm install --frozen-lockfile`; no build or other installer should be needed.
Use `./upm`, not `src/upm.ts`, for source CLI checks: the JavaScript entry enables the
compile cache before TypeScript loading begins. npm may run repo scripts, not install
dependencies. Use the installed tools in `node_modules/.bin` for focused checks.

## Check the boundary you changed

- **Registry or resolution:** use controlled responses, not the live registry, for
  correctness tests. Cover aliases, stale metadata, failed optional branches, peer
  rebinding and production reachability. Compare local and pooled answers.
- **Lockfile or keys:** round-trip the graph, include cycles, and install a matching
  frozen lock with metadata requests forbidden. An empty store may still need tarballs.
  Filter the same lock for several explicit platforms without resolving again.
- **Store or linker:** compare file bytes, executable modes, links and bins, not just
  package counts. Test damaged content, retry, concurrent writers, a fresh tree and
  reuse. Include cross-device copy fallback when changing file placement.
- **Workers:** test failed and silent startup, death with work pending, cancellation,
  close, and natural process exit. A unit test that calls `close()` can hide a CLI hang.
  `test/dist.test.ts` builds fresh, bundles the pools into an app's chunks and starts each
  worker there; source tests start them from `src/*.ts` and cannot.
- **Portable code:** exercise with `process` and `Buffer` absent, not just Node's fast
  path. In-memory lock handling is portable; lockfile I/O and install state are not.
  `test/runtime.test.ts` is the starting point for fallback tests.
- **Startup or performance:** check help, no-op, small incremental and production
  installs as well as the target workload. Follow [perf.md](perf.md).

## Before handoff

Run the relevant tests first, then `npm test` for lint, typecheck and coverage.
Build with `npm run build` and smoke-test `dist/upm.mjs` for CLI, worker or packaging
changes. Keep self-install checks on `./upm`; a working bundle does not prove bootstrap.
Docs-only changes need link and formatting checks, not install benchmarks.

Get independent review before human review. Reviewers should inspect the actual
changes and challenge the tests, not trust the implementer's summary. Report checks
run, failures, untested platforms and remaining risks. Performance claims also need
reproducible evidence, not only a faster profile.

## Keep the docs useful

Keep `AGENTS.md` short and update it when project status or navigation changes.
Keep open work in `status.md`: the problem, next useful check and what would settle it.
Remove completed items unless they leave a lasting constraint in `design.md`.

Do not copy APIs, constants, command catalogs, source walkthroughs, benchmark tables
or machine-specific estimates here. Keep raw performance results with the experiment
or under `bench/results/`. Do not retain old stage plans or rejected designs unless
there is a concrete reason to resume them. Distinguish proposals from what is in the
checkout.
