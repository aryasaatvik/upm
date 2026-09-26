// The landing: the hero, centered on the screen, with examples to try. Plain DOM, no React.
// A package opens in place (src/router.ts), so the logo and the box move up into the
// playground's top bar instead of the page reloading.
import {
  ARROW,
  BUTTON,
  DOCS,
  FORM,
  GITHUB,
  INPUT,
  LARGE,
  LOGO,
  logo,
  NAV,
  REPO,
  SEARCH,
} from "./components/hero.ts";
import { EXAMPLES, pathOf } from "./lib/route.ts";
import { navigate } from "./router.ts";

const INSTALL = "npm i -g upm";
// Lets npm install a release published moments ago; shown dimmed, but copied too.
const FLAGS = "--min-release-age 0";
const COPY = {
  className: "size-3.5",
  paths: `<rect width="14" height="14" x="8" y="8" rx="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>`,
};
const TERMINAL = { className: "size-4 text-amber-500", paths: `<path d="m4 17 6-6-6-6M12 19h8"/>` };
// The hexagon from bench/icons.ts, in Node's green.
const NODE = `<svg viewBox="0 0 27.713 32" fill="#5fa04e" aria-hidden="true" class="mb-0.5 inline size-3.5"><path d="M11.691 1.25Q13.856 0 16.021 1.25L25.548 6.75Q27.713 8 27.713 10.5L27.713 21.5Q27.713 24 25.548 25.25L16.021 30.75Q13.856 32 11.691 30.75L2.165 25.25Q0 24 0 21.5L0 10.5Q0 8 2.165 6.75Z"/></svg>`;
const BOOK = {
  className: "size-4",
  paths: `<path d="M2 4h6a4 4 0 0 1 4 4v13a3 3 0 0 0-3-3H2zM22 4h-6a4 4 0 0 0-4 4v13a3 3 0 0 1 3-3h7z"/>`,
};
const OCTOCAT = {
  className: "size-4",
  paths: `<path d="M15 22v-4a4.8 4.8 0 0 0-1-3.5c3 0 6-2 6-5.5.08-1.25-.27-2.48-1-3.5.28-1.15.28-2.35 0-3.5 0 0-1 0-3 1.5-2.64-.5-5.36-.5-8 0C6 2 5 2 5 2c-.3 1.15-.3 2.35 0 3.5A5.4 5.4 0 0 0 4 9c0 3.5 3 5.5 6 5.5-.39.49-.68 1.05-.85 1.65S8.93 17.38 9 18v4"/><path d="M9 18c-4.51 2-5-2-7-2"/>`,
};
const PILL =
  "flex items-center gap-2 rounded-full border border-zinc-300 bg-(--editor-bg) px-4 py-2 text-sm font-medium text-zinc-700 shadow-sm transition-colors hover:border-amber-500 hover:text-amber-600 dark:border-zinc-700 dark:text-zinc-300 dark:hover:text-amber-400";
const CHECK = { className: "size-3.5", paths: `<path d="M20 6 9 17l-5-5"/>` };

const svg = (icon: { className: string; paths: string }, width: number) =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${width}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" class="${icon.className}">${icon.paths}</svg>`;

export function mount(root: HTMLElement) {
  // Two equal spacers center the hero; the install card sits in the middle of the lower one.
  root.innerHTML = `
<main class="relative flex min-h-dvh flex-col px-4 sm:px-8">
  <nav class="${NAV}">
    <a href="/docs" class="${DOCS}">Docs</a>
    <a href="${REPO}" class="${GITHUB}">GitHub</a>
  </nav>
  <div class="min-h-20 flex-1"></div>
  <h1 class="${LOGO} ${LARGE.logo}"><a href="/">${logo}</a></h1>
  <p class="mt-6 text-center text-zinc-600 sm:mt-8 dark:text-zinc-400">A fast, tiny package manager for the npm registry</p>
  <form class="${FORM} ${LARGE.form}">
    ${svg(SEARCH, 2)}
    <input name="spec" placeholder="Try any package in your browser, e.g. vue@^3"
      spellcheck="false" autocapitalize="off" autocomplete="off" aria-label="Package spec" class="${INPUT}" />
    <button class="${BUTTON}">Explore ${svg(ARROW, 2.25)}</button>
  </form>
  <nav class="mt-4 flex flex-wrap items-center justify-center gap-1.5 text-xs">
    ${EXAMPLES.map((e) => `<a href="${pathOf(e)}" class="rounded-md border border-zinc-200 px-1.5 py-0.5 font-mono text-zinc-600 transition-colors hover:border-amber-500 hover:text-amber-600 dark:border-zinc-800 dark:text-zinc-400 dark:hover:text-amber-400">${e}</a>`).join("")}
  </nav>
  <nav class="mt-8 flex items-center justify-center gap-3">
    <a href="/docs" class="${PILL}">${svg(BOOK, 2)} Docs</a>
    <a href="${REPO}" class="${PILL}">${svg(OCTOCAT, 2)} GitHub</a>
  </nav>
  <div class="flex flex-1 flex-col items-center justify-center py-10">
    <aside class="install w-full max-w-lg overflow-hidden rounded-2xl border border-zinc-200 bg-(--editor-bg) shadow-2xl shadow-amber-500/10 dark:border-zinc-800">
      <header class="flex items-center gap-2 border-b border-zinc-200 bg-(--chrome-bg) px-5 py-3 dark:border-zinc-800">
        ${svg(TERMINAL, 2)}
        <h2 class="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Install upm</h2>
      </header>
      <div class="p-5">
        <button type="button" title="Copy to clipboard" class="group/copy flex w-full cursor-pointer items-center gap-2 rounded-xl border border-zinc-200 bg-(--chrome-bg) py-1.5 pr-1.5 pl-3 text-left font-mono text-sm transition-colors hover:border-amber-500 dark:border-zinc-800 dark:hover:border-amber-500">
          <span class="text-amber-500 select-none">$</span>
          <code class="min-w-0 flex-1 truncate text-zinc-800 dark:text-zinc-200">${INSTALL} <span class="text-zinc-400 dark:text-zinc-500">${FLAGS}</span></code>
          <span data-icon class="shrink-0 rounded-lg bg-amber-500 p-2 text-zinc-950 transition-colors group-hover/copy:bg-amber-400">${svg(COPY, 2)}</span>
        </button>
        <p class="mt-3 text-sm text-zinc-500">Works with ${NODE} Node.js, your existing <code class="rounded bg-zinc-100 px-1 py-0.5 font-mono text-xs text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">.npmrc</code> and npm, pnpm or bun lockfiles. Takes <strong class="font-semibold text-amber-600 dark:text-amber-400">~250 KB</strong> of disk space.</p>
      </div>
    </aside>
  </div>
</main>`;
  const form = root.querySelector("form")!;
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const spec = new FormData(form).get("spec")?.toString().trim();
    if (spec) navigate(pathOf(spec));
  });
  const icon = root.querySelector<HTMLElement>(".install [data-icon]")!;
  let reset: ReturnType<typeof setTimeout> | undefined;
  icon.parentElement!.addEventListener("click", () => {
    void navigator.clipboard.writeText(`${INSTALL} ${FLAGS}`);
    icon.innerHTML = svg(CHECK, 2.5);
    clearTimeout(reset);
    reset = setTimeout(() => (icon.innerHTML = svg(COPY, 2)), 1500);
  });
  // Load the playground once the page is in use, so a package opens without a wait.
  root.addEventListener("pointerover", loadPlay, { once: true });
  root.addEventListener("focusin", loadPlay, { once: true });
}

const loadPlay = () => import("./play.tsx");
