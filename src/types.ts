// Shapes returned by an npm-compatible registry.

export interface Dist {
  tarball: string;
  integrity?: string;
  shasum?: string;
}

export interface Manifest {
  name: string;
  version: string;
  dependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  peerDependenciesMeta?: Record<string, { optional?: boolean }>;
  bin?: unknown;
  engines?: Record<string, string>;
  os?: string[];
  cpu?: string[];
  libc?: string[];
  dist: Dist;
  deprecated?: string;
  hasInstallScript?: boolean;
  license?: string | { type: string };
  funding?: string | Record<string, unknown>;
}

export interface Packument {
  name: string;
  "dist-tags": Record<string, string>;
  versions: Record<string, Manifest>;
  modified?: string;
  /** Publish date per version: full documents only. */
  time?: Record<string, string>;
  /** Not the registry's: set when min-release-age hid versions, the cutoff as an ISO date. */
  before?: string;
}
