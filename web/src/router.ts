// Moves between the landing and the playground in place. Both open with the hero, so a view
// transition morphs one into the other, both ways. The docs load as a page of their own.
import { NPM } from "./lib/route.ts";

interface Page {
  /** Returns how to take the page down, if it needs to. */
  mount(root: HTMLElement, ready?: Promise<unknown>): (() => void) | void;
}

const root = document.getElementById("root")!;
const DOCS = /^\/docs\/?$/;
let shown: string | undefined;
let unmount: (() => void) | void;
let latest = 0;

function load(path: string): Promise<Page> {
  if (path.startsWith(NPM)) return import("./play.tsx");
  if (DOCS.test(path)) return import("./docs.ts");
  return import("./landing.ts");
}

/** Shows the page for the URL, in a view transition when `morph`. */
export async function route(morph = false) {
  const path = location.pathname;
  const id = ++latest;
  // Loaded before the transition: the page is frozen while its callback runs.
  const page = await load(path);
  if (id !== latest) return;
  const show = (ready?: Promise<unknown>) => {
    unmount?.();
    root.replaceChildren();
    shown = path;
    unmount = page.mount(root, ready);
  };
  if (!morph || !document.startViewTransition) return show();
  // Which way the hero goes, for src/style.css.
  document.documentElement.dataset.to = path.startsWith(NPM) ? "play" : "landing";
  // The playground's run starts once the animation ends; its work on this thread would drop frames.
  const transition = document.startViewTransition(() => show(transition.finished.catch(() => {})));
}

export function navigate(path: string) {
  if (path === location.pathname) return;
  history.pushState(null, "", path);
  void route(true);
}

// A hash link changes the entry but not the page.
addEventListener("popstate", () => {
  if (location.pathname !== shown) void route(true);
});

// Links between the landing and the playground stay in the page.
root.addEventListener("click", (e) => {
  const link = (e.target as Element).closest("a");
  // A click that asks for a new tab or window keeps the link's own way.
  if (!link || e.button || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || link.target) return;
  if (link.origin !== location.origin || DOCS.test(link.pathname) || DOCS.test(shown ?? "")) return;
  e.preventDefault();
  navigate(link.pathname);
});
