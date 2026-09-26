import { pathOf } from "./lib/route.ts";
import { route } from "./router.ts";

// Links from before the `/npm/` route.
const q = new URLSearchParams(location.search).get("q");
if (q) location.replace(pathOf(q.trim()));
else void route();
