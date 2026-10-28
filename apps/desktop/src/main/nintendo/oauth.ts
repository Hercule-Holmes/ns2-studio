/**
 * S19: Nintendo Account OAuth helpers (pure logic, no Electron imports so the
 * unit tests can import this module directly). Flow per
 * ZekeSnider/NintendoSwitchRestAPI: browser login with PKCE →
 * session_token_code → session_token.
 */

const CLIENT_ID = "71b963c1b7b6d119"; // parental controls app
const REDIRECT_URI = "npf71b963c1b7b6d119://auth";
const AUTHORIZE_URL = "https://accounts.nintendo.com/connect/1.0.0/authorize";
const SESSION_TOKEN_URL =
  "https://accounts.nintendo.com/connect/1.0.0/api/session_token";
const API_TOKEN_URL = "https://accounts.nintendo.com/connect/1.0.0/api/token";
export const REDIRECT_PREFIX = REDIRECT_URI;
export const USER_AGENT = "ns2-studio/1.0 (Nintendo playtime integration)";

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
  const params = new URLSearchParams({
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    response_type: "session_token_code",
    scope:
      "user.user.birthday user.user.info user.link.wii user.link.nn id[all] user.mii user.support_info",
    session_token_code_challenge: pkce.challenge,
    session_token_code_challenge_method: "S256",
    state: pkce.state,
  });
  return `${AUTHORIZE_URL}?${params.toString()}`;
}

/** Parse the `npf…://auth#session_token_code=…&state=…` redirect fragment. */
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
): URLSearchParams {
  return new URLSearchParams({
    client_id: CLIENT_ID,
    session_token_code: code,
    session_token_code_verifier: verifier,
  });
}

export function apiTokenRequestBody(sessionToken: string): URLSearchParams {
  return new URLSearchParams({
    client_id: CLIENT_ID,
    grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
    session_token: sessionToken,
  });
}

export { SESSION_TOKEN_URL, API_TOKEN_URL, CLIENT_ID };
