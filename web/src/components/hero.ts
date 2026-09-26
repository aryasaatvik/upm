// The hero both pages open with: the README's logo and the spec box. Both pages build it from
// these classes: large and centered on the landing, small at the top of the playground. Their
// view-transition names let the logo and the box morph from one to the other.
export { default as logo } from "virtual:readme/logo";

export const HERO = "relative shrink-0 px-4 pt-6 sm:px-8 sm:pt-8";
/** The top-right links: the docs as a button, then GitHub. */
export const NAV = "absolute top-3 right-4 flex items-center gap-3 text-xs sm:right-8";
export const DOCS =
  "rounded-md border border-zinc-300 px-2.5 py-1 font-medium text-zinc-700 transition-colors hover:border-amber-500 hover:text-amber-600 dark:border-zinc-700 dark:text-zinc-300 dark:hover:text-amber-400";
export const GITHUB = "text-zinc-500 hover:text-amber-600";
export const REPO = "https://github.com/unjs/upm";
export const LOGO = "flex justify-center [view-transition-name:logo] [&_img]:w-auto";
export const FORM =
  "group mx-auto flex items-stretch overflow-hidden rounded-xl border border-zinc-300 bg-(--editor-bg) shadow-sm transition [view-transition-name:spec] hover:border-zinc-400 focus-within:border-amber-500 focus-within:ring-4 focus-within:ring-amber-500/15 focus-within:hover:border-amber-500 dark:border-zinc-700 dark:hover:border-zinc-600";
export const INPUT =
  "min-w-0 flex-1 bg-transparent px-3 font-mono outline-none placeholder:text-zinc-400";
export const PLACEHOLDER = "Any package, e.g. vue@^3";
export const BUTTON =
  "group/go flex items-center gap-1.5 border-l border-zinc-200 bg-zinc-50 px-3 font-medium text-zinc-700 transition-colors group-focus-within:border-amber-500 group-focus-within:bg-amber-500 group-focus-within:text-zinc-950 hover:bg-amber-500 hover:text-zinc-950 sm:px-4 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-300";

/** The hero's sizes, added to the classes above. */
export const SMALL = {
  logo: "h-12 [&_img]:h-12",
  form: "mt-4 h-12 max-w-xl text-sm sm:mt-6",
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
export const ARROW = {
  className: "size-4 transition-transform group-hover/go:translate-x-0.5",
  paths: `<path d="M5 12h14M13 6l6 6-6 6"/>`,
};
