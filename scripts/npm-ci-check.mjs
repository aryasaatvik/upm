// Network integration check for npm ci acceptance; fixture tests cover offline correctness.
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { resolveTree } from "../src/resolve.ts";
import { hoist } from "../src/hoist.ts";
import {
  formatPackageLock,
  fromPackageLock,
  parsePackageLock,
  toPackageLock,
} from "../src/package-lock.ts";

const run = promisify(execFile);
const cases = ["alias", "dev-optional", "nested", "optional", "peer", "react", "starter"];
for (const name of cases) {
  const path = fileURLToPath(
    new URL(`../test/fixtures/package-lock/${name}/package.json`, import.meta.url),
  );
  const raw = await readFile(path, "utf8");
  const manifest = JSON.parse(raw);
  const fixtureLock = parsePackageLock(
    await readFile(
      new URL(`../test/fixtures/package-lock/${name}/package-lock.json`, import.meta.url),
      "utf8",
    ),
  );
  const dir = await mkdtemp(join(tmpdir(), `upm-npm-ci-${name}-`));
  try {
    const locked = fromPackageLock(fixtureLock, manifest).resolution;
    const resolution = await resolveTree(manifest, { locked });
    const placement = hoist(resolution);
    const lock = toPackageLock(resolution, placement, manifest);
    await writeFile(join(dir, "package.json"), raw);
    await writeFile(join(dir, "package-lock.json"), formatPackageLock(lock));
    await run("npm", ["ci", "--ignore-scripts", "--no-audit", "--no-fund"], {
      cwd: dir,
      timeout: 120_000,
    });
    console.log(`${name}: npm ci accepted ${placement.size} placements`);
  } catch (error) {
    console.error(`${name}: npm ci rejected generated lock`);
    console.error((error?.stderr ?? String(error)).split("\n").slice(0, 12).join("\n"));
    process.exitCode = 1;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
