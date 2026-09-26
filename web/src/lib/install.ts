// upm's own `install`, run in this tab: ./node.ts stands in for Node's `process`, and its
// filesystem holds the project and the store. The store is kept on OPFS across runs and visits;
// the project is made fresh for each run. Both, and upm's commands, load on the first install.
import type { InstallResult } from "upm/src/api.ts";
import type { TarEntry } from "upm/src/tar.ts";

const PROJECT = "/project";
const HOME = "/home/user";

/** A file of the installed tree, or a symlink: then `data` is its target. */
export type InstalledFile = TarEntry & { link?: string };

export interface Installed {
  /**
   * Tree path -> entry, from the project root, and the store as `~/.upm/store/…`. The root's own
   * dependency links are shown opened, as an editor shows a linked folder, so a package's files
   * keep the paths they had before the install: `node_modules/<name>/…`.
   */
  files: Map<string, InstalledFile>;
  /** Those opened links: their tree path -> target. */
  links: Map<string, string>;
  result: InstallResult;
  ms: number;
}

let running: Promise<unknown> = Promise.resolve();
let shim: typeof import("./node.ts") | undefined;

/** The project's package.json, as the install writes it and the tree shows it before then. */
export function manifestOf(dependencies: Record<string, string>): InstalledFile {
  const manifest = { name: "playground", version: "0.0.0", dependencies };
  const data = new TextEncoder().encode(`${JSON.stringify(manifest, null, 2)}\n`);
  return { path: "package.json", mode: 0o644, size: data.length, data };
}

/**
 * Install `dependencies` into a fresh `/project`. One run at a time: they share the filesystem.
 * With the walk's `lockfile` as its `upm.lock`, upm installs what the walk picked, resolving
 * nothing again.
 */
export function installInTab(
  dependencies: Record<string, string>,
  registry: string,
  log: (message: string, level: string) => void,
  lockfile?: string,
): Promise<Installed> {
  const run = running.then(async () => {
    shim ??= await import("./node.ts");
    shim.installShim({ cwd: PROJECT, home: HOME });
    if (typeof globalThis.process?.getBuiltinModule !== "function") {
      throw new Error("This page has a `process` of its own, so upm's cannot be put in place");
    }
    if (!(await shim.persist())) {
      log("the store is in memory only: OPFS is missing here, or another tab keeps it", "warn");
    }
    shim.fs.rmSync(PROJECT, { recursive: true, force: true });
    shim.fs.mkdirSync(PROJECT, { recursive: true });
    shim.fs.writeFileSync(`${PROJECT}/package.json`, manifestOf(dependencies).data);
    if (lockfile) shim.fs.writeFileSync(`${PROJECT}/upm.lock`, lockfile);
    const { install } = await import("upm/src/api.ts");
    const start = performance.now();
    // No release age: the same picks as the resolve beside it, which asks for none.
    // The unpack and link pools always say this in a tab (./node.ts starts only registry threads),
    // which reads as if nothing ran on threads.
    const quiet = (message: string, level: string) => {
      if (!message.startsWith("worker threads unavailable")) log(message, level);
    };
    const result = await install({ dir: PROJECT, registry, minReleaseAge: 0, log: quiet });
    const ms = performance.now() - start;
    const files = new Map<string, InstalledFile>();
    const links = new Map<string, string>();
    const top = /^node_modules\/(@[^/]+\/)?[^/.@][^/]*$/;
    const list = (root: string, shown: string) => {
      for (const [path, entry] of shim!.walk(root)) {
        const at = shown + path.slice(root.length + 1);
        if (entry.kind === "file") {
          files.set(at, { path: at, mode: entry.mode, size: entry.data.length, data: entry.data });
        } else if (entry.kind === "link" && shown === "" && top.test(at)) {
          links.set(at, entry.target);
          list(path, `${at}/`);
        } else if (entry.kind === "link") {
          const data = new TextEncoder().encode(entry.target);
          files.set(at, { path: at, mode: 0o777, size: data.length, data, link: entry.target });
        }
      }
    };
    list(PROJECT, "");
    list(`${HOME}/.upm/store`, "~/.upm/store/");
    return { files, links, result, ms };
  });
  running = run.catch(() => {});
  return run;
}

/** Changes to the filesystem so far: what a run in progress shows. */
export const changes = () => shim?.changes ?? 0;
