// Sync twin of `hashOf` for fixtures. Tests build integrity strings inline all over; the real
// one went async for the web and would turn every fixture line into an await.
import { createHash } from "node:crypto";

export const hashOf = (data: Uint8Array, algorithm = "sha512"): string =>
  `${algorithm}-${createHash(algorithm).update(data).digest("base64")}`;
