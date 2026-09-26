// The Dependencies view: the live picks while resolving, the full graph once done.
import { useState } from "react";
import type { ResolvedPackage, Resolution } from "upm/resolver";
import type { Resolved } from "../lib/client.ts";
import { Badge, ErrorBox, Icon, PaneTitle, Pulse, Waiting } from "./ui.tsx";

export interface Edge {
  name: string;
  version: string;
  optional: boolean;
  /** Its record, once the graph is done. */
  pkg?: ResolvedPackage;
}

/** Parent key -> the packages the walk reached first from it, as it picks them. */
export type Picks = Map<string, Edge[]>;

/** Edges out of a key, `""` for the root. */
type Edges = (key: string) => Edge[];

export function Dependencies(props: {
  /** Whether a query is in: before one, there is nothing to wait for. */
  started: boolean;
  picks: Picks;
  picked: number;
  resolved: Resolved | Error | undefined;
}) {
  const { picks, picked, resolved } = props;
  const done = resolved instanceof Error ? undefined : resolved;
  const edges: Edges = done
    ? (key) =>
        (key ? edgesOf(done.resolution.packages[key]) : rootEdges(done.resolution)).map((edge) => ({
          ...edge,
          pkg: done.resolution.packages[`${edge.name}@${edge.version}`],
        }))
    : (key) => picks.get(key) ?? [];
  const roots = edges("");

  return (
    <>
      <PaneTitle>
        <span className="flex items-center gap-2">
          {done ? (
            `${Object.keys(done.resolution.packages).length} packages`
          ) : resolved || !props.started ? null : (
            <>
              <Pulse /> {picked} picked
            </>
          )}
        </span>
      </PaneTitle>
      {resolved instanceof Error && (
        <div className="px-3 pb-3">
          <ErrorBox error={resolved} title="Resolve failed" />
        </div>
      )}
      {roots.length > 0 ? (
        <ul className="min-h-0 flex-1 overflow-auto pb-4 font-mono text-xs">
          {roots.map((edge) => (
            <Node key={edge.name} edges={edges} edge={edge} depth={0} path={[]} />
          ))}
        </ul>
      ) : (
        !resolved &&
        (props.started ? (
          <Waiting live>waiting for the first pick</Waiting>
        ) : (
          <Waiting>Resolve a package to see its tree.</Waiting>
        ))
      )}
    </>
  );
}

function Node(props: { edges: Edges; edge: Edge; depth: number; path: string[] }) {
  const { edges, edge, depth, path } = props;
  const { pkg } = edge;
  const key = `${edge.name}@${edge.version}`;
  const cycle = path.includes(key);
  const children = cycle ? [] : edges(key);
  const [open, setOpen] = useState(depth < 1);

  return (
    <li>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        disabled={children.length === 0}
        style={{ paddingLeft: `${depth * 12 + 8}px` }}
        className="flex h-[22px] w-full min-w-fit items-center gap-1.5 pr-3 text-left whitespace-nowrap hover:bg-zinc-200/60 disabled:cursor-default dark:hover:bg-zinc-800/60"
      >
        <span className="flex w-3 justify-center text-zinc-400">
          {children.length > 0 && (
            <Icon
              name="chevron"
              className={`size-3 transition-transform ${open ? "rotate-90" : ""}`}
            />
          )}
        </span>
        <span>{edge.name}</span>
        <span className="text-amber-600 dark:text-amber-500">{edge.version}</span>
        {edge.optional && <Badge>optional</Badge>}
        {pkg?.os && <Badge>{pkg.os.join(" ")}</Badge>}
        {pkg?.cpu && <Badge>{pkg.cpu.join(" ")}</Badge>}
        {pkg?.peers && <Badge>{Object.keys(pkg.peers).length} peers</Badge>}
        {cycle && <Badge tone="red">cycle</Badge>}
        {children.length > 0 && !open && (
          <span className="text-[10px] text-zinc-400">{children.length}</span>
        )}
      </button>
      {open && children.length > 0 && (
        <ul className="relative">
          <li
            aria-hidden
            style={{ left: `${depth * 12 + 14}px` }}
            className="absolute inset-y-0 border-l border-zinc-200 dark:border-zinc-800"
          />
          {children.map((child) => (
            <Node
              key={child.name}
              edges={edges}
              edge={child}
              depth={depth + 1}
              path={[...path, key]}
            />
          ))}
        </ul>
      )}
    </li>
  );
}

function edgesOf(pkg: ResolvedPackage | undefined): Edge[] {
  if (!pkg) return [];
  return [
    ...Object.entries(pkg.dependencies).map(([name, version]) => ({
      name,
      version,
      optional: false,
    })),
    ...Object.entries(pkg.optionalDependencies ?? {}).map(([name, version]) => ({
      name,
      version,
      optional: true,
    })),
  ];
}

function rootEdges(resolution: Resolution): Edge[] {
  return Object.entries(resolution.root.dependencies).map(([name, version]) => ({
    name,
    version,
    optional: false,
  }));
}
