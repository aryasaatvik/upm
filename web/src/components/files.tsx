// The Explorer view: the project in the shape upm's install leaves it, from the first moment.
// package.json, the package's files where its link shows them, the lockfile; then everything
// the install adds around them, in place, so nothing already shown moves.
import type { FileTreeSortEntry } from "@pierre/trees";
import { FileTree, useFileTree } from "@pierre/trees/react";
import { memo, useEffect, useRef, type ReactNode } from "react";
import type { View } from "../app.tsx";
import { formatBytes } from "./code.tsx";
import type { InstalledFile } from "../lib/install.ts";
import { pathOf } from "../lib/route.ts";
import { ErrorBox, Icon, IconButton, PaneTitle, Pulse, Waiting } from "./ui.tsx";

export const LOCK = "upm.lock";

/** Where a tarball's file shows in the tree: installed, as upm would lay it out. */
export function treePath(name: string, path = "") {
  return `node_modules/${name}/${path}`;
}

export function Explorer(props: {
  view: View | undefined;
  /** Tree path -> file: what has landed so far, or the installed tree. */
  files: Map<string, InstalledFile> | undefined;
  /** The installed tree's opened links: tree path -> target. */
  links: Map<string, string> | undefined;
  picked: number;
  selected: string;
  onSelect: (path: string) => void;
  /** Filesystem changes so far, while an install runs. */
  changes: number;
}) {
  const { view, files, picked, selected, onSelect } = props;
  if (!view) return <Waiting>Resolve a package to browse its files.</Waiting>;
  const { tarball, resolved, installed } = view;
  const lock = resolved && !(resolved instanceof Error) ? resolved.lockfile : undefined;
  const hasTree = files !== undefined || lock !== undefined;
  const unpacked = files ? [...files.values()].reduce((sum, f) => sum + f.size, 0) : 0;

  return (
    <>
      <PaneTitle>
        <span className="truncate">
          {files && `${files.size} files · ${formatBytes(unpacked)}`}
        </span>
        {view.dependencies && (
          <IconButton
            icon="download"
            title="Load again without the lockfile: resolve and install afresh"
            href={`${pathOf(view.spec.trim())}?fresh`}
          >
            reinstall
          </IconButton>
        )}
      </PaneTitle>
      {tarball instanceof Error && view.top && !(view.top instanceof Error) && (
        <div className="shrink-0 px-3 pb-2">
          <ErrorBox error={tarball} title="Tarball failed" />
        </div>
      )}
      {installed instanceof Error && (
        <div className="shrink-0 px-3 pb-2">
          <ErrorBox error={installed} title="Install failed" />
        </div>
      )}
      {hasTree && (
        // One model per run: what lands later is added to it.
        <Tree
          key={view.id}
          root={treePath(view.name)}
          files={files}
          links={props.links}
          lock={lock}
          selected={selected}
          onSelect={onSelect}
        />
      )}
      <div className="shrink-0 border-t border-zinc-200 empty:hidden dark:border-zinc-800">
        {!tarball && !(view.top instanceof Error) && (
          <Pending name={treePath(view.name).slice(0, -1)}>fetching tarball</Pending>
        )}
        {!resolved && <Pending name={LOCK}>resolving · {picked} picked</Pending>}
        {installed === true && (
          <Pending name="node_modules">installing · {props.changes} writes</Pending>
        )}
        {resolved instanceof Error && (
          <Pending name={LOCK} failed>
            resolve failed
          </Pending>
        )}
      </div>
      {!hasTree && <div className="flex-1" />}
    </>
  );
}

/** A row for a tree entry that has not landed yet. */
function Pending({
  name,
  failed,
  children,
}: {
  name: string;
  failed?: boolean;
  children: ReactNode;
}) {
  return (
    <div className="flex h-7 items-center gap-2 px-3 text-xs text-zinc-500">
      <Icon name={name === LOCK ? "lock" : "package"} className="size-3.5 opacity-60" />
      <span className="truncate font-mono">{name}</span>
      <span
        className={`ml-auto flex shrink-0 items-center gap-1.5 ${failed ? "text-red-600 dark:text-red-400" : ""}`}
      >
        {!failed && <Pulse />}
        {children}
      </span>
    </div>
  );
}

const Tree = memo(function Tree(props: {
  root: string;
  files: Map<string, InstalledFile> | undefined;
  links: Map<string, string> | undefined;
  lock: string | undefined;
  selected: string;
  onSelect: (path: string) => void;
}) {
  const { root, files, lock, selected } = props;
  // The model keeps the callbacks it was made with; these read the latest props.
  const latest = useRef(props);
  latest.current = props;
  const paths = [...(files?.keys() ?? [])];
  if (lock !== undefined && !files?.has(LOCK)) paths.push(LOCK);
  const known = useRef<Set<string>>(undefined);
  const opened = useRef(false);

  const { model } = useFileTree({
    paths,
    // Closed, so what lands later comes in closed too; the way down to the package is opened.
    initialExpansion: "closed",
    initialSelectedPaths: paths.includes(selected) ? [selected] : [],
    // Neither flattened nor dot names first: either would move rows the install adds beside.
    flattenEmptyDirectories: false,
    sort: installedLast,
    density: "compact",
    search: true,
    // Directories are selectable too; only a file changes the editor. A file selected from
    // outside, such as the README, is already the selection.
    onSelectionChange: (selection) => {
      const file = selection.findLast((path) => path === LOCK || latest.current.files?.has(path));
      if (file && file !== latest.current.selected) latest.current.onSelect(file);
    },
    renderRowDecoration: ({ item }) => {
      if (item.path === LOCK) {
        const text = latest.current.lock;
        return text === undefined ? null : { text: formatBytes(text.length) };
      }
      const link = latest.current.links?.get(item.path.replace(/\/$/, ""));
      if (link !== undefined) return { text: `→ ${link}` };
      const file = latest.current.files?.get(item.path);
      if (file?.link !== undefined) return { text: `→ ${file.link}` };
      return file ? { text: formatBytes(file.size) } : null;
    },
  });
  known.current ??= new Set(paths);

  // What lands later — the files, the lockfile, the install — is added in place, so expansion,
  // selection and every row already shown stay where they are.
  useEffect(() => {
    const added = paths.filter((path) => !known.current!.has(path));
    for (const path of added) known.current!.add(path);
    if (added.length > 0) model.batch(added.map((path) => ({ type: "add", path })));
    if (opened.current || !paths.some((path) => path.startsWith(root))) return;
    opened.current = true;
    // Only the way down to the package, where its README sits.
    for (const dir of ancestors(root)) expand(dir);
  });

  // A file picked outside the tree, such as the README once it lands.
  useEffect(() => {
    if (!known.current!.has(selected)) return;
    const item = model.getItem(selected);
    if (!item || item.isSelected()) return;
    for (const path of model.getSelectedPaths()) model.getItem(path)?.deselect();
    item.select();
  });

  function expand(dir: string) {
    const item = model.getItem(dir) ?? model.getItem(dir.slice(0, -1));
    if (item && "expand" in item && !item.isExpanded()) item.expand();
  }

  return <FileTree model={model} className="file-tree min-h-0 flex-1 overflow-hidden" />;
});

/**
 * The store (`~`) on top, then directories, then files, then dot names (`.store`, `.bin`, the
 * install state): within a directory, what the install adds lands below what was already shown.
 * The tree sorts whole paths, so they are compared at the first segment where they part.
 */
function installedLast(a: FileTreeSortEntry, b: FileTreeSortEntry): number {
  const [x, y] = [a.segments, b.segments];
  let i = 0;
  while (i < x.length && i < y.length && x[i] === y[i]) i++;
  if (i === x.length || i === y.length) return x.length - y.length;
  const rank = (name: string, dir: boolean) =>
    i === 0 && name === "~" ? -1 : name.startsWith(".") ? 2 : dir ? 0 : 1;
  return (
    rank(x[i]!, i < x.length - 1) - rank(y[i]!, i < y.length - 1) || x[i]!.localeCompare(y[i]!)
  );
}

function ancestors(root: string): string[] {
  const parts = root.split("/").filter(Boolean);
  return parts.map((_, i) => `${parts.slice(0, i + 1).join("/")}/`);
}
