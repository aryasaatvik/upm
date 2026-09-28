import { createRequire } from "node:module";
import { basename, dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { defineBuildConfig } from "obuild/config";
import type { BuildConfig } from "obuild/config";

type Hooks = NonNullable<BuildConfig["hooks"]>;
type InputOptions = Parameters<NonNullable<Hooks["rolldownConfig"]>>[0];
type Plugin = Extract<NonNullable<InputOptions["plugins"]>, unknown[]>[number];
type Build = Parameters<NonNullable<Hooks["rolldownOutput"]>>[1];

/** The rolldown obuild bundles with, for the workers' own builds. */
export async function loadRolldown(): Promise<{ rolldown(options: InputOptions): Promise<Build> }> {
  const obuild = createRequire(import.meta.url).resolve("obuild");
  return await import(pathToFileURL(createRequire(obuild).resolve("rolldown")).href);
}

/** One worker and everything it imports as one minified ES module, lazy chunks included. */
async function bundleWorker(input: string): Promise<string> {
  const { rolldown } = await loadRolldown();
  const build = await rolldown({ input, platform: "node", logLevel: "warn" });
  try {
    // No `/* @__PURE__ */` notes: nothing tree-shakes a worker's string after this.
    const { output } = await build.generate({
      format: "esm",
      codeSplitting: false,
      minify: true,
      comments: false,
    });
    return output[0].code;
  } finally {
    await build.close();
  }
}

/**
 * Gives each pool its own src/workers.ts: src/unpack-pool.ts gets `unpackWorker`, which starts
 * src/unpack-worker.ts bundled whole, from a string in the pool's own chunk. A thread then needs
 * no file of ours beside whatever an app's bundler made of upm, and no `import.meta.url`.
 */
const workers: Plugin = {
  name: "upm-workers",
  resolveId(id, importer) {
    const pool = importer?.match(/[\\/]src[\\/]([a-z]+)-pool\.ts$/);
    if (id !== "./workers.ts" || !pool) return;
    return `\0upm-worker:${join(dirname(importer!), `${pool[1]}-worker.ts`)}`;
  },
  async load(id) {
    if (!id.startsWith("\0upm-worker:")) return;
    const file = id.slice(12);
    const name = basename(file, ".ts").replace("-worker", "Worker");
    // Escaped only where a URL would read the code otherwise: `%` escapes, `?` and `#` end the
    // path, and tabs and newlines are dropped. A third of the size `encodeURIComponent` makes.
    const code = (await bundleWorker(file)).trim().replace(/[%?#\t\n\r]/g, encodeURIComponent);
    const url = JSON.stringify(`data:text/javascript,${code}`);
    return `export const ${name} = () => new URL(${url});`;
  },
};

export default defineBuildConfig({
  entries: [
    {
      type: "bundle",
      minify: true,
      input: ["./src/index.ts", "./src/resolver.ts", "./src/upm.ts", "./src/upx.ts"],
    },
  ],
  hooks: {
    rolldownConfig(config) {
      config.plugins = [workers, config.plugins];
    },
    rolldownOutput(config) {
      // obuild turns this off. Short names for what chunks import from each other.
      config.minifyInternalExports = true;
      // A few chunks, not one per shared module: every file on the way to `main()` is a
      // resolve, a read and a compile, and fifteen of them were 3 ms of a 30 ms `--help`.
      // `upm/resolver` stays clear of the commands in `main`. The workers share no chunk:
      // each is bundled whole into its pool (src/workers.ts).
      const splitting = config.codeSplitting;
      const groups = typeof splitting === "object" ? (splitting.groups ?? []) : [];
      const src = String.raw`[\\/]src[\\/]`;
      const group = (name: string, modules: string) => ({
        name,
        test: new RegExp(`${src}(${modules})\\.ts$`),
      });
      config.codeSplitting = {
        ...(typeof splitting === "object" ? splitting : {}),
        groups: [
          group("limit", "builtin|runtime|limit|normalize-bin|util|integrity"),
          group("unpack", "unpack|tar"),
          group("registry", "registry|pick|pluck|semver|spec|dns"),
          group("resolve", "resolve|lock"),
          group(
            "main",
            "api|link|keys|state|store|package-json|config|gc|exec|run|types|workspaces",
          ),
          // obuild's own `libs/*` group names chunks with a function; label it for rolldown.
          ...groups.map((g) => (typeof g.name === "function" ? { debugName: "libs", ...g } : g)),
        ],
      };
    },
  },
});
