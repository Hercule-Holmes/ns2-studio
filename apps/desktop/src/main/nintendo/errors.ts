/**
 * S19: stable error codes for the Nintendo playtime domain, so the renderer
 * can branch (auth expired → re-login, etc.) without parsing messages.
 */
export type NintendoErrorCode =
  | "NINTENDO_LOGIN_CANCELLED"
  | "NINTENDO_LOGIN_STATE_MISMATCH"
  | "NINTENDO_TOKEN_EXCHANGE_FAILED"
  | "NINTENDO_SESSION_EXPIRED"
  | "NINTENDO_API_ERROR"
  | "NINTENDO_UNKNOWN_ACCOUNT";

export class NintendoError extends Error {
  readonly code: NintendoErrorCode;

  constructor(code: NintendoErrorCode, message: string) {
    super(`[${code}] ${message}`);
    this.code = code;
    this.name = "NintendoError";
  }
}
