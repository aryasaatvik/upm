import { DOCS, NPM, pathOf } from "./lib/route.ts";
import { route } from "./router.ts";

const { pathname, search, hash } = location;
// Links from before the `/npm/` route.
const q = new URLSearchParams(search).get("q");
if (q) location.replace(pathOf(q.trim()));
else {
  // `/<spec>` is short for `/npm/<spec>`.
  if (pathname !== "/" && !pathname.startsWith(NPM) && !DOCS.test(pathname)) {
    const spec = decodeURIComponent(pathname.slice(1)).replace(/\/$/, "");
    history.replaceState(null, "", pathOf(spec) + search + hash);
  }
  void route();
}
