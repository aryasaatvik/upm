# upm web

upm's site, built from `../src` (no build of upm needed). Three routes, one `index.html`:

- `/` is the landing: the logo and the spec box in the middle of the screen, with a Docs
  button in the top bar.
- `/docs` is the repo's `README.md`, rendered by md4x at build time (`readme.ts`, a Vite plugin
  that serves it as `virtual:readme`, with its logo split off as `virtual:readme/logo`).
  For agents, the same plugin serves the README as `/README.md` (the page's
  `rel="alternate"` link) and as plain text in `/llms.txt`.
- The landing and the app share the hero's classes (`src/components/hero.ts`), large
  on one and small on the other. `src/router.ts` moves between the two in place, in a view
  transition, so the logo and the box move into the app's top bar and back (the
  logo link, or the browser's back and forward). The app's run waits for the animation.
- `/npm/<spec>` is the app for a spec, e.g. `/npm/@nuxt/kit` or `/npm/vue@^3`. Any other
  `/<spec>` path and old `?q=<spec>` links redirect there.

`src/` holds the entries and the app's state (`app.tsx`), `src/components/` the UI, and
`src/lib/` the rest: the routes, the registry client and the in-tab install.

The nitro Vite plugin serves `index.html` for every path. `vite build` writes `.output/`, a
Node server by default (`node .output/server/index.mjs`); set `NITRO_PRESET` for another host.

## App

A browser client for upm. Enter a package spec:
it resolves the tree with `upm/resolver`, shows the lockfile upm would write, and fetches,
verifies and lists the package's tarball — all from the browser, against the registry's CORS.

```sh
node ./upm install         # from the repo root
npm run web                # or: cd web && npx vite
```

Once the resolve is in, upm's own `install` runs in the tab: `src/lib/node.ts` puts a
`process` in place whose `getBuiltinModule` hands out an in-memory `fs`, a posix `path` and
`os`, and nothing else — hashing and gunzip stay WebCrypto and `DecompressionStream`, and with no
`worker_threads` every pool runs on the one thread. The Explorer then shows the project
(`node_modules/.upm`, the links, `upm.lock`) and the content store. The platform is Linux x64
with glibc, so the optional native builds are the ones such a machine would get.

The `fs` lives in memory, since upm's sync calls cannot wait for OPFS, and the project is made
fresh for each run. What outlives the tab is the store's content: `src/lib/opfs.ts` keeps it on
OPFS as upm's store backend, which upm asks before a download and hands each package it
downloads. It is keyed by content, so every tab shares it. The registry documents the resolver
reads are kept there too, and answer a reload with no request while the registry's `max-age`
(5 minutes) lasts, or for a day for a version's own document, which never changes once
published. After that they are asked for again: the registry lets a page read no `etag`, so
the browser's HTTP cache does the revalidating. No lockfile is kept between loads:
each resolves against the registry, as a project with no `upm.lock` does, and hands its lockfile
to the install. A package the store already has shows its files from there, without a download.

`public/install.sh` and `public/install.ps1` are the installers behind
`curl -fsSL https://upm.sh/install.sh | sh` and `irm https://upm.sh/install.ps1 | iex`, which the
install card (`src/components/install.ts`) offers next to `npm i -g upm`.

`public/og.png`, the Open Graph image, is rendered by `scripts/og.ts` with
[takumi](https://github.com/kane50613/takumi). Run `node scripts/og.ts` after changing it.
