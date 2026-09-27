declare module "virtual:readme" {
  /** The repo's README.md as HTML, after its logo heading. */
  const html: string;
  export default html;
  /** Its h2 and h3 headings, in order, with the ids the HTML gives them. */
  export const toc: { level: number; text: string; id: string }[];
}

declare module "virtual:readme/logo" {
  /** What the README's logo heading holds, as HTML. */
  const html: string;
  export default html;
}
