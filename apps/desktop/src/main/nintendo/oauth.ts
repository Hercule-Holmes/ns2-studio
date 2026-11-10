/**
 * S19: Nintendo Account OAuth helpers for the Parental Controls **plus** app
 * (codename "moon", client `54789befb391a838`) — playtime data lives behind
 * THIS client; the old 71b963c1b7b6d119 client has no moon API access.
 * Params mirror nxapi src/api/na.ts generateAuthData() / src/api/moon.ts
 * (community known-good). Pure logic, no Electron imports.
 */

const CLIENT_ID = "54789befb391a838"; // みまもり plus / ZNMA
const REDIRECT_URI = "npf54789befb391a838://auth";
const AUTHORIZE_URL = "https://accounts.nintendo.com/connect/1.0.0/authorize";
const SESSION_TOKEN_URL =
  "https://accounts.nintendo.com/connect/1.0.0/api/session_token";
export const REDIRECT_PREFIX = REDIRECT_URI;
export const REDIRECT_SCHEME = "npf54789befb391a838";
export const CLIENT_ID_EXPORT = CLIENT_ID;

/** Scopes required by the moon API (nxapi src/api/moon.ts na_client_settings). */
const MOON_SCOPE = [
  "openid",
  "user",
  "user.mii",
  "moonUser:administration",
  "moonDevice:create",
  "moonOwnedDevice:administration",
  "moonParentalControlSetting",
  "moonParentalControlSetting:update",
  "moonParentalControlSettingState",
  "moonPairingState",
  "moonSmartDevice:administration",
  "moonDailySummary",
  "moonMonthlySummary",
].join(" ");

export interface PkcePair {
  verifier: string;
  challenge: string;
  state: string;
}

export function base64url(buf: Buffer): string {
  return buf.toString("base64url");
}

export function createPkce(rand: (n: number) => Buffer = random): PkcePair {
  const verifier = base64url(rand(32));
  const challenge = base64url(
    createHash("sha256")
      .update(verifier)
      .digest(),
  );
  return { verifier, challenge, state: base64url(rand(16)) };
}

import { createHash, randomBytes as nodeRandomBytes } from "node:crypto";
function random(n: number): Buffer {
  return nodeRandomBytes(n);
}

export function buildLoginUrl(pkce: PkcePair): string {
  // Params mirror nxapi generateAuthData(): theme=login_form, scope list as
  // above. Hand-built query keeps spaces %20-encoded.
  const params: Array<[string, string]> = [
    ["client_id", CLIENT_ID],
    ["redirect_uri", REDIRECT_URI],
    ["response_type", "session_token_code"],
    ["scope", MOON_SCOPE],
    ["session_token_code_challenge", pkce.challenge],
    ["session_token_code_challenge_method", "S256"],
    ["state", pkce.state],
    ["theme", "login_form"],
  ];
  const qs = params.map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join("&");
  return `${AUTHORIZE_URL}?${qs}`;
}

/** Parse the `npf54789befb391a838://auth#session_token_code=…&state=…` fragment. */
export function parseRedirect(url: string, expectedState: string): {
  code: string;
  state: string;
} {
  const hash = url.includes("#") ? url.slice(url.indexOf("#") + 1) : "";
  const params = new URLSearchParams(hash);
  const code = params.get("session_token_code") ?? "";
  const state = params.get("state") ?? "";
  if (!code) {
    const err = params.get("error");
    throw new Error(
      err ? `登录回调返回错误: ${err}` : "登录回调缺少 session_token_code",
    );
  }
  if (state !== expectedState) throw new Error("state 不匹配，拒绝回调");
  return { code, state };
}

export function sessionTokenRequestBody(
  code: string,
  verifier: string,
  clientId: string = CLIENT_ID,
): URLSearchParams {
  return new URLSearchParams({
    client_id: clientId,
    session_token_code: code,
    session_token_code_verifier: verifier,
  });
}

export { CLIENT_ID as ZNMA_CLIENT_ID, SESSION_TOKEN_URL };
