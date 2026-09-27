// The docs: the repo's README, under a bar with the logo back home. Plain DOM, no React.
import readme from "virtual:readme";
import { KEY, LINK, LOGO, logo, OCTOCAT, REPO, svg, toggle } from "./components/hero.ts";

export function mount(root: HTMLElement) {
  const title = document.title;
  document.title = "upm · Docs";
  root.innerHTML = `
<header class="mx-auto flex max-w-[860px] items-center justify-between px-4 pt-4 text-xs sm:px-8">
  <a href="/" title="upm" data-key="u" class="${LOGO} h-8 [&_img]:h-8">${logo}</a>
  <nav class="flex items-center gap-2">
    <a href="${REPO}" target="_blank" rel="noreferrer" data-key="g" class="${LINK}">${svg(OCTOCAT, 2)} <span><span class="${KEY}">G</span>itHub</span></a>
    ${toggle()}
  </nav>
</header>
<article class="readme">${readme}</article>`;
  // The headings came after the page loaded, so the browser did not scroll to the hash.
  if (location.hash)
    document.getElementById(decodeURIComponent(location.hash.slice(1)))?.scrollIntoView();
  return () => {
    document.title = title;
  };
}
