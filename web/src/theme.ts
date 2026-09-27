// The light and dark toggle. With no theme stored, the page follows the system; index.html
// sets the stored one before the page paints, and src/style.css reads it.
type Scheme = "light" | "dark";

const html = document.documentElement;
const system = matchMedia("(prefers-color-scheme: dark)");

/** The media query that shows content made for `scheme`, e.g. a README's `<picture>` source. */
export function schemeMedia(scheme: Scheme): string {
  const theme = html.dataset.theme;
  return theme ? (theme === scheme ? "all" : "not all") : `(prefers-color-scheme: ${scheme})`;
}

function apply(theme: Scheme | undefined) {
  if (theme) html.dataset.theme = theme;
  else delete html.dataset.theme;
  // The browser's bar color and the images made for one scheme follow the page, not the system.
  for (const el of document.querySelectorAll<HTMLMetaElement | HTMLSourceElement>(
    "[data-scheme]",
  )) {
    el.media = schemeMedia(el.dataset.scheme as Scheme);
  }
}

// Any `[data-theme-toggle]` flips the theme. One that matches the system goes back to following it.
addEventListener("click", (e) => {
  if (!(e.target as Element).closest?.("[data-theme-toggle]")) return;
  const dark = html.dataset.theme ? html.dataset.theme === "dark" : system.matches;
  const next = dark ? "light" : "dark";
  const theme = (next === "dark") === system.matches ? undefined : next;
  try {
    if (theme) localStorage.setItem("theme", theme);
    else localStorage.removeItem("theme");
  } catch {}
  apply(theme);
});

apply(html.dataset.theme as Scheme | undefined);
