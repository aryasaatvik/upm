// Filesystem I/O around the portable lock codec.
import { builtin } from "./builtin.ts";
import { pid } from "./runtime.ts";
import { replaceFile, rmIfExists, trace } from "./util.ts";
import { LOCKFILE, formatLockfile, parseLockfile } from "./lock.ts";
import type { Lockfile } from "./lock.ts";

export async function readLockfile(dir: string): Promise<Lockfile | undefined> {
  const file = builtin.path.join(dir, LOCKFILE);
  let text: string;
  try {
    text = await builtin.fsp.readFile(file, "utf8");
  } catch (error) {
    if ((error as { code?: string }).code === "ENOENT") return undefined;
    throw fail(`cannot read ${file}: ${(error as Error).message}`);
  }
  trace("lockparsed");
  return parseLockfile(text);
}

export async function writeLockfile(dir: string, lock: Lockfile): Promise<void> {
  const file = builtin.path.join(dir, LOCKFILE);
  const temp = `${file}.${pid}-${globalThis.crypto.randomUUID()}.tmp`;
  try {
    await builtin.fsp.writeFile(temp, formatLockfile(lock));
    await replaceFile(temp, file); // atomic, so a reader never sees a half-written lockfile
  } catch (error) {
    await rmIfExists(temp, { force: true });
    throw fail(`cannot write ${file}: ${(error as Error).message}`);
  }
}

function fail(message: string): Error {
  return Object.assign(new Error(message), { code: "ELOCK" });
}
