// Benchmark instrumentation, loaded only under `UPM_TRACE` or `UPM_PHASES` (`tracing` in
// util.ts): by the bin before the program, by a worker before its first task. Never in the
// startup graph otherwise. `UPM_TRACE=<file>` appends one JSON line per event from every
// thread, on a shared clock, so the lines merge; `UPM_PHASES=1` prints the main thread's
// phase marks, event-loop lag, OS threads and RSS on one stderr line at exit, which the bench
// tools parse.
import { builtin } from "./builtin.ts";
import { now } from "./util.ts";
import type { Tracer } from "./util.ts";

const proc = globalThis.process;
const file = proc.env.UPM_TRACE;
const phases = proc.env.UPM_PHASES ? ([] as string[]) : undefined;
const { threadId } = proc.getBuiltinModule(
  "node:worker_threads",
) as typeof import("node:worker_threads");

const lines: string[] = [];
let timer: ReturnType<typeof setTimeout> | undefined;
const counters: Record<string, number> = {};

function flush(): void {
  if (timer) clearTimeout(timer);
  timer = undefined;
  if (lines.length === 0) return;
  builtin.fs.appendFileSync(file!, lines.join("\n") + "\n");
  lines.length = 0;
}

/** A phase mark at a time already taken: the bin's, from before this module was loaded. */
export function stamp(name: string, at: number): void {
  phases?.push(`${name}=${at.toFixed(1)}`);
}

const tracer: Tracer = {
  trace(event, fields) {
    if (phases && !fields && threadId === 0) stamp(event, performance.now());
    if (!file) return;
    lines.push(JSON.stringify({ t: now(), tid: threadId, ev: event, ...fields }));
    if (lines.length > 200) flush();
    else if (!timer) timer = setTimeout(flush, 50);
  },
  tick(name, ms) {
    counters[name] = (counters[name] ?? 0) + ms;
  },
  take() {
    const m = proc.memoryUsage();
    const out = { ...counters, heap: m.heapUsed, ext: m.external, ab: m.arrayBuffers };
    for (const key of Object.keys(counters)) counters[key] = 0;
    return out;
  },
  flush,
};
(globalThis as { __upmTrace?: Tracer }).__upmTrace = tracer;

const lag = phases
  ? (
      proc.getBuiltinModule("node:perf_hooks") as typeof import("node:perf_hooks")
    ).monitorEventLoopDelay({ resolution: 1 })
  : undefined;
lag?.enable();

/** A `/proc/self/status` field, on Linux. */
function status(key: string): number {
  try {
    const text = builtin.fs.readFileSync("/proc/self/status", "utf8");
    return Number(/^(\d+)/.exec(text.split(`${key}:`)[1]?.trim() ?? "")?.[1]);
  } catch {
    return -1;
  }
}

proc.on("exit", () => {
  if (threadId === 0) {
    tracer.trace("exit", {
      rss: status("VmRSS"),
      anon: status("RssAnon"),
      hwm: status("VmHWM"),
      threads: status("Threads"),
    });
    if (phases && lag) {
      lag.disable();
      const ms = (n: number) => (n / 1e6).toFixed(1);
      const rss = (proc.memoryUsage.rss() / 1048576).toFixed(0);
      const open = proc.getActiveResourcesInfo?.().join(",") ?? "";
      proc.stderr.write(
        `PHASES ${phases.join(" ")} exit=${performance.now().toFixed(1)} threads=${status("Threads")} lag p50 ${ms(lag.percentile(50))} p99 ${ms(lag.percentile(99))} max ${ms(lag.max)} rss ${rss}MB open=[${open}] epoch ${Date.now()}\n`,
      );
    }
  }
  flush();
});

if (file && threadId === 0) {
  // RSS over time, main thread only.
  const sample = setInterval(() => {
    const m = proc.memoryUsage();
    tracer.trace("rss", { rss: m.rss, heap: m.heapUsed, ext: m.external, ab: m.arrayBuffers });
  }, 20);
  sample.unref();
  tracer.trace("boot", { pid: proc.pid, argv: proc.argv.slice(2) });
}
