// The playground as an IDE: top bar, sidebar views, the editor, a bottom panel and a status bar.
import { useEffect, useMemo, useRef, useState } from "react";
import type { ResolvedPackage } from "upm/resolver";
import {
  createClient,
  DEFAULT_REGISTRY,
  type Client,
  type FullManifest,
  type Resolved,
  type Tarball,
} from "./lib/client.ts";
import { Dependencies, type Picks } from "./components/deps.tsx";
import { Editor } from "./components/editor.tsx";
import { Explorer, treePath } from "./components/files.tsx";
import { loadMarkdown } from "./components/markdown.tsx";
import {
  changes,
  installInTab,
  manifestOf,
  type Installed,
  type InstalledFile,
} from "./lib/install.ts";
import { Package } from "./components/package.tsx";
import { Panel, type PanelTab, type Problem } from "./components/panel.tsx";
import { EXAMPLES, pathOf, specOf } from "./lib/route.ts";
import { StatusBar } from "./components/statusbar.tsx";
import { Sidebar } from "./components/sidebar.tsx";
import { TopBar } from "./components/topbar.tsx";

/** One query as it lands: each part is undefined while pending, an Error when it failed. */
export interface View {
  /** The run it belongs to; a new run remounts what was made for the last one. */
  id: number;
  spec: string;
  name: string;
  started: number;
  top?: ResolvedPackage | Error;
  manifest?: FullManifest | Error;
  tarball?: Tarball | Error;
  resolved?: Resolved | Error;
  /** What the resolve installs: set once the run starts. */
  dependencies?: Record<string, string>;
  /** upm's install of it in this tab: true while it runs. */
  installed?: Installed | Error | true;
  /** Its warnings, as upm logs them. */
  installWarnings?: string[];
}

export function App({ ready }: { ready?: Promise<unknown> }) {
  const [registryUrl, setRegistryUrl] = useState(DEFAULT_REGISTRY);
  const [spec, setSpec] = useState(() => specOf(location.pathname));
  // `?fresh` resolves this load without the last lockfile. Read before the first run rewrites
  // the path, as StrictMode runs the effect below twice.
  const [fresh] = useState(() => new URLSearchParams(location.search).has("fresh"));
  const [view, setView] = useState<View>();
  const [client, setClient] = useState<Client>();
  const [selected, setSelected] = useState("");
  // Open on the requests, unless the screen is too small to spare the room.
  const [panel, setPanel] = useState<PanelTab | undefined>(() =>
    narrow() ? undefined : "requests",
  );
  const [sidebar, setSidebar] = useState(() => !narrow());
  const [, setTick] = useState(0);
  const picks = useRef<Picks>(new Map());
  /** The last install that finished, shown while a reinstall of the same run is under way. */
  const last = useRef<{ id: number; installed: Installed }>(undefined);
  const run = useRef(0);

  // Many requests and picks move per frame; draw at most once a frame.
  const redraw = useThrottledRedraw(() => setTick((n) => n + 1));

  function submit(raw = spec, registry = registryUrl, after?: Promise<unknown>, fresh = false) {
    if (!raw.trim()) return;
    setSpec(raw);
    history.replaceState(null, "", pathOf(raw.trim()));
    // The README opens once the tarball lands: load its renderer alongside.
    void loadMarkdown().catch(() => {});
    const id = ++run.current;
    const next = createClient(registry, redraw);
    const live: Picks = new Map();
    picks.current = live;
    setClient(next);
    const update = (part: Partial<View>) =>
      run.current === id && setView((view) => view && { ...view, ...part });
    const settle = <K extends keyof View>(key: K, promise: Promise<View[K]>) =>
      promise.then(
        (value) => update({ [key]: value }),
        (error: Error) => update({ [key]: error }),
      );
    try {
      const query = next.run(
        raw,
        (pkg, from) => {
          const list = live.get(from) ?? [];
          list.push({ name: pkg.name, version: pkg.source ?? pkg.version, optional: pkg.optional });
          live.set(from, list);
          redraw();
        },
        after,
        fresh,
      );
      setView({
        id,
        spec: raw,
        name: query.name,
        started: performance.now(),
        dependencies: query.dependencies,
      });
      setSelected(treePath(query.name, "package.json"));
      settle("top", query.top);
      settle("manifest", query.manifest);
      // Open the README once the files are in, unless another file was picked meanwhile. Set in
      // the same callback as the tarball, so the tree mounts with it already selected.
      query.tarball.then(
        (tarball) => {
          if (run.current !== id) return;
          const readme = readmeOf(tarball.files.map((f) => f.path));
          if (readme) {
            const first = treePath(query.name, "package.json");
            setSelected((now) => (now === first ? treePath(query.name, readme) : now));
          }
          update({ tarball });
        },
        (error: Error) => update({ tarball: error }),
      );
      settle("resolved", query.resolved);
      // Then upm installs it, which finds the registry's answers in the HTTP cache.
      query.resolved.then(
        (resolved) => install(id, query.dependencies, registry, resolved.lockfile),
        () => {},
      );
    } catch (error) {
      setView({ id, spec: raw, name: raw, started: performance.now(), top: error as Error });
    }
  }

  /** upm's own install of a run's dependencies, in this tab. */
  function install(
    id: number,
    dependencies: Record<string, string>,
    registry: string,
    lockfile?: string,
  ) {
    const warnings: string[] = [];
    const update = (part: Partial<View>) =>
      run.current === id && setView((view) => view && { ...view, ...part });
    update({ installed: true, installWarnings: warnings });
    // Its requests are upm's own, not this client's: redraw on a clock while it runs.
    const clock = setInterval(redraw, 100);
    installInTab(
      dependencies,
      registry,
      (message, level) => {
        if (level === "warn") warnings.push(message);
      },
      lockfile,
    )
      .then(
        (installed) => {
          last.current = { id, installed };
          update({ installed });
          // The tree keeps its paths through the install, so what was open still is.
          if (run.current === id) {
            setSelected((now) => (installed.files.has(now) ? now : "package.json"));
          }
        },
        (error: Error) => update({ installed: error }),
      )
      .finally(() => clearInterval(clock));
  }

  // A shared link runs its query, once the landing's view transition allows.
  useEffect(() => {
    if (spec) submit(spec, registryUrl, ready, fresh);
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const requests = client?.requests ?? [];
  const picked = [...picks.current.values()].reduce((sum, list) => sum + list.length, 0);
  const tarball = view?.tarball instanceof Error ? undefined : view?.tarball;
  const name = view?.name ?? "";
  const installed =
    view?.installed === true && last.current?.id === view.id
      ? last.current.installed
      : view?.installed === true || view?.installed instanceof Error
        ? undefined
        : view?.installed;
  const dependencies = view?.dependencies;
  // In the shape the install leaves, from the start: package.json, then the package's files
  // where its link shows them, then everything else the install adds around them.
  const files = useMemo(() => {
    if (installed) return installed.files;
    if (!dependencies) return undefined;
    const early = new Map<string, InstalledFile>([["package.json", manifestOf(dependencies)]]);
    for (const file of tarball?.files ?? []) early.set(treePath(name, file.path), file);
    return early;
  }, [tarball, name, installed, dependencies]);
  const problems = useMemo(() => problemsOf(view), [view]);

  const togglePanel = (tab: PanelTab) => setPanel((open) => (open === tab ? undefined : tab));

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-(--chrome-bg) text-sm text-zinc-900 dark:text-zinc-100">
      <TopBar spec={spec} setSpec={setSpec} onRun={(raw) => submit(raw)} />

      {/* Margins grow with the page; the editor runs to the left edge, the sidebar floats on the
          right. */}
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="flex min-h-0 flex-1 pb-3">
          <main className="flex min-w-0 flex-1 flex-col">
            <div className="min-h-0 flex-1">
              <Editor
                view={view}
                files={files}
                selected={selected}
                picked={picked}
                examples={EXAMPLES}
                onRun={submit}
              />
            </div>
          </main>

          <Sidebar
            open={sidebar}
            setOpen={setSidebar}
            count={view && !view.resolved ? picked : undefined}
            explorer={
              <Explorer
                view={view}
                files={files}
                links={installed?.links}
                picked={picked}
                selected={selected}
                onSelect={(path) => {
                  setSelected(path);
                  // On a small screen the sidebar covers the editor: get it out of the way.
                  if (narrow()) setSidebar(false);
                }}
                changes={changes()}
              />
            }
            package={<Package view={view} />}
            dependencies={
              <Dependencies
                started={!!view}
                picks={picks.current}
                picked={picked}
                resolved={view?.resolved}
              />
            }
          />
        </div>

        <Panel
          tab={panel}
          setTab={setPanel}
          onClose={() => setPanel(undefined)}
          requests={requests}
          problems={problems}
        />
      </div>

      <StatusBar
        view={view}
        picked={picked}
        requests={requests}
        problems={problems}
        panel={panel}
        togglePanel={togglePanel}
        registry={registryUrl}
        setRegistry={(url) => {
          setRegistryUrl(url);
          submit(spec, url);
        }}
      />
    </div>
  );
}

/** Too small a screen to spare room for the sidebar and the panel. */
function narrow(): boolean {
  return innerWidth < 640;
}

/** Each failed part once (a failed walk fails the parts after it with the same error), then the warnings. */
function problemsOf(view: View | undefined): Problem[] {
  if (!view) return [];
  const problems: Problem[] = [];
  const seen = new Set<Error>();
  for (const [source, part] of [
    ["resolve", view.top],
    ["resolve", view.resolved],
    ["manifest", view.manifest],
    ["tarball", view.tarball],
    ["install", view.installed],
  ] as const) {
    if (!(part instanceof Error) || seen.has(part)) continue;
    seen.add(part);
    problems.push({ level: "error", source, message: part.message });
  }
  const done = view.resolved instanceof Error ? undefined : view.resolved;
  for (const message of done?.resolution.warnings ?? []) {
    problems.push({ level: "warning", source: "resolver", message });
  }
  for (const message of view.installWarnings ?? []) {
    problems.push({ level: "warning", source: "install", message });
  }
  return problems;
}

function useThrottledRedraw(redraw: () => void): () => void {
  const pending = useRef(false);
  const latest = useRef(redraw);
  latest.current = redraw;
  return useMemo(
    () => () => {
      if (pending.current) return;
      pending.current = true;
      requestAnimationFrame(() => {
        pending.current = false;
        latest.current();
      });
    },
    [],
  );
}

/** The package's README at its root, Markdown first. */
function readmeOf(paths: string[]): string | undefined {
  return (
    paths.find((path) => /^readme\.(md|markdown)$/i.test(path)) ??
    paths.find((path) => /^readme(\.|$)/i.test(path))
  );
}
