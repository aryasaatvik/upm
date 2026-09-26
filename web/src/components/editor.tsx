// The editor pane: the selected file, or what stands in for it.
import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import type { View } from "../app.tsx";
import { Code, formatBytes, preview } from "./code.tsx";
import { LOCK } from "./files.tsx";
import type { InstalledFile } from "../lib/install.ts";
import { Markdown, MarkdownSkeleton } from "./markdown.tsx";
import { ErrorBox, IconButton, Icon, Waiting } from "./ui.tsx";

/** Where the open file's breadcrumb goes (floating over the top of the editor), and what a click
 * on one of its parts does. */
export const Breadcrumb = createContext<{
  slot: HTMLElement | null;
  reveal: (path: string) => void;
}>({ slot: null, reveal: () => {} });

export function Editor(props: {
  view: View | undefined;
  files: Map<string, InstalledFile> | undefined;
  selected: string;
  picked: number;
  /** A run is about to start, so no welcome. */
  starting?: boolean;
  examples: string[];
  onRun: (spec: string) => void;
}) {
  const { view, files, selected, picked } = props;
  if (!view && props.starting) return <MarkdownSkeleton />;
  if (!view) return <Welcome examples={props.examples} onRun={props.onRun} />;
  // The status bar shows the walk's progress; the README skeleton holds its place.
  if (!view.top) return <MarkdownSkeleton />;
  if (view.top instanceof Error) {
    return (
      <div className="mx-auto max-w-2xl p-8">
        <ErrorBox error={view.top} title={`Could not resolve ${view.spec}`} />
      </div>
    );
  }
  if (selected === LOCK) return <Lockfile resolved={view.resolved} picked={picked} />;
  const file = files?.get(selected);
  if (file) {
    // The real name and version: an alias installs under another name.
    const pkg = view.manifest && !(view.manifest instanceof Error) ? view.manifest : view.top;
    return <FileView path={selected} file={file} pkg={`${pkg.name}@${pkg.version}`} />;
  }
  if (view.tarball instanceof Error) {
    return (
      <div className="mx-auto max-w-2xl p-8">
        <ErrorBox error={view.tarball} title="Could not fetch the tarball" />
      </div>
    );
  }
  // Most packages open on their README once the tarball lands.
  if (!view.tarball) return <MarkdownSkeleton>Fetching tarball</MarkdownSkeleton>;
  return <Waiting>Select a file</Waiting>;
}

function FileView({ path, file, pkg }: { path: string; file: InstalledFile; pkg: string }) {
  const shown = useMemo(() => preview(file.path, file.data), [file]);
  const [source, setSource] = useState(false);
  const markdown = shown.lang === "md" || shown.lang === "markdown";
  // Relative links and images in a README point into the published package.
  const dir = file.path.slice(0, file.path.lastIndexOf("/") + 1);
  return (
    <Frame
      path={path}
      meta={
        file.link === undefined
          ? `${formatBytes(file.size)} · ${shown.lang || "plain"}`
          : "symlink, to the path shown"
      }
      actions={
        markdown && (
          <IconButton
            icon={source ? "eye" : "code"}
            title={source ? "Show the rendered Markdown" : "Show the Markdown source"}
            onClick={() => setSource(!source)}
          >
            {source ? "preview" : "source"}
          </IconButton>
        )
      }
    >
      {markdown && !source ? (
        <Markdown text={shown.text} base={`https://cdn.jsdelivr.net/npm/${pkg}/${dir}`} />
      ) : (
        <Code {...shown} />
      )}
    </Frame>
  );
}

function Lockfile({ resolved, picked }: { resolved: View["resolved"]; picked: number }) {
  const [copied, setCopied] = useState(false);
  if (!resolved) return <Waiting live>Resolving · {picked} picked</Waiting>;
  if (resolved instanceof Error) {
    return (
      <div className="mx-auto max-w-2xl p-8">
        <ErrorBox error={resolved} title="No lockfile: the resolve failed" />
      </div>
    );
  }
  const text = resolved.lockfile;
  return (
    <Frame
      path={LOCK}
      meta={`${formatBytes(text.length)} · json`}
      actions={
        <>
          <IconButton
            icon="copy"
            title="Copy"
            onClick={() => {
              void navigator.clipboard.writeText(text);
              setCopied(true);
              setTimeout(() => setCopied(false), 1200);
            }}
          >
            {copied ? "copied" : "copy"}
          </IconButton>
          <IconButton
            icon="download"
            title="Download"
            onClick={() => {
              const a = document.createElement("a");
              a.href = URL.createObjectURL(new Blob([text], { type: "application/json" }));
              a.download = LOCK;
              a.click();
              URL.revokeObjectURL(a.href);
            }}
          >
            download
          </IconButton>
        </>
      }
    >
      <Code text={text} lang="json" />
    </Frame>
  );
}

/** The content, with the file's path, details and actions in the breadcrumb slot. */
function Frame(props: { path: string; meta: string; actions?: ReactNode; children: ReactNode }) {
  const { slot, reveal } = useContext(Breadcrumb);
  const parts = props.path.split("/");
  const breadcrumb = (
    <div className="pr-3 sm:pr-6 lg:pr-10 xl:pr-16">
      <div className="flex h-9 items-center gap-1 overflow-hidden rounded-xl border border-zinc-200/40 bg-(--editor-bg)/50 px-3 text-xs whitespace-nowrap text-zinc-500 backdrop-blur-xl backdrop-saturate-150 dark:border-white/5">
        <Icon
          name={props.path === LOCK ? "lock" : "files"}
          className="mr-1 size-3.5 text-zinc-400"
        />
        {parts.map((part, i) => (
          <span
            key={i}
            className={`flex items-center gap-1 ${i === parts.length - 1 ? "shrink-0" : "min-w-0"}`}
          >
            {i > 0 && <Icon name="chevron" className="size-3 text-zinc-400" />}
            <button
              type="button"
              title="Show in the Explorer"
              onClick={() => reveal(parts.slice(0, i + 1).join("/"))}
              className={`rounded px-0.5 hover:bg-zinc-200/60 hover:text-zinc-900 dark:hover:bg-zinc-800 dark:hover:text-zinc-100 ${
                i === parts.length - 1
                  ? "font-medium text-zinc-800 dark:text-zinc-200"
                  : "min-w-0 truncate"
              }`}
            >
              {part}
            </button>
          </span>
        ))}
        <span className="ml-auto hidden shrink-0 pl-4 font-mono text-[11px] text-zinc-400 sm:inline">
          {props.meta}
        </span>
        <span className="ml-auto sm:hidden" />
        <span className="flex items-center gap-1">{props.actions}</span>
      </div>
    </div>
  );
  return (
    <div className="h-full">
      {props.children}
      {slot && createPortal(breadcrumb, slot)}
    </div>
  );
}

function Welcome({ examples, onRun }: { examples: string[]; onRun: (spec: string) => void }) {
  return (
    <div className="flex h-full overflow-auto p-8">
      <div className="m-auto max-w-lg text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">
        <h1 className="mb-3 font-mono text-lg font-semibold text-zinc-900 dark:text-zinc-100">
          upm <span className="text-zinc-400">playground</span>
        </h1>
        <p>
          Type a package spec above and press Enter. Everything runs in this tab, straight against
          the registry:
        </p>
        <ul className="mt-3 list-disc space-y-1 pl-5">
          <li>
            <code className="font-mono text-xs">upm/resolver</code> walks the whole dependency tree
            (Dependencies view, live as it picks).
          </li>
          <li>
            The package's tarball is downloaded, integrity-checked and unpacked into the Explorer,
            or read from upm's store once an install has put it there.
          </li>
          <li>
            The lockfile upm would write lands beside it as{" "}
            <code className="font-mono text-xs">{LOCK}</code>.
          </li>
          <li>Every registry request shows in the Requests panel.</li>
          <li>
            Then upm's own install runs here, into an in-memory filesystem, and the Explorer shows
            the project it made: the <code className="font-mono text-xs">.store</code> layout, the
            links and the content store.
          </li>
        </ul>
        <div className="mt-6 flex flex-wrap gap-2">
          {examples.map((example) => (
            <button
              key={example}
              type="button"
              onClick={() => onRun(example)}
              className="rounded border border-zinc-300 px-2.5 py-0.5 font-mono text-xs hover:border-amber-500 hover:text-amber-600 dark:border-zinc-700"
            >
              {example}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
