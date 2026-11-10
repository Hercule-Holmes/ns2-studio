/**
 * S19: Nintendo Account login via the SYSTEM DEFAULT BROWSER (saved
 * passwords / passkeys / 2FA all work there). The OS relaunches this app
 * with the `npf54789befb391a838://auth` deep link (registered protocol);
 * main captures it from argv and hands it to NintendoService. Pure logic
 * lives in oauth.ts (unit-testable).
 */
import {
  buildLoginUrl,
  createPkce,
  parseRedirect,
  sessionTokenRequestBody,
  SESSION_TOKEN_URL,
} from "./oauth";
import { NintendoError } from "./errors";

export interface NintendoLogin {
  sessionToken: string;
}

export interface PendingLogin {
  /** Authorize URL to open in the default browser. */
  url: string;
  state: string;
  verifier: string;
  createdAt: number;
}

export function createPendingLogin(): PendingLogin {
  const pkce = createPkce();
  return {
    url: buildLoginUrl(pkce),
    state: pkce.state,
    verifier: pkce.verifier,
    createdAt: Date.now(),
  };
}

/** Validate the deep-link redirect against the pending PKCE and exchange. */
export async function completeLogin(
  pending: PendingLogin,
  redirectUrl: string,
): Promise<NintendoLogin> {
  const { code } = parseRedirect(redirectUrl, pending.state);
  const body = sessionTokenRequestBody(code, pending.verifier);
  const res = await fetch(SESSION_TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": "Dalvik/2.1.0 (Linux; U; Android 8.0.0)",
    },
    body,
  });
  if (!res.ok) {
    throw new NintendoError(
      "NINTENDO_TOKEN_EXCHANGE_FAILED",
      `session_token ${res.status}`,
    );
  }
  const json = (await res.json()) as { session_token?: string };
  if (!json.session_token) {
    throw new NintendoError("NINTENDO_TOKEN_EXCHANGE_FAILED", "响应缺少 session_token");
  }
  return { sessionToken: json.session_token };
}
