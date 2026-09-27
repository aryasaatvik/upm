// Routes: `/` is the landing, `/docs` the README, `/npm/<spec>` the app for a spec.
// Any other `/<spec>` redirects to `/npm/<spec>`.

export const NPM = "/npm/";
export const DOCS = /^\/docs\/?$/;

/** The spec in a `/npm/<spec>` path. */
export function specOf(pathname: string): string {
  return decodeURIComponent(pathname.slice(NPM.length)).replace(/\/$/, "");
}

/** A spec's path; a scope's `@` and `/` stay readable. */
export function pathOf(spec: string): string {
  return NPM + encodeURIComponent(spec).replace(/%40/g, "@").replace(/%2F/gi, "/");
}

/** Specs worth a try, offered on both pages: build and UI, then full-stack frameworks, then servers, then upm itself. */
export const EXAMPLES = [
  "vite",
  "vue",
  "nuxt",
  "next",
  "@tanstack/react-start",
  "nitro",
  "h3",
  "express",
  "upm",
];
