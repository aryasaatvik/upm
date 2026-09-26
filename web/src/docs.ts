// The docs: the repo's README, under a bar with the logo back home. Plain DOM, no React.
import readme from "virtual:readme";
import { GITHUB, logo, REPO } from "./components/hero.ts";

export function mount(root: HTMLElement) {
  document.title = "upm · Docs";
  root.innerHTML = `
<header class="mx-auto flex max-w-[860px] items-center justify-between px-4 pt-4 text-xs sm:px-8">
  <a href="/" title="upm" class="flex h-8 [&_img]:h-8 [&_img]:w-auto">${logo}</a>
  <a href="${REPO}" class="${GITHUB}">GitHub</a>
</header>
<article class="readme">${readme}</article>`;
  // The headings came after the page loaded, so the browser did not scroll to the hash.
  if (location.hash)
    document.getElementById(decodeURIComponent(location.hash.slice(1)))?.scrollIntoView();
}
