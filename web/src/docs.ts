// The docs: the repo's README, under a bar with the logo back home, and its headings on the side
// on wide screens. Plain DOM, no React.
import readme, { toc } from "virtual:readme";
import { KEY, LINK, LOGO, logo, OCTOCAT, REPO, svg, toggle } from "./components/hero.ts";

export function mount(root: HTMLElement) {
  const title = document.title;
  document.title = "upm · Docs";
  root.innerHTML = `
<header class="mx-auto flex max-w-[860px] items-center justify-between px-4 pt-4 text-xs sm:px-8">
  <a href="/" title="upm" data-key="u" class="${LOGO} h-8 [&_img]:h-8">${logo}</a>
  <nav class="flex items-center gap-1">
    <a href="${REPO}" target="_blank" rel="noreferrer" data-key="g" class="${LINK}">${svg(OCTOCAT, 2)} <span><span class="${KEY}">G</span>itHub</span></a>
    ${toggle()}
  </nav>
</header>
<div class="xl:grid xl:grid-cols-[1fr_860px_1fr]">
  <article class="readme xl:col-start-2">${readme}</article>
  <nav class="sticky top-0 hidden max-h-screen self-start overflow-auto py-9 pr-4 text-xs xl:block">
    <p class="mb-2 font-semibold text-zinc-900 dark:text-zinc-100">On this page</p>
    ${toc.map((h) => `<a href="#${h.id}" class="${TOC} ${h.level === 3 ? "pl-5" : "pl-2"}">${escape(h.text)}</a>`).join("")}
  </nav>
</div>`;
  // The headings came after the page loaded, so the browser did not scroll to the hash.
  if (location.hash)
    document.getElementById(decodeURIComponent(location.hash.slice(1)))?.scrollIntoView();
  // The link to the last heading scrolled past stands out.
  const links = root.querySelectorAll<HTMLElement>("nav a[href^='#']");
  const headings = toc.map((h) => document.getElementById(h.id));
  const spy = () => {
    let at = -1;
    for (const [i, h] of headings.entries()) if (h && h.getBoundingClientRect().top < 80) at = i;
    for (const [i, link] of links.entries()) link.toggleAttribute("data-at", i === at);
  };
  spy();
  addEventListener("scroll", spy, { passive: true });
  return () => {
    document.title = title;
    removeEventListener("scroll", spy);
  };
}

const TOC =
  "block truncate border-l border-zinc-200 py-1 pr-2 text-zinc-500 transition-colors hover:text-amber-600 data-at:border-amber-500 data-at:text-amber-600 dark:border-zinc-800 dark:text-zinc-400 dark:hover:text-amber-400 dark:data-at:border-amber-400 dark:data-at:text-amber-400";

const escape = (text: string) =>
  text.replace(/[&<>"]/g, (c) => `&${{ "&": "amp", "<": "lt", ">": "gt", '"': "quot" }[c]};`);
