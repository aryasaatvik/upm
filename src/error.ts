/** Errors from the portable npm lock and placement APIs. */
export class UpmError extends Error {
  constructor(
    public code: "ELOCK" | "ELOCKSTALE" | "EPLACE" | (string & {}),
    message: string,
    public detail?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "UpmError";
  }
}
