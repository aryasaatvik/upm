// `virtual:readme`: the repo's README.md as HTML, rendered by md4x at build time, for the landing.
// Its opening logo heading is `virtual:readme/logo` instead, so the app can draw the
// logo without loading the README. The site also serves it for agents: `/README.md` as is, and
// `/llms.txt` as plain text.
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { init, renderToHtml, renderToText } from "md4x";
import { highlightText } from "rangi";
import type { Plugin } from "vite";

const BODY = "virtual:readme";
const LOGO = "virtual:readme/logo";

/** `repo` is where relative links that are not images go, e.g. `https://github.com/unjs/upm/blob/main/`. */
export function readme(file: string, repo: string): Plugin {
  const files = async (): Promise<Record<string, string>> => {
    await init();
    // Relative links and images point at the repo, so they work from the site's root.
    const md = readFileSync(file, "utf8").replace(
      /(\]\(|\b(?:src|srcset|href)=")(?:\.\/)?(?![a-z][\w+.-]*:|[#/])/gi,
      `$1${repo}`,
    );
    return { "README.md": md, "llms.txt": `# upm\n\n${renderToText(md)}` };
  };
  return {
    name: "upm:readme",
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const name = req.url?.slice(1);
        if (name !== "README.md" && name !== "llms.txt") return next();
        res.setHeader(
          "content-type",
          `text/${name === "llms.txt" ? "plain" : "markdown"}; charset=utf-8`,
        );
        res.end((await files())[name]);
      });
    },
    async generateBundle() {
      if (this.environment.name !== "client") return;
      for (const [fileName, source] of Object.entries(await files())) {
        this.emitFile({ type: "asset", fileName, source });
      }
    },
    resolveId: (id) => (id === BODY || id === LOGO ? `\0${id}` : undefined),
    async load(id) {
      if (id !== `\0${BODY}` && id !== `\0${LOGO}`) return;
      this.addWatchFile(file);
      await init();
      let html = renderToHtml(readFileSync(file, "utf8"), {
        headingIds: true,
        highlighter: (code, { lang }) =>
          `<pre>${highlightText(code, { lang: lang || "plain", lineNumbers: false })}</pre>`,
      });
      html = byScheme(html);
      // The logo is what the first heading holds; the body is what follows it.
      const open = html.indexOf(">", html.indexOf("<h1")) + 1;
      const close = html.indexOf("</h1>");
      return id === `\0${LOGO}`
        ? toModule(html.slice(open, close), file, repo)
        : toModule(html.slice(close + "</h1>".length), file, repo);
    },
  };
}

/** A `<picture>` follows the system's scheme, not the site's toggle: one image per scheme
 * instead, each hidden in the other. */
function byScheme(html: string): string {
  return html.replace(/<picture>([\s\S]*?)<\/picture>/g, (picture, inner: string) => {
    const alt = /\balt="([^"]*)"/.exec(inner)?.[1] ?? "";
    const sources = [
      ...inner.matchAll(/<source media="\(prefers-color-scheme: (light|dark)\)" srcset="([^"]+)"/g),
    ];
    if (!sources.length) return picture;
    return sources
      .map(
        ([, scheme, src]) =>
          `<img src="${src}" alt="${alt}" class="${scheme === "dark" ? "hidden dark:block" : "dark:hidden"}">`,
      )
      .join("");
  });
}

/** A module whose default export is `html`, with its local images imported. */
function toModule(html: string, file: string, repo: string): string {
  // Local images become imports, so Vite serves and bundles them. `no-inline`: a data URL
  // has commas, which `srcset` would split on.
  const images: string[] = [];
  const parts = html
    .replace(/\b(src|srcset|href)="(?![a-z][\w+.-]*:|[#/])([^"]+)"/gi, (_, attr, path) => {
      if (attr === "href") return `href="${repo}${path.replace(/^\.\//, "")}"`;
      images.push(resolve(dirname(file), path));
      return `${attr}="\0"`;
    })
    .split("\0");
  const imports = images.map(
    (path, i) => `import i${i} from ${JSON.stringify(`${path}?no-inline`)};`,
  );
  const body = parts.map((part, i) => (i ? `i${i - 1} + ` : "") + JSON.stringify(part));
  return `${imports.join("\n")}\nexport default ${body.join(" + ")};`;
}
