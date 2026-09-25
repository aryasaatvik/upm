import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runShell, shellLine, withPath } from "../src/run.ts";
import { isBatch, shimsOf } from "../src/shim.ts";

const WIN = process.platform === "win32";

const shim = (head: string | undefined, target = "../a/cli.js") =>
  Object.fromEntries(shimsOf(target, head)) as Record<"" | ".cmd" | ".ps1", string>;

describe("shimsOf", () => {
  it("runs the program a #! line names, with its arguments, on the target from .bin", () => {
    const { "": sh, ".cmd": cmd, ".ps1": ps1 } = shim("#!/usr/bin/env node --no-warnings\n");
    expect(cmd).toContain('& "node" --no-warnings "%dp0%\\..\\a\\cli.js" %*\r\n');
    expect(cmd.split("\r\n").every((line) => !line.includes("\n"))).toBe(true);
    expect(sh).toContain('exec "node" --no-warnings "$basedir_win/../a/cli.js" "$@"\n');
    expect(ps1).toContain('& "node$exe" --no-warnings "$basedir/../a/cli.js" $args\n');
  });

  it("reads env -S, a path to the program, a CRLF line and a BOM", () => {
    const run = (head: string) => shim(head)[""].split("\n").at(-2);
    expect(run("#!/usr/bin/env -S node --flag\n")).toBe(
      'exec "node" --flag "$basedir_win/../a/cli.js" "$@"',
    );
    expect(run("#!/usr/bin/env -S NODE_ENV=x node\n")).toBe(
      'exec "node" "$basedir_win/../a/cli.js" "$@"',
    );
    expect(run("#!/usr/local/bin/node\r\nrest")).toBe(
      'exec "node" "$basedir_win/../a/cli.js" "$@"',
    );
    expect(run("#!/bin/sh -e\n")).toBe('exec "sh" -e "$basedir_win/../a/cli.js" "$@"');
    expect(run("\uFEFF#!/usr/bin/env node")).toBe('exec "node" "$basedir_win/../a/cli.js" "$@"');
  });

  it("refuses a target its quotes cannot hold, which a lockfile could name", () => {
    for (const target of [
      '../a/x" & calc & ".js',
      "../a/%PATH%.js",
      "../a/$(id).js",
      "../a/\r\nx",
    ]) {
      expect(() => shimsOf(target, undefined)).toThrow(expect.objectContaining({ code: "EBIN" }));
    }
  });

  it("runs a script node's by its extension, and anything else itself", () => {
    for (const target of ["../a/cli.js", "../a/cli.mjs", "../a/cli.cjs"]) {
      expect(shim(undefined, target)[".cmd"]).toContain(
        `"node" "%dp0%\\${target.replaceAll("/", "\\")}"`,
      );
    }
    const { "": sh, ".cmd": cmd, ".ps1": ps1 } = shim("MZ", "..\\a\\bin\\a.exe");
    expect(cmd).toContain('\r\n"%dp0%\\..\\a\\bin\\a.exe" %*\r\n');
    expect(sh).toContain('exec "$basedir/../a/bin/a.exe" "$@"\n');
    expect(ps1).toContain('& "$basedir/../a/bin/a.exe" $args\n');
  });
});

describe("a shim", () => {
  let dir: string;
  let out: string;
  const args = ["a b", "x&y", "%PATH%", 'say "hi"', "a^b", "(p)", "!x!", "c:\\d\\", ""];

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "upm-shim-"));
    out = join(dir, "out.json");
    await mkdir(join(dir, "node_modules", "tool"), { recursive: true });
    await mkdir(join(dir, "node_modules", ".bin"));
    await writeFile(
      join(dir, "node_modules", "tool", "cli.js"),
      "#!/usr/bin/env node\nrequire('node:fs').writeFileSync(process.env.OUT, JSON.stringify(process.argv.slice(2)));\n",
    );
    for (const [suffix, text] of shimsOf("../tool/cli.js", "#!/usr/bin/env node\n")) {
      await writeFile(join(dir, "node_modules", ".bin", `tool${suffix}`), text, { mode: 0o755 });
    }
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("gets every argument through the shell a script runs in", async () => {
    const env = withPath([join(dir, "node_modules", ".bin")], { ...process.env, OUT: out });
    // cmd finds `tool.cmd`, whose `%*` reads the arguments a second time.
    const batch = WIN && isBatch("tool", dir, env);
    expect(batch).toBe(WIN);
    const line = shellLine("tool", args, WIN, batch);
    expect(await runShell(line, dir, env)).toBe(0);
    expect(JSON.parse(await readFile(out, "utf8"))).toEqual(args);
  });

  it.runIf(WIN)("runs in PowerShell", async () => {
    const ps1 = join(dir, "node_modules", ".bin", "tool.ps1");
    const flags = ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", ps1, "a b", "c"];
    const ran = promisify(execFile)("powershell.exe", flags, { env: { ...process.env, OUT: out } });
    ran.child.stdin?.end(); // or the shim waits on it as pipeline input
    await ran;
    expect(JSON.parse(await readFile(out, "utf8"))).toEqual(["a b", "c"]);
  });

  const gitSh = "C:\\Program Files\\Git\\bin\\sh.exe";
  it.runIf(WIN && existsSync(gitSh))("runs in Git Bash", async () => {
    const sh = join(dir, "node_modules", ".bin", "tool").replaceAll("\\", "/");
    await promisify(execFile)(gitSh, [sh, "a b", "c"], { env: { ...process.env, OUT: out } });
    expect(JSON.parse(await readFile(out, "utf8"))).toEqual(["a b", "c"]);
  });
});
