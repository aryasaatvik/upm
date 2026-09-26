// The editor pane: the selected file, or what stands in for it.
import { useMemo, useState, type ReactNode } from "react";
import type { View } from "../app.tsx";
import { Code, formatBytes, preview } from "./code.tsx";
import { LOCK } from "./files.tsx";
import type { InstalledFile } from "../lib/install.ts";
import { Markdown, MarkdownSkeleton } from "./markdown.tsx";
import { ErrorBox, IconButton, Icon, Waiting } from "./ui.tsx";

export function Editor(props: {
  view: View | undefined;
  files: Map<string, InstalledFile> | undefined;
  selected: string;
  picked: number;
  examples: string[];
  onRun: (spec: string) => void;
}) {
  const { view, files, selected, picked } = props;
  if (!view) return <Welcome examples={props.examples} onRun={props.onRun} />;
  if (!view.top)
    return (
      <Waiting live>
        Resolving {view.spec} · {picked} picked
      </Waiting>
    );
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

/** The content, with the file's path, details and actions under it. */
function Frame(props: { path: string; meta: string; actions?: ReactNode; children: ReactNode }) {
  const parts = props.path.split("/");
  return (
    <div className="flex h-full flex-col">
      <div className="min-h-0 flex-1">{props.children}</div>
      <div className="flex h-9 shrink-0 items-center gap-1 overflow-hidden pr-3 pl-3 text-xs sm:pl-6 lg:pl-10 xl:pl-16 whitespace-nowrap text-zinc-500">
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
            <span
              className={
                i === parts.length - 1 ? "font-medium text-zinc-800 dark:text-zinc-200" : "truncate"
              }
            >
              {part}
            </span>
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
            The package's tarball is downloaded, integrity-checked and unpacked into the Explorer.
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
