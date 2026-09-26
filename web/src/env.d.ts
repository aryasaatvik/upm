declare module "virtual:readme" {
  /** The repo's README.md as HTML, after its logo heading. */
  const html: string;
  export default html;
}

declare module "virtual:readme/logo" {
  /** What the README's logo heading holds, as HTML. */
  const html: string;
  export default html;
}
