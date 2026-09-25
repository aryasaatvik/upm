import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { RootManifest } from "../src/resolve.ts";
import { findRoot, findWorkspaces, workspacePatterns } from "../src/workspaces.ts";

let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "upm-ws-"));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

/** A package.json at `path` under the root; a null manifest makes the directory only. */
async function pkg(path: string, manifest: Record<string, unknown> | null = {}): Promise<void> {
  await mkdir(join(root, path), { recursive: true });
  if (manifest) await writeFile(join(root, path, "package.json"), JSON.stringify(manifest));
}

async function found(manifest: RootManifest): Promise<[string, string, string][]> {
  const list = await findWorkspaces(root, manifest);
  return list.map((ws) => [ws.path, ws.name, ws.version]);
}

describe("workspacePatterns", () => {
  it("takes an array or { packages }, and nothing else", () => {
    expect(workspacePatterns({})).toEqual({ patterns: [], negated: [] });
    expect(workspacePatterns({ workspaces: ["packages/*"] }).patterns).toEqual(["packages/*"]);
    expect(workspacePatterns({ workspaces: { packages: ["apps/*"] } }).patterns).toEqual([
      "apps/*",
    ]);
    for (const workspaces of ["packages/*", {}, { packages: "x" }, [1], null]) {
      expect(() => workspacePatterns({ workspaces } as unknown as RootManifest)).toThrow(
        expect.objectContaining({ code: "EWORKSPACE" }),
      );
    }
  });

  it("negates on an odd number of ! and strips a leading ./ or /", () => {
    expect(
      workspacePatterns({ workspaces: ["./packages/*", "/apps/*", "!!tools", "!skip"] }),
    ).toEqual({ patterns: ["packages/*", "apps/*", "tools"], negated: ["skip"] });
    expect(workspacePatterns({ workspaces: ["!./packages/skip", "!!!/other"] }).negated).toEqual([
      "packages/skip",
      "other",
    ]);
  });

  it("lets a later pattern undo a negation it matches, then drops patterns a negation covers", () => {
    expect(
      workspacePatterns({ workspaces: ["packages/**", "!packages/b/**", "packages/b/a"] }),
    ).toEqual({ patterns: ["packages/**", "packages/b/a"], negated: [] });
    expect(workspacePatterns({ workspaces: ["packages/*", "packages/b", "!packages/*"] })).toEqual({
      patterns: [],
      negated: ["packages/*"],
    });
  });
});

describe("findWorkspaces", () => {
  it("finds nothing when nothing is declared", async () => {
    await pkg("packages/a", { name: "a" });
    expect(await findWorkspaces(root, {})).toEqual([]);
  });

  it("expands packages/* to the directories holding a package.json", async () => {
    await pkg("packages/b", { name: "b", version: "2.0.0" });
    await pkg("packages/a", { name: "a", version: "1.0.0" });
    await pkg("packages/empty", null);
    await writeFile(join(root, "packages", "file.txt"), "");
    const list = await findWorkspaces(root, { workspaces: ["packages/*"] });
    expect(list.map((ws) => [ws.path, ws.name, ws.version])).toEqual([
      ["packages/a", "a", "1.0.0"],
      ["packages/b", "b", "2.0.0"],
    ]);
    expect(list[0]).toMatchObject({
      dir: join(root, "packages", "a"),
      manifest: { name: "a", version: "1.0.0" },
    });
  });

  it("walks packages/** but never node_modules", async () => {
    await pkg("packages/a", { name: "a" });
    await pkg("packages/a/nested", { name: "nested" });
    await pkg("packages/a/node_modules/dep", { name: "dep" });
    await pkg("node_modules/x/packages/y", { name: "y" });
    expect(await found({ workspaces: ["packages/**"] })).toEqual([
      ["packages/a", "a", "0.0.0"],
      ["packages/a/nested", "nested", "0.0.0"],
    ]);
  });

  it("leaves out what a negated pattern matches", async () => {
    await pkg("packages/a", { name: "a" });
    await pkg("packages/skip", { name: "skip" });
    expect(await found({ workspaces: ["packages/*", "!packages/skip"] })).toEqual([
      ["packages/a", "a", "0.0.0"],
    ]);
    expect(await found({ workspaces: { packages: ["packages/*", "!./packages/a"] } })).toEqual([
      ["packages/skip", "skip", "0.0.0"],
    ]);
  });

  it("orders by pattern, then by name within one, each directory once", async () => {
    await pkg("packages/z", { name: "z" });
    await pkg("packages/a", { name: "a" });
    await pkg("apps/web", { name: "web" });
    await pkg("apps/api", { name: "api" });
    expect(await found({ workspaces: ["packages/*", "apps/*", "packages/a"] })).toEqual([
      ["packages/a", "a", "0.0.0"],
      ["packages/z", "z", "0.0.0"],
      ["apps/api", "api", "0.0.0"],
      ["apps/web", "web", "0.0.0"],
    ]);
    expect(await found({ workspaces: ["packages/z", "packages/*"] })).toEqual([
      ["packages/z", "z", "0.0.0"],
      ["packages/a", "a", "0.0.0"],
    ]);
  });

  it("names a workspace after its folder when the manifest has no name", async () => {
    await pkg("packages/folder", { version: "3.0.0" });
    await pkg("packages/other", { name: "" });
    expect(await found({ workspaces: ["packages/*"] })).toEqual([
      ["packages/folder", "folder", "3.0.0"],
      ["packages/other", "other", "0.0.0"],
    ]);
  });

  it("follows a symlink to a directory", async () => {
    await pkg("elsewhere/a", { name: "a" });
    await mkdir(join(root, "packages"));
    await symlink(join(root, "elsewhere", "a"), join(root, "packages", "a"));
    expect(await found({ workspaces: ["packages/*"] })).toEqual([["packages/a", "a", "0.0.0"]]);
  });

  it("refuses two workspaces with one name", async () => {
    await pkg("packages/a", { name: "same" });
    await pkg("packages/b", { name: "same" });
    await expect(findWorkspaces(root, { workspaces: ["packages/*"] })).rejects.toThrow(
      expect.objectContaining({
        code: "EWORKSPACE",
        message: "workspaces packages/a and packages/b are both named same",
      }),
    );
  });

  it("refuses a package.json it cannot use", async () => {
    await pkg("packages/a", null);
    await writeFile(join(root, "packages", "a", "package.json"), "{");
    await expect(findWorkspaces(root, { workspaces: ["packages/*"] })).rejects.toThrow(
      expect.objectContaining({ code: "EMANIFEST" }),
    );
    await pkg("packages/a", { dependencies: ["x"] });
    await expect(findWorkspaces(root, { workspaces: ["packages/*"] })).rejects.toThrow(
      expect.objectContaining({ code: "EMANIFEST" }),
    );
  });

  it("refuses a pattern that reaches above the root before it globs", async () => {
    for (const pattern of ["../outside", "../*", "packages/../../outside", "!../outside"]) {
      await expect(findWorkspaces(root, { workspaces: [pattern] })).rejects.toThrow(
        expect.objectContaining({
          code: "EWORKSPACE",
          message: `workspace pattern ${pattern} reaches outside the project`,
        }),
      );
    }
  });

  it("does not take the root for its own workspace", async () => {
    await pkg(".", { name: "root", workspaces: ["**"] });
    await pkg("packages/a", { name: "a" });
    expect(await found({ workspaces: ["**"] })).toEqual([["packages/a", "a", "0.0.0"]]);
  });
});

describe("findRoot", () => {
  beforeEach(async () => {
    await pkg(".", { name: "root", workspaces: ["packages/*"] });
    await pkg("packages/a", { name: "a", version: "1.0.0" });
    await pkg("packages/a/src", null);
    await pkg("other", { name: "other" });
    await pkg("plain", null);
  });

  it("finds the root from inside a workspace, and names the workspace", async () => {
    for (const from of ["packages/a", "packages/a/src"]) {
      const { dir, manifest, workspaces, workspace } = await findRoot(join(root, from));
      expect(dir).toBe(root);
      expect(workspace).toMatchObject({ path: "packages/a", name: "a", version: "1.0.0" });
      // What it read of the root comes along, so the caller need not read it again.
      expect(manifest).toEqual({ name: "root", workspaces: ["packages/*"] });
      expect(workspaces).toEqual([workspace]);
    }
  });

  it("is the root itself from the root or a plain subdirectory", async () => {
    const manifest = { name: "root", workspaces: ["packages/*"] };
    expect(await findRoot(root)).toEqual({ dir: root, manifest });
    expect(await findRoot(join(root, "plain"))).toEqual({ dir: root, manifest });
  });

  it("stops at a package.json the root does not list as a workspace", async () => {
    expect(await findRoot(join(root, "other"))).toEqual({
      dir: join(root, "other"),
      manifest: { name: "other" },
    });
  });

  it("is cwd when no package.json is anywhere above", async () => {
    const bare = await mkdtemp(join(tmpdir(), "upm-ws-bare-"));
    try {
      expect(await findRoot(bare)).toEqual({ dir: bare });
    } finally {
      await rm(bare, { recursive: true, force: true });
    }
  });

  it("passes over a package.json it cannot parse on the way up", async () => {
    await writeFile(join(root, "package.json"), "{");
    expect(await findRoot(join(root, "packages", "a"))).toEqual({
      dir: join(root, "packages", "a"),
      manifest: { name: "a", version: "1.0.0" },
    });
  });

  it("passes over an ancestor whose workspaces cannot be listed, unless it is the root", async () => {
    // Bad shape, two of one name, a pattern above the root: none of them is `other`'s problem.
    const bad = [
      { workspaces: "packages/*" },
      { workspaces: ["packages/*", "dup/*"] },
      { workspaces: ["../*"] },
    ];
    await pkg("dup/a", { name: "a" });
    for (const manifest of bad) {
      await pkg(".", { name: "root", ...manifest });
      expect(await findRoot(join(root, "other"))).toEqual({
        dir: join(root, "other"),
        manifest: { name: "other" },
      });
      // From the root itself the listing is not run here, so the error surfaces later.
      expect(await findRoot(root)).toEqual({ dir: root, manifest: { name: "root", ...manifest } });
    }
  });
});
