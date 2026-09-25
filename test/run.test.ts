import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, dirname, join, resolve, sep } from "node:path";
import { describe, expect, it } from "vitest";
import { binDirs, readScripts, scriptEnv, shellLine } from "../src/run.ts";
import { firstWord, isBatch } from "../src/shim.ts";
import type { Script } from "../src/run.ts";

const script: Script = {
  dir: resolve("/p/a"),
  file: resolve("/p/a/package.json"),
  name: "build",
  command: "tsc",
  args: [],
  pkg: { name: "demo", version: "1.0.0" },
};

describe("readScripts", () => {
  it("copies the map, and reads a missing one as empty", () => {
    const scripts = { build: "tsc" };
    const read = readScripts({ scripts }, "package.json");
    expect(read).toEqual(scripts);
    expect(read).not.toBe(scripts);
    expect(readScripts({}, "package.json")).toEqual({});
  });

  it("refuses anything but a map of strings", () => {
    for (const scripts of [null, "tsc", ["tsc"], { build: 1 }]) {
      expect(() => readScripts({ scripts }, "p/package.json")).toThrow(
        expect.objectContaining({ code: "EMANIFEST", message: expect.stringContaining("p/") }),
      );
    }
  });
});

describe("binDirs", () => {
  it("walks up to the root, nearest first", () => {
    const dirs = binDirs(resolve("/p/a"));
    expect(dirs[0]).toBe(join(resolve("/p/a"), "node_modules", ".bin"));
    expect(dirs[1]).toBe(join(resolve("/p"), "node_modules", ".bin"));
    expect(dirs.at(-1)).toBe(join(resolve("/"), "node_modules", ".bin"));
    expect(dirs).toHaveLength(resolve("/p/a").split(sep).length);
  });
});

describe("scriptEnv", () => {
  it("puts every .bin above the project, then node's own directory, first on PATH", () => {
    const env = scriptEnv(script, { Path: "/usr/bin", HOME: "/h" });
    const node = dirname(process.execPath);
    expect(env.Path).toBe([...binDirs(script.dir), node, "/usr/bin"].join(delimiter));
    expect(env).not.toHaveProperty("PATH");
    expect(env.HOME).toBe("/h");
  });

  it("sets the npm_* names tools read", () => {
    expect(scriptEnv(script, {})).toMatchObject({
      PATH: [...binDirs(script.dir), dirname(process.execPath)].join(delimiter),
      INIT_CWD: process.cwd(),
      npm_lifecycle_event: "build",
      npm_lifecycle_script: "tsc",
      npm_package_json: script.file,
      npm_package_name: "demo",
      npm_package_version: "1.0.0",
    });
  });
});

describe("shellLine", () => {
  it("quotes what sh would read", () => {
    expect(shellLine("vitest run", ["--watch", "a.ts", "it's", "a b", "$X"], false)).toBe(
      "vitest run --watch a.ts 'it'\\''s' 'a b' '$X'",
    );
  });

  it("quotes what cmd.exe and then the program would read", () => {
    const line = (arg: string) => shellLine("x", [arg], true).slice(2);
    expect(line("--watch")).toBe("--watch");
    expect(line("")).toBe('""');
    expect(line("a b")).toBe('^"a b^"');
    // A quote is escaped for the program, and every quote is hidden from cmd.
    expect(line('x" & calc & "y')).toBe('^"x\\^" ^& calc ^& \\^"y^"');
    // Backslashes are only special before a quote or at the end.
    expect(line("C:\\a b\\")).toBe('^"C:\\a b\\\\^"');
    expect(line("a\\b")).toBe("a\\b");
    expect(line("%PATH%")).toBe("%%cd:~,%PATH%%cd:~,%");
    expect(line("a|b>c")).toBe("a^|b^>c");
  });

  it("doubles every caret for a batch file, whose %* reads the arguments again", () => {
    const line = (arg: string) => shellLine("x", [arg], true, true).slice(2);
    expect(line("a&b")).toBe("a^^^&b");
    expect(line("a b")).toBe('^^^"a b^^^"');
    expect(line("a^b")).toBe("a^^^^b");
    // cmd expands `%` once, on its own line, never in what `%*` brings in.
    expect(line("%PATH%")).toBe("%%cd:~,%PATH%%cd:~,%");
  });
});

describe("isBatch", () => {
  it("finds the command as cmd does: the cwd, then PATH, with each PATHEXT extension", async () => {
    const dir = await mkdtemp(join(tmpdir(), "upm-batch-"));
    try {
      const [cwd, bin] = [join(dir, "cwd"), join(dir, "bin")];
      await mkdir(cwd);
      await mkdir(bin);
      await writeFile(join(bin, "tsc.cmd"), "");
      await writeFile(join(bin, "node.exe"), "");
      await writeFile(join(cwd, "node.bat"), "");
      await writeFile(join(bin, "tool"), ""); // a shim for sh, which cmd does not run
      await mkdir(join(bin, "dir.cmd"));
      const env = { Path: ["", bin].join(delimiter), PATHEXT: ".EXE;.CMD;.BAT" };
      expect(isBatch("tsc", cwd, env)).toBe(true);
      expect(isBatch("tsc.cmd", cwd, { ...env, PATHEXT: ".CMD" })).toBe(true);
      expect(isBatch(join(bin, "tsc"), cwd, env)).toBe(true);
      expect(isBatch("node", cwd, env)).toBe(true); // the cwd's node.bat before PATH's node.exe
      expect(isBatch("node", bin, env)).toBe(false);
      expect(isBatch("tool", cwd, env)).toBe(false);
      expect(isBatch("dir", cwd, env)).toBe(false);
      expect(isBatch("missing", cwd, env)).toBe(false);
      // An empty entry is no extension: `tsc` still means `tsc.cmd`.
      expect(isBatch("tsc", cwd, { ...env, PATHEXT: ".EXE;.CMD;" })).toBe(true);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("reads the first word of a command line, unquoted", () => {
    expect(firstWord("  tsc -p . && node x")).toBe("tsc");
    expect(firstWord('"C:\\Program Files\\x.cmd" --flag')).toBe("C:\\Program Files\\x.cmd");
    expect(firstWord("")).toBe("");
  });
});
