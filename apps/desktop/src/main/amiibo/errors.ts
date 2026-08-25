export type AmiiboErrorKind =
  | "NOT_CONNECTED"
  | "EMPTY"
  | "CANCELLED"
  | "UNSUPPORTED"
  | "TIMEOUT"
  | "RESET_FAILED"
  | "NOT_FOUND"
  | "IO";

export class AmiiboError extends Error {
  constructor(
    readonly kind: AmiiboErrorKind,
    message: string,
  ) {
    super(message);
    this.name = "AmiiboError";
  }
}