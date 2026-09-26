// The Package view: what the registry says about the package, and what its tarball holds.
import type { ReactNode } from "react";
import type { View } from "../app.tsx";
import type { FullManifest } from "../lib/client.ts";
import { formatBytes } from "./code.tsx";
import { Badge, ErrorBox, Icon, type IconName, Waiting } from "./ui.tsx";

/** The repository's web page, from the manifest's git url. */
export function repoUrl(manifest: FullManifest | undefined): string | undefined {
  const repo =
    typeof manifest?.repository === "string" ? manifest.repository : manifest?.repository?.url;
  return repo?.replace(/^git\+/, "").replace(/\.git$/, "");
}

export function Package({ view }: { view: View | undefined }) {
  if (!view) return <Waiting>Resolve a package to see its details.</Waiting>;
  const { top, tarball } = view;
  if (top instanceof Error) {
    return (
      <div className="px-3 pb-3">
        <ErrorBox error={top} title="Resolve failed" />
      </div>
    );
  }
  if (!top) return <Waiting live>resolving {view.spec}</Waiting>;
  const manifest = view.manifest instanceof Error ? undefined : view.manifest;
  const files = tarball && !(tarball instanceof Error) ? tarball : undefined;
  const repo = repoUrl(manifest);
  const count = (deps?: Record<string, string>) => Object.keys(deps ?? {}).length;

  return (
    <div className="min-h-0 flex-1 space-y-4 overflow-auto px-3 pt-1 pb-4 text-xs">
      <div className="space-y-2">
        <p className="flex flex-wrap items-baseline gap-x-2 font-mono">
          <span className="font-semibold break-all text-zinc-900 dark:text-zinc-100">
            {view.name}
          </span>
          <span className="text-amber-600 dark:text-amber-500">{top.version}</span>
        </p>
        {manifest?.description && <p className="text-zinc-500">{manifest.description}</p>}
        {(manifest?.license || manifest?.deprecated) && (
          <div className="flex flex-wrap gap-1.5">
            {manifest.license && <Badge>{manifest.license}</Badge>}
            {manifest.deprecated && <Badge tone="red">deprecated</Badge>}
          </div>
        )}
        {manifest?.deprecated && (
          <p className="text-red-700 dark:text-red-300">{String(manifest.deprecated)}</p>
        )}
      </div>

      <ul className="space-y-0.5">
        {manifest?.homepage && <Link icon="home" href={manifest.homepage} />}
        {repo && <Link icon="repo" href={repo} />}
        <Link icon="package" href={`https://www.npmjs.com/package/${top.name}/v/${top.version}`} />
      </ul>

      {!!manifest?.keywords?.length && (
        <div className="flex flex-wrap gap-1">
          {manifest.keywords.map((word) => (
            <span
              key={word}
              className="rounded bg-zinc-100 px-1.5 leading-5 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300"
            >
              {word}
            </span>
          ))}
        </div>
      )}

      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
        <Row label="Dependencies">{count(manifest?.dependencies ?? top.dependencies)}</Row>
        {!!count(manifest?.optionalDependencies) && (
          <Row label="Optional">{count(manifest?.optionalDependencies)}</Row>
        )}
        {!!count(manifest?.peerDependencies) && (
          <Row label="Peer">{count(manifest?.peerDependencies)}</Row>
        )}
        {manifest?.engines?.node && <Row label="Node">{manifest.engines.node}</Row>}
        {files && (
          <>
            <Row label="Tarball">{formatBytes(files.bytes)}</Row>
            <Row label="Files">{files.files.length}</Row>
            <Row label="Unpacked">
              {formatBytes(files.files.reduce((sum, f) => sum + f.size, 0))}
            </Row>
          </>
        )}
        {manifest?.hasInstallScript && <Row label="Scripts">install</Row>}
      </dl>

      {tarball instanceof Error && <ErrorBox error={tarball} title="Tarball failed" />}
    </div>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <dt className="text-zinc-500">{label}</dt>
      <dd className="truncate text-right font-mono tabular-nums">{children}</dd>
    </>
  );
}

function Link({ icon, href }: { icon: IconName; href: string }) {
  return (
    <li>
      <a
        href={href}
        target="_blank"
        rel="noreferrer"
        className="-mx-1.5 flex h-6 items-center gap-2 rounded px-1.5 text-zinc-600 hover:bg-zinc-200/70 hover:text-amber-600 dark:text-zinc-400 dark:hover:bg-zinc-800"
      >
        <Icon name={icon} className="size-3.5" />
        <span className="truncate">{href.replace(/^https?:\/\/(www\.)?/, "")}</span>
      </a>
    </li>
  );
}
