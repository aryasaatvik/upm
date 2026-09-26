// A package's Markdown, rendered by md4x's wasm build (its `browser` export).
import { highlightText } from "rangi";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Pulse, Waiting } from "./ui.tsx";

type Md4x = typeof import("md4x");

let ready: Promise<Md4x> | undefined;

/**
 * md4x in its own chunk, loaded once. A run calls this as it starts, so the wasm is ready by the
 * time the tarball lands with the README.
 */
export function loadMarkdown(): Promise<Md4x> {
  if (!ready) {
    ready = import("md4x").then(async (md4x) => {
      await md4x.init();
      return md4x;
    });
    // A failed load tries again on the next run.
    ready.catch(() => (ready = undefined));
  }
  return ready;
}

/**
 * Markdown keeps raw HTML, and a README is the publisher's, so the result goes into a sandboxed
 * frame: no scripts, an opaque origin, and a CSP that loads only images and inline styles.
 * `base` resolves the README's relative links and images.
 */
export function Markdown({ text, base }: { text: string; base: string }) {
  const [loaded, setLoaded] = useState<Md4x | Error>();
  useEffect(() => {
    loadMarkdown().then(setLoaded, (error: Error) => setLoaded(error));
  }, []);
  const doc = useMemo(
    () => (loaded && !(loaded instanceof Error) ? page(render(loaded, text), base) : ""),
    [loaded, text, base],
  );
  if (!loaded) return <MarkdownSkeleton />;
  if (loaded instanceof Error) return <Waiting>md4x failed to load: {loaded.message}</Waiting>;
  return (
    <iframe
      title="README"
      sandbox="allow-popups allow-popups-to-escape-sandbox"
      srcDoc={doc}
      className="block h-full w-full border-0"
    />
  );
}

/** A README's shape while it loads: a title, badges, prose, headings and a code block. */
export function MarkdownSkeleton({ children }: { children?: ReactNode }) {
  const bar = "rounded bg-zinc-200/80 dark:bg-zinc-800";
  const lines = (widths: string[]) => (
    <div className="space-y-2.5">
      {widths.map((width, i) => (
        <div key={i} className={`h-3 ${bar} ${width}`} />
      ))}
    </div>
  );
  const heading = (width: string) => (
    <div className="border-b border-zinc-200 pb-2.5 dark:border-zinc-800">
      <div className={`h-5 ${bar} ${width}`} />
    </div>
  );
  return (
    <div
      role="status"
      aria-label="Loading README"
      className="flex h-full animate-appear flex-col overflow-hidden"
    >
      <div className="mx-auto w-full max-w-[860px] min-h-0 flex-1 space-y-6 px-8 pt-8 motion-safe:animate-pulse">
        <div className="space-y-4 border-b border-zinc-200 pb-4 dark:border-zinc-800">
          <div className={`h-8 w-2/5 ${bar}`} />
          <div className="flex gap-1.5">
            {["w-20", "w-24", "w-16", "w-20"].map((width, i) => (
              <div key={i} className={`h-5 rounded-sm bg-zinc-200/80 dark:bg-zinc-800 ${width}`} />
            ))}
          </div>
        </div>
        {lines(["w-full", "w-11/12", "w-3/5"])}
        {heading("w-1/4")}
        {lines(["w-10/12", "w-2/3"])}
        <div className="h-28 rounded-md border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
          <div className="space-y-2.5">
            {["w-1/3", "w-1/2", "w-2/5"].map((width, i) => (
              <div key={i} className={`h-2.5 ${bar} ${width}`} />
            ))}
          </div>
        </div>
        {heading("w-1/5")}
        {lines(["w-full", "w-4/5", "w-11/12", "w-1/2"])}
      </div>
      {children && (
        <div className="flex h-9 shrink-0 items-center justify-center gap-2 text-xs text-zinc-500">
          <Pulse />
          {children}
        </div>
      )}
    </div>
  );
}

function render({ renderToHtml }: Md4x, text: string): string {
  return renderToHtml(text, {
    headingIds: true,
    // rangi escapes the code; md4x puts what this returns in place of its own block.
    highlighter: (code, { lang }) =>
      `<pre>${highlightText(code, { lang: lang || "plain", lineNumbers: false })}</pre>`,
  });
}

function page(body: string, base: string): string {
  const csp = "default-src 'none'; img-src https: data:; style-src 'unsafe-inline'";
  return `<!doctype html><html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<base href="${encodeURI(base)}" target="_blank">
<style>${STYLE}</style></head><body>${body}</body></html>`;
}

const STYLE = `
:root { color-scheme: light dark; }
* { scrollbar-width: thin; scrollbar-color: light-dark(#d4d4d8, #3f3f46) transparent; }
::-webkit-scrollbar { width: 10px; height: 10px; }
::-webkit-scrollbar-track, ::-webkit-scrollbar-corner { background: transparent; }
::-webkit-scrollbar-thumb { border: 3px solid transparent; border-radius: 9999px;
  background: light-dark(#d4d4d8, #3f3f46) padding-box; }
body {
  margin: 0 auto; max-width: 860px; padding: 24px 32px 48px;
  font: 14px/1.6 ui-sans-serif, system-ui, sans-serif;
  background: transparent; color: light-dark(#27272a, #d4d4d8);
}
h1, h2, h3, h4 { color: light-dark(#18181b, #fafafa); line-height: 1.25; margin: 1.5em 0 .6em; }
h1, h2 { padding-bottom: .3em; border-bottom: 1px solid light-dark(#e4e4e7, #27272a); }
h1 { font-size: 1.9em; } h2 { font-size: 1.45em; } h3 { font-size: 1.2em; }
a { color: light-dark(#b45309, #fbbf24); text-decoration: none; }
a:hover { text-decoration: underline; }
img { max-width: 100%; }
p img { vertical-align: middle; }
code, pre { font: 12px/1.5 ui-monospace, "SF Mono", Menlo, monospace; }
:not(pre) > code { padding: .15em .35em; border-radius: 4px; background: light-dark(#f4f4f5, #27272a); }
pre { padding: 12px 16px; border-radius: 6px; overflow: auto; background: light-dark(#fff, #18181b);
  border: 1px solid light-dark(#e4e4e7, #27272a); }
blockquote { margin: 0; padding: 0 1em; color: light-dark(#71717a, #a1a1aa);
  border-left: 3px solid light-dark(#e4e4e7, #3f3f46); }
table { border-collapse: collapse; display: block; overflow: auto; }
th, td { padding: 6px 12px; border: 1px solid light-dark(#e4e4e7, #3f3f46); }
hr { border: 0; border-top: 1px solid light-dark(#e4e4e7, #27272a); }
`;
