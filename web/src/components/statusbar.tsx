// The status bar. Left: the package. Center: where the run is, what it resolved to and the
// download total. Right: the panel switches and the registry.
import { useMemo, useState, type ReactNode } from "react";
import type { Resolution } from "upm/resolver";
import type { View } from "../app.tsx";
import { DEFAULT_REGISTRY, type RequestEntry } from "../lib/client.ts";
import { formatBytes } from "./code.tsx";
import { repoUrl } from "./package.tsx";
import type { PanelTab, Problem } from "./panel.tsx";
import { Badge, Icon, Pulse, type IconName } from "./ui.tsx";

export function StatusBar(props: {
  view: View | undefined;
  picked: number;
  requests: RequestEntry[];
  problems: Problem[];
  panel: PanelTab | undefined;
  togglePanel: (tab: PanelTab) => void;
  registry: string;
  setRegistry: (url: string) => void;
}) {
  const { view, requests, problems, panel } = props;
  const errors = problems.filter((p) => p.level === "error").length;
  const loading = requests.some((r) => !r.done);
  const tarball = view?.tarball instanceof Error ? undefined : view?.tarball;
  const done = view?.resolved instanceof Error ? undefined : view?.resolved;
  const stats = useMemo(() => done && statsOf(done.resolution), [done]);
  const bytes = requests.reduce((sum, r) => sum + r.bytes, 0);

  let state: ReactNode = "Ready";
  if (view?.resolved instanceof Error || view?.top instanceof Error) {
    state = (
      <span className="flex items-center gap-1.5 text-red-600 dark:text-red-400">
        <Icon name="error" className="size-3" /> Resolve failed
      </span>
    );
  } else if (view?.resolved) {
    state = (
      <span className="flex items-center gap-1.5" title="Resolve time">
        <Icon name="check" className="size-3 text-emerald-600" />
        {Math.round(view.resolved.ms)} ms
      </span>
    );
  } else if (view) {
    state = (
      <span className="flex items-center gap-1.5">
        <Pulse /> Resolving · {props.picked} picked
      </span>
    );
  }

  return (
    // The footer places the registry form; only the row inside scrolls, so it does not clip it.
    <footer className="relative shrink-0 border-t border-zinc-200 text-[11px] whitespace-nowrap text-zinc-600 dark:border-zinc-800 dark:text-zinc-400">
      {/* The sides share the free space evenly, so the numbers stay centered. */}
      <div className="flex h-8 items-center gap-1 overflow-x-auto px-1.5 [scrollbar-width:none]">
        <div className="flex flex-1 items-center">
          <Identity view={view} />
        </div>
        <Item>{state}</Item>
        {stats && (
          <span className="hidden items-center lg:flex">
            <Item
              title={
                `${stats.packages} packages in the tree` +
                (stats.duplicated
                  ? `\n${stats.duplicated} of ${stats.names} names resolve to several versions`
                  : "")
              }
            >
              <Icon name="deps" className="size-3" />
              {stats.packages}
              {stats.duplicated > 0 && <Dim>({stats.duplicated} dup)</Dim>}
            </Item>
            {stats.optional > 0 && (
              <Item title={`${stats.optional} optional platform builds, every platform kept`}>
                <Icon name="cpu" className="size-3" />
                {stats.optional}
              </Item>
            )}
          </span>
        )}
        {tarball && (
          <Item
            title={`Tarball in ${Math.round(tarball.ms)} ms\nIntegrity ok: ${tarball.integrity}`}
            className="hidden md:flex"
          >
            <Icon name="package" className="size-3" />
            {formatBytes(tarball.bytes)}
          </Item>
        )}
        {bytes > 0 && (
          <Item title="Downloaded" className="hidden sm:flex">
            <Icon name="download" className="size-3" />
            {formatBytes(bytes)}
          </Item>
        )}
        <div className="flex flex-1 items-center justify-end">
          <Item
            title="Toggle the problems panel"
            active={panel === "problems"}
            onClick={() => props.togglePanel("problems")}
          >
            <Icon name="error" className={`size-3 ${errors ? "text-red-500" : ""}`} />
            {errors}
            <Icon
              name="warning"
              className={`ml-1 size-3 ${problems.length > errors ? "text-amber-500" : ""}`}
            />
            {problems.length - errors}
          </Item>
          <Item
            title="Toggle the requests panel"
            active={panel === "requests"}
            onClick={() => props.togglePanel("requests")}
          >
            {loading ? <Pulse /> : <Icon name="requests" className="size-3" />}
            {requests.length} <span className="hidden sm:inline">requests</span>
          </Item>
          <Registry url={props.registry} setUrl={props.setRegistry} />
        </div>
      </div>
    </footer>
  );
}

function Registry({ url, setUrl }: { url: string; setUrl: (url: string) => void }) {
  const [draft, setDraft] = useState<string>();
  const close = () => setDraft(undefined);
  return (
    <>
      <Item title="Registry" onClick={() => setDraft(draft === undefined ? url : undefined)}>
        <Icon name="server" className="size-3" />
        <span className="hidden sm:inline">{url.replace(/^https?:\/\//, "")}</span>
      </Item>
      {draft !== undefined && (
        <>
          <div className="fixed inset-0 z-20" onClick={close} />
          <form
            onSubmit={(e) => {
              e.preventDefault();
              setUrl(draft.trim() || DEFAULT_REGISTRY);
              close();
            }}
            onKeyDown={(e) => e.key === "Escape" && close()}
            className="absolute right-2 bottom-10 z-30 w-80 max-w-[calc(100vw-1rem)] rounded-xl border border-zinc-200 bg-(--editor-bg) p-3 text-xs shadow-lg dark:border-zinc-800"
          >
            <label className="mb-1.5 block font-medium text-zinc-700 dark:text-zinc-300">
              Registry
            </label>
            <input
              autoFocus
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              spellCheck={false}
              className="w-full rounded border border-zinc-300 bg-transparent px-2 py-1 font-mono outline-none focus:border-amber-500 dark:border-zinc-700"
            />
            <p className="mt-1.5 text-zinc-500">Needs CORS. Applying runs the query again.</p>
            <div className="mt-2 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setDraft(DEFAULT_REGISTRY)}
                className="rounded px-2 py-0.5 text-zinc-500 hover:bg-zinc-200/70 dark:hover:bg-zinc-800"
              >
                Reset
              </button>
              <button className="rounded bg-amber-500 px-2 py-0.5 font-medium text-zinc-950 hover:bg-amber-400">
                Apply
              </button>
            </div>
          </form>
        </>
      )}
    </>
  );
}

function Item(props: {
  title?: string;
  active?: boolean;
  className?: string;
  onClick?: () => void;
  children: ReactNode;
}) {
  const box = `flex h-6 items-center gap-1 px-2 ${props.active ? "bg-zinc-200 text-zinc-900 dark:bg-zinc-800 dark:text-zinc-100" : ""} ${props.className ?? ""}`;
  if (!props.onClick) {
    return (
      <span title={props.title} className={box}>
        {props.children}
      </span>
    );
  }
  return (
    <button
      type="button"
      title={props.title}
      onClick={props.onClick}
      className={`${box} hover:bg-zinc-200/70 dark:hover:bg-zinc-800`}
    >
      {props.children}
    </button>
  );
}

function Identity({ view }: { view: View | undefined }) {
  const top = view?.top;
  if (!top || top instanceof Error) return null;
  const manifest = view.manifest instanceof Error ? undefined : view.manifest;
  const repo = repoUrl(manifest);
  return (
    <div className="flex shrink-0 items-center gap-2 px-1.5" title={manifest?.description}>
      <span className="font-mono text-xs font-semibold text-zinc-900 dark:text-zinc-100">
        {view.name}
      </span>
      <span className="font-mono text-xs text-amber-600 dark:text-amber-500">{top.version}</span>
      {manifest?.license && <Badge>{manifest.license}</Badge>}
      {manifest?.deprecated && (
        <span title={String(manifest.deprecated)}>
          <Badge tone="red">deprecated</Badge>
        </span>
      )}
      <span className="hidden shrink-0 items-center text-zinc-500 sm:flex">
        {manifest?.homepage && <Link icon="home" title="Homepage" href={manifest.homepage} />}
        {repo && <Link icon="repo" title="Repository" href={repo} />}
        <Link
          icon="package"
          title="npm"
          href={`https://www.npmjs.com/package/${top.name}/v/${top.version}`}
        />
      </span>
    </div>
  );
}

function Dim({ children }: { children: ReactNode }) {
  return <span className="text-zinc-400 dark:text-zinc-500">{children}</span>;
}

function Link({ icon, title, href }: { icon: IconName; title: string; href: string }) {
  return (
    <a
      href={href}
      title={title}
      target="_blank"
      rel="noreferrer"
      className="rounded p-0.5 hover:bg-zinc-200/70 hover:text-amber-600 dark:hover:bg-zinc-800"
    >
      <Icon name={icon} className="size-3.5" />
    </a>
  );
}

function statsOf(resolution: Resolution) {
  const all = Object.values(resolution.packages);
  const versions = new Map<string, number>();
  for (const pkg of all) versions.set(pkg.name, (versions.get(pkg.name) ?? 0) + 1);
  return {
    packages: all.length,
    names: versions.size,
    duplicated: [...versions.values()].filter((n) => n > 1).length,
    optional: all.filter((pkg) => pkg.optional).length,
  };
}
