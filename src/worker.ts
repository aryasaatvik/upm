export { lockProject } from "./lock-project.ts";
export type { LockInput } from "./lock-project.ts";
export { materialize } from "./materialize.ts";
export type { MaterializeInput, MaterializeLimits } from "./materialize.ts";
export { noTarballCache } from "./tarball-cache.ts";
export type { TarballCache } from "./tarball-cache.ts";
export { UpmError } from "./error.ts";
export {
  parsePackageLock,
  fromPackageLock,
  toPackageLock,
  formatPackageLock,
} from "./package-lock.ts";
export type { PackageJson, PackageLock, PackageLockEntry, Placement } from "./package-lock.ts";
export { hoist, checkPlacement } from "./hoist.ts";
