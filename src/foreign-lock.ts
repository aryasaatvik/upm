// Filesystem bin lookup beside the portable foreign-lock reader.
import { builtin } from "./builtin.ts";
import { normalizeBin } from "./normalize-bin.ts";
import type { ResolvedPackage } from "./resolve.ts";
import type { Store } from "./store.ts";

export { loadForeign, beside, readForeign } from "./foreign-lock-core.ts";
export type { ForeignLock } from "./foreign-lock-core.ts";

export async function readBins(pkgs: ResolvedPackage[], store: Store): Promise<void> {
  await Promise.all(
    pkgs.map(async (pkg) => {
      try {
        await store.ensure(pkg.resolved, pkg.integrity);
      } catch (error) {
        if (pkg.optional) return; // the fill says so, and goes on without it
        throw error;
      }
      const file = store.index(pkg.integrity)?.files.find((f) => f.path === "package.json");
      if (!file) return;
      const text = await builtin.fsp.readFile(store.blobPath(file), "utf8");
      pkg.bin = normalizeBin(JSON.parse(text)); // an alias renames the package, never its bins
    }),
  );
}
