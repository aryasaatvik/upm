/** Errors from the portable npm lock and placement APIs. */
export class UpmError extends Error {
  code: "ELOCK" | "ELOCKSTALE" | "EPLACE" | (string & {});
  detail?: Record<string, unknown>;

  constructor(
    code: "ELOCK" | "ELOCKSTALE" | "EPLACE" | (string & {}),
    message: string,
    detail?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "UpmError";
    this.code = code;
    this.detail = detail;
  }
}
