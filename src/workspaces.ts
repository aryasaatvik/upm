// Which directories are workspaces of a root, and which root a directory belongs to. Declared
// in package.json `workspaces` and found the way npm's map-workspaces does, so a monorepo
// that npm, yarn or bun reads is read the same here. Node-only, like link.ts.
import { builtin } from "./builtin.ts";
import { checkManifest } from "./package-json.ts";
import type { RootManifest } from "./resolve.ts";

export interface Workspace {
  /** Relative to the root, `/` separators, no leading `./`. */
  path: string;
  /** Absolute. */
  dir: string;
  /** `manifest.name`, else the folder name. */
  name: string;
  /** `manifest.version`, else `0.0.0`. */
  version: string;
  manifest: RootManifest;
}

/**
 * The declared patterns, split into the ones to expand and the ones to leave out. A `!`
 * negates; an even number of them does not. A leading `./` or `/` is dropped. A negation only
 * covers the patterns before it: `packages/b/a` after `!packages/b/**` is found after all, so
 * the negation goes. What is left of the negations then drops any pattern they cover whole.
 */
export function workspacePatterns(manifest: RootManifest): {
  patterns: string[];
  negated: string[];
} {
  const declared = manifest.workspaces;
  if (declared === undefined) return { patterns: [], negated: [] };
  const list = Array.isArray(declared) ? declared : declared?.packages;
  if (!Array.isArray(list) || list.some((pattern) => typeof pattern !== "string")) {
    throw fail("workspaces must be an array of patterns, or { packages: [...] }");
  }
  const { matchesGlob } = builtin.path;
  const patterns: string[] = [];
  let negated: string[] = [];
  for (const raw of list) {
    const bangs = /^!*/.exec(raw)![0].length;
    const pattern = raw.slice(bangs).replace(/^\.?\/+/, "");
    // Refused before any glob runs: a workspace is placed by a root-relative path, and one
    // above the root has no such path.
    if (pattern.split("/").includes("..")) {
      throw fail(`workspace pattern ${raw} reaches outside the project`);
    }
    if (bangs % 2 === 1) {
      negated.push(pattern);
    } else {
      negated = negated.filter((other) => !matchesGlob(pattern, other));
      patterns.push(pattern);
    }
  }
  return {
    patterns: patterns.filter((pattern) => !negated.some((other) => matchesGlob(pattern, other))),
    negated,
  };
}

/**
 * Every workspace under `dir`, in npm's order: pattern by pattern, sorted within one, each
 * directory at its first match. A match is a directory holding a package.json; anything
 * else is passed over. `node_modules` is never entered.
 */
export async function findWorkspaces(dir: string, manifest: RootManifest): Promise<Workspace[]> {
  const { patterns, negated } = workspacePatterns(manifest);
  const exclude = [...negated, "**/node_modules/**"];
  const matched = await Promise.all(patterns.map((pattern) => expand(dir, pattern, exclude)));
  const found = new Map<string, Workspace>(); // path -> workspace
  const named = new Map<string, Workspace>(); // name -> workspace
  for (const paths of matched) {
    for (const path of paths) {
      if (path === "" || found.has(path)) continue; // the root is not its own workspace
      const workspace = await readWorkspace(dir, path);
      if (!workspace) continue;
      const other = named.get(workspace.name);
      if (other) {
        throw fail(`workspaces ${other.path} and ${path} are both named ${workspace.name}`);
      }
      found.set(path, workspace);
      named.set(workspace.name, workspace);
    }
  }
  return [...found.values()];
}

/** What `findRoot` read of the root on the way, so the caller need not read it again. */
export interface Root {
  dir: string;
  manifest?: RootManifest;
  /** Only when the root was chosen for listing `workspace`; a bare candidate has not looked. */
  workspaces?: Workspace[];
  workspace?: Workspace;
}

/**
 * The project a directory belongs to: npm's walk up. The nearest package.json is the project,
 * unless a package.json above it lists that directory as a workspace, in which case the
 * root is the project and the directory is the workspace to act on. A package.json that
 * does not parse, or whose workspaces cannot be listed, is passed over on the way up: it is
 * not the project's unless it claims the directory. Nothing found means `cwd` itself.
 */
export async function findRoot(cwd: string): Promise<Root> {
  const { path } = builtin;
  let dir = path.resolve(cwd);
  let candidate: Root | undefined;
  for (;;) {
    // Most directories on the way up have no package.json: one sync probe each, rather than
    // a read that fails on the threadpool and an Error with a stack for it — 8 of them from
    // a project 8 deep were 2 ms.
    const file = path.join(dir, "package.json");
    const manifest = builtin.fs.existsSync(file)
      ? await readManifest(file).catch(() => undefined)
      : undefined;
    if (manifest && !candidate) candidate = { dir, manifest };
    else if (manifest?.workspaces !== undefined) {
      const workspaces = await findWorkspaces(dir, manifest).catch(() => undefined);
      const workspace = workspaces?.find((ws) => ws.dir === candidate!.dir);
      if (workspace) return { dir, manifest, workspaces, workspace };
    }
    const parent = path.dirname(dir);
    if (parent === dir) return candidate ?? { dir: path.resolve(cwd) };
    dir = parent;
  }
}

/** The directories one pattern matches, as root-relative `/` paths, sorted npm's way. */
async function expand(dir: string, pattern: string, exclude: string[]): Promise<string[]> {
  const { path } = builtin;
  const paths: string[] = [];
  const entries = builtin.fsp.glob(pattern, { cwd: dir, exclude, withFileTypes: true });
  for await (const entry of entries) {
    // A symlink may lead to a directory; the package.json read decides.
    if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
    const relative = path.relative(dir, path.join(entry.parentPath, entry.name));
    paths.push(relative.split(path.sep).join("/"));
  }
  return paths.sort((a, b) => a.localeCompare(b, "en"));
}

/** The workspace at `path` under `dir`, or nothing when there is no package.json there. */
async function readWorkspace(dir: string, path: string): Promise<Workspace | undefined> {
  const at = builtin.path.join(dir, path);
  let manifest: RootManifest;
  try {
    manifest = await readManifest(builtin.path.join(at, "package.json"));
  } catch (error) {
    const code = (error as { cause?: { code?: string } }).cause?.code;
    if (code === "ENOENT" || code === "ENOTDIR") return undefined;
    throw error;
  }
  return {
    path,
    dir: at,
    name: manifest.name || builtin.path.basename(at),
    version: manifest.version || "0.0.0",
    manifest,
  };
}

async function readManifest(file: string): Promise<RootManifest> {
  let raw: string;
  try {
    raw = builtin.fs.readFileSync(file, "utf8"); // sync, as the other startup reads: see readState
  } catch (error) {
    throw Object.assign(fail(`cannot read ${file}: ${(error as Error).message}`, "EMANIFEST"), {
      cause: error,
    });
  }
  let manifest: unknown;
  try {
    manifest = JSON.parse(raw);
  } catch (error) {
    throw fail(`${file} is not valid JSON: ${(error as Error).message}`, "EMANIFEST");
  }
  checkManifest(manifest, file);
  return manifest;
}

function fail(message: string, code = "EWORKSPACE"): Error {
  return Object.assign(new Error(message), { code });
}
