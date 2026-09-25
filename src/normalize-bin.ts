// Port of `npm-normalize-package-bin`. Security critical: a bin key or target
// that escapes its package would let an install write outside `node_modules/.bin`.
export interface BinPkg {
  name?: string;
  bin?: unknown;
  directories?: { bin?: string };
}

const UNSAFE = new Set(["", ".", ".."]);

/**
 * Turn a package's `bin` field into a clean `{ name: relativeTarget }` map.
 * Returns an empty object when there is nothing usable.
 *
 * `directories.bin` is not supported: resolving it means listing a directory,
 * and this module is pure. Packages using it get no bins.
 */
export function normalizeBin(pkg: BinPkg): Record<string, string> {
  const bin = pkg.bin;
  if (typeof bin === "string") {
    // A string bin is named after the package itself.
    return typeof pkg.name === "string" && pkg.name ? clean({ [pkg.name]: bin }) : {};
  }
  if (Array.isArray(bin)) {
    const byBasename: Record<string, unknown> = {};
    for (const entry of bin) {
      if (typeof entry === "string") {
        byBasename[basename(entry)] = entry;
      }
    }
    return clean(byBasename);
  }
  if (bin !== null && typeof bin === "object") {
    return clean(bin as Record<string, unknown>);
  }
  return {};
}

function clean(bin: Record<string, unknown>): Record<string, string> {
  // A Map keeps `__proto__` an ordinary key until `fromEntries` makes it an own property.
  const out = new Map<string, string>();
  for (const [rawKey, rawTarget] of Object.entries(bin)) {
    if (typeof rawTarget !== "string") continue;
    const key = basename(rawKey.replaceAll(/[\\:]/g, "/"));
    if (UNSAFE.has(key)) continue;
    const target = rooted(rawTarget.replaceAll("\\", "/"));
    if (UNSAFE.has(target)) continue;
    out.set(key, target);
  }
  return Object.fromEntries(out);
}

/** `path.posix.basename`, without `path`: these run wherever the resolver does. */
function basename(p: string): string {
  let end = p.length;
  while (end > 0 && p.charCodeAt(end - 1) === 47) end--; // trailing slashes; a regex here is quadratic
  return p.slice(p.lastIndexOf("/", end - 1) + 1, end);
}

/** `path.posix.join("/", p).slice(1)`: `.` and `..` collapsed, never above the root, no leading `/`. */
function rooted(p: string): string {
  const parts: string[] = [];
  for (const part of p.split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") parts.pop();
    else parts.push(part);
  }
  const joined = parts.join("/");
  return joined && p.endsWith("/") ? `${joined}/` : joined;
}
