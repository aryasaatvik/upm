// The hero both pages open with: the README's logo and the spec box. Both pages build it from
// these classes: large and centered on the landing, small in one row at the top of the
// app. Their view-transition names let the logo and the box morph from one to the other.
export { default as logo } from "virtual:readme/logo";

/** The top-right links, Docs and GitHub, each an icon and a label, then the theme toggle. `data-key` names the key
 * that opens one (src/router.ts), and `KEY` underlines that letter in the label. */
export const NAV = "absolute top-3 right-4 flex items-center gap-1 text-xs sm:right-8";
const ITEM =
  "h-6.5 rounded-md font-medium text-zinc-700 transition-colors hover:bg-zinc-200/70 hover:text-amber-600 dark:text-zinc-300 dark:hover:bg-zinc-800 dark:hover:text-amber-400";
export const LINK = `flex items-center gap-1.5 px-2.5 ${ITEM}`;
/** The theme toggle (src/theme.ts), a square as tall as the links. */
export const TOGGLE = `grid w-6.5 cursor-pointer place-items-center ${ITEM}`;
export const KEY = "underline underline-offset-2";
export const REPO = "https://github.com/unjs/upm";
export const LOGO =
  "flex justify-center [view-transition-name:logo] [&_img]:w-auto [&_img]:max-w-none";
export const FORM =
  "group mx-auto flex items-stretch overflow-hidden rounded-xl border border-zinc-300 bg-(--editor-bg) shadow-sm transition [view-transition-name:spec] hover:border-zinc-400 focus-within:border-amber-500 focus-within:ring-4 focus-within:ring-amber-500/15 focus-within:hover:border-amber-500 dark:border-zinc-700 dark:hover:border-zinc-600";
export const INPUT =
  "min-w-0 flex-1 bg-transparent px-3 font-mono outline-none placeholder:text-zinc-400";
export const PLACEHOLDER = "Any package, e.g. vue@^3";
export const BUTTON =
  "group/go flex items-center gap-1.5 border-l border-zinc-200 bg-zinc-50 px-3 font-medium text-zinc-700 transition-colors group-focus-within:border-amber-500 group-focus-within:bg-amber-500 group-focus-within:text-zinc-950 hover:bg-amber-500 hover:text-zinc-950 sm:px-4 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-300";

/** The hero's sizes, added to the classes above. */
export const SMALL = {
  logo: "h-7 justify-self-start [&_img]:h-7",
  form: "h-9 w-full text-sm",
};
export const LARGE = {
  logo: "h-16 sm:h-20 [&_img]:h-16 sm:[&_img]:h-20",
  form: "mt-3 h-13 w-full max-w-2xl text-sm",
};

/** Icons as `<svg>` contents, with the classes each one takes. */
export const SEARCH = {
  className: "ml-4 size-4 shrink-0 self-center text-zinc-400 group-focus-within:text-amber-500",
  paths: `<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>`,
};
export const BOOK = {
  className: "size-3.5",
  paths: `<path d="M2 4h6a4 4 0 0 1 4 4v13a3 3 0 0 0-3-3H2zM22 4h-6a4 4 0 0 0-4 4v13a3 3 0 0 1 3-3h7z"/>`,
};
export const OCTOCAT = {
  className: "size-3.5",
  paths: `<path d="M15 22v-4a4.8 4.8 0 0 0-1-3.5c3 0 6-2 6-5.5.08-1.25-.27-2.48-1-3.5.28-1.15.28-2.35 0-3.5 0 0-1 0-3 1.5-2.64-.5-5.36-.5-8 0C6 2 5 2 5 2c-.3 1.15-.3 2.35 0 3.5A5.4 5.4 0 0 0 4 9c0 3.5 3 5.5 6 5.5-.39.49-.68 1.05-.85 1.65S8.93 17.38 9 18v4"/><path d="M9 18c-4.51 2-5-2-7-2"/>`,
};
/** The toggle shows the theme it switches to. */
export const MOON = {
  className: "size-3.5 dark:hidden",
  paths: `<path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9"/>`,
};
export const SUN = {
  className: "hidden size-3.5 dark:block",
  paths: `<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/>`,
};
export const ARROW = {
  className: "size-4 transition-transform group-hover/go:translate-x-0.5",
  paths: `<path d="M5 12h14M13 6l6 6-6 6"/>`,
};

/** The theme toggle as HTML, for the pages built without React. */
export const toggle = () =>
  `<button type="button" title="Toggle dark mode" aria-label="Toggle dark mode" data-theme-toggle class="${TOGGLE}">${svg(MOON, 2)}${svg(SUN, 2)}</button>`;

/** An icon above as an `<svg>` string, for the pages built without React. */
export const svg = (icon: { className: string; paths: string }, width: number) =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${width}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" class="${icon.className}">${icon.paths}</svg>`;
