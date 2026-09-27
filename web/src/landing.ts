// The landing: the hero, centered on the screen, with examples to try. Plain DOM, no React.
// A package opens in place (src/router.ts), so the logo and the box move up into the
// app's top bar instead of the page reloading.
import {
  ARROW,
  BOOK,
  BUTTON,
  FORM,
  INPUT,
  KEY,
  LARGE,
  LINK,
  LOGO,
  logo,
  NAV,
  OCTOCAT,
  REPO,
  SEARCH,
  svg,
  toggle,
} from "./components/hero.ts";
import { bindInstall, installCard } from "./components/install.ts";
import { EXAMPLES, pathOf } from "./lib/route.ts";
import { navigate } from "./router.ts";

// Vercel's triangle, in the text color.
const VERCEL = `<svg viewBox="0 0 76 65" fill="currentColor" aria-hidden="true" class="size-2.5"><path d="M37.53 0 75.05 65H0Z"/></svg>`;
// Short names for long example specs.
const LABELS: Record<string, string> = { "@tanstack/react-start": "tanstack" };
const PILL =
  "flex items-center gap-2 rounded-full border border-zinc-300 bg-(--editor-bg) px-4 py-2 text-sm font-medium text-zinc-700 shadow-sm transition-colors hover:border-amber-500 hover:text-amber-600 dark:border-zinc-700 dark:text-zinc-300 dark:hover:text-amber-400";
const PILL_ICON = (icon: typeof BOOK) => ({ ...icon, className: "size-4" });

// Fisher-Yates on a copy, so each visit offers the examples in a new order.
function shuffle<T>(items: readonly T[]): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

export function mount(root: HTMLElement) {
  // Two equal spacers center the hero; the install card sits in the middle of the lower one.
  root.innerHTML = `
<main class="relative flex min-h-dvh flex-col px-4 sm:px-8">
  <nav class="${NAV}">
    <a href="/docs" data-key="d" class="${LINK}">${svg(BOOK, 2)} <span><span class="${KEY}">D</span>ocs</span></a>
    <a href="${REPO}" target="_blank" rel="noreferrer" data-key="g" class="${LINK}">${svg(OCTOCAT, 2)} <span><span class="${KEY}">G</span>itHub</span></a>
    ${toggle()}
  </nav>
  <div class="min-h-20 flex-1"></div>
  <h1 class="${LOGO} ${LARGE.logo}"><a href="/">${logo}</a></h1>
  <p class="mt-6 text-center text-zinc-600 sm:mt-8 dark:text-zinc-400">A fast, tiny package manager for the npm registry</p>
  <form class="${FORM} ${LARGE.form}">
    ${svg(SEARCH, 2)}
    <input name="spec" placeholder="Try any package in your browser, e.g. vue@^3"
      spellcheck="false" autocapitalize="off" autocomplete="off" aria-label="Package spec" data-key="k" class="${INPUT}" />
    <button class="${BUTTON}">Explore ${svg(ARROW, 2.25)}</button>
  </form>
  <nav class="mt-4 flex flex-wrap items-center justify-center gap-x-4 gap-y-2 text-xs">
    ${shuffle(EXAMPLES)
      .map(
        (e) =>
          `<a href="${pathOf(e)}" class="border-b border-current pb-0.5 font-mono text-zinc-500 transition-colors hover:text-amber-600 dark:text-zinc-400 dark:hover:text-amber-400" title="${e}">${LABELS[e] ?? e}</a>`,
      )
      .join("")}
  </nav>
  <nav class="mt-12 flex items-center justify-center gap-3">
    <a href="/docs" class="${PILL}">${svg(PILL_ICON(BOOK), 2)} Docs</a>
    <a href="${REPO}" target="_blank" rel="noreferrer" class="${PILL}">${svg(PILL_ICON(OCTOCAT), 2)} GitHub</a>
  </nav>
  <div class="flex flex-1 flex-col items-center justify-center py-10">
    ${installCard("w-full max-w-lg")}
  </div>
  <a href="https://vercel.com/?utm_source=upm&utm_campaign=oss" target="_blank" rel="noreferrer" class="absolute bottom-3 left-1/2 flex -translate-x-1/2 items-center gap-1.5 text-[10px] font-medium text-zinc-500 transition-colors hover:text-zinc-900 dark:hover:text-zinc-100">${VERCEL} Sponsored by Vercel</a>
</main>`;
  const form = root.querySelector("form")!;
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const spec = new FormData(form).get("spec")?.toString().trim();
    if (spec) navigate(pathOf(spec));
  });
  bindInstall(root.querySelector("aside")!);
  // Focused before the listeners below, so opening the page does not count as using it.
  form.querySelector("input")!.focus();
  // Load the app once the page is in use, so a package opens without a wait.
  root.addEventListener("pointerover", loadPlay, { once: true });
  root.addEventListener("focusin", loadPlay, { once: true });
  root.addEventListener("input", loadPlay, { once: true });
}

const loadPlay = () => import("./play.tsx");
