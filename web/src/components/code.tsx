// Highlighted text for the editor pane.
import { highlightText } from "rangi";
import { useMemo } from "react";

/** rangi escapes the text, so a tarball's own bytes are safe to put in as HTML. */
export function Code({ text, lang }: { text: string; lang: string }) {
  const html = useMemo(() => highlightText(text, { lang }), [text, lang]);
  return (
    <div
      className="code h-full overflow-auto py-2 pr-4 pl-4 font-mono has-[.shj-numbers]:pl-0 text-xs leading-5 whitespace-pre"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

const MAX_PREVIEW = 256 * 1024;

/** File names rangi does not know as a language of their own. */
const LANGS: Record<string, string> = { map: "json", license: "plain", licence: "plain" };

export function preview(path: string, data: Uint8Array): { text: string; lang: string } {
  const head = data.subarray(0, MAX_PREVIEW);
  if (head.includes(0)) return { text: `(binary, ${formatBytes(data.length)})`, lang: "plain" };
  const text = new TextDecoder().decode(head);
  // An extension, else the whole name (`Makefile`); rangi takes either and falls back to plain.
  const base = path.slice(path.lastIndexOf("/") + 1).toLowerCase();
  const ext = base.slice(base.lastIndexOf(".") + 1);
  return {
    text: data.length > MAX_PREVIEW ? `${text}\n… (${formatBytes(data.length)} in all)` : text,
    lang: LANGS[ext] ?? ext,
  };
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}
