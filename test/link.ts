// Where a link leads, spelled with `/`. Windows makes directory links junctions, which read
// back absolute, and spells paths with `\`; tests assert the relative, portable form.
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { readLink } from "../src/util.ts";

export async function linkOf(at: string): Promise<string> {
  const found = await readLink(at);
  if (found === undefined) throw new Error(`not a link: ${at}`);
  return process.platform === "win32" ? found.replaceAll("\\", "/") : found;
}

/** Where a bin leads from `.bin`: a link's target, or on Windows the file its shims run. */
export async function binOf(at: string): Promise<string> {
  if (process.platform !== "win32") return await linkOf(at);
  const found = /"\$basedir(?:_win)?\/([^"]+)"/.exec(await readFile(at, "utf8"));
  if (!found) throw new Error(`not a shim: ${at}`);
  return found[1]!;
}

/** The bin's file, read through the link or the shim. */
export async function readBin(at: string): Promise<string> {
  return await readFile(join(dirname(at), await binOf(at)), "utf8");
}
