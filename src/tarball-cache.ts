/** A cache holds npm tarballs by their integrity, and may fail independently of installation. */
export interface TarballCache {
  get(integrity: string): Promise<Uint8Array | undefined>;
  put(integrity: string, bytes: Uint8Array): Promise<void>;
}

export const noTarballCache: TarballCache = {
  get: () => Promise.resolve(undefined),
  put: () => Promise.resolve(),
};
