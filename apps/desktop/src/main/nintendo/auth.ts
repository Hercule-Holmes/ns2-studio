/**
 * S19: Electron-side Nintendo Account login (BrowserWindow OAuth flow) and
 * id_token helpers. Pure logic lives in oauth.ts (unit-testable).
 */
import { BrowserWindow } from "electron";
import {
  buildLoginUrl,
  createPkce,
  parseRedirect,
  sessionTokenRequestBody,
  apiTokenRequestBody,
  SESSION_TOKEN_URL,
  API_TOKEN_URL,
  USER_AGENT,
  REDIRECT_PREFIX,
} from "./oauth";
import { NintendoError } from "./errors";

export interface NintendoLogin {
  sessionToken: string;
}

/** Open the login window and resolve with a session token after the flow. */
export function openNintendoLogin(parent?: BrowserWindow | null): Promise<NintendoLogin> {
  return new Promise((resolve, reject) => {
    const pkce = createPkce();
    let settled = false;

    const win = new BrowserWindow({
      width: 480,
      height: 720,
      title: "Nintendo Account 登录",
      autoHideMenuBar: true,
      parent: parent ?? undefined,
      webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
    });

    const done = (fn: () => void): void => {
      if (settled) return;
      settled = true;
      win.close();
      fn();
    };

    const handleRedirect = (url: string): void => {
      if (!url.startsWith(REDIRECT_PREFIX)) return;
      try {
        const { code } = parseRedirect(url, pkce.state);
        void exchangeSessionToken(code, pkce.verifier).then((token) =>
          done(() => resolve({ sessionToken: token })),
        );
      } catch (err) {
        done(() =>
          reject(
            err instanceof NintendoError
              ? err
              : new NintendoError("NINTENDO_LOGIN_STATE_MISMATCH", String(err)),
          ),
        );
      }
    };

    win.webContents.on("will-navigate", (_e, url) => {
      if (url.startsWith(REDIRECT_PREFIX)) {
        // the custom protocol cannot resolve; swallow and handle.
        handleRedirect(url);
      }
    });
    win.webContents.on("will-redirect", (_e, url) => {
      if (url.startsWith(REDIRECT_PREFIX)) {
        handleRedirect(url);
      }
    });
    win.on("closed", () => {
      if (!settled) {
        settled = true;
        reject(new NintendoError("NINTENDO_LOGIN_CANCELLED", "登录窗口已关闭"));
      }
    });

    void win.loadURL(buildLoginUrl(pkce));
  });
}

/** session_token → { accessToken, idToken } (accounts.nintendo.com). */
export async function exchangeApiTokens(sessionToken: string): Promise<{
  accessToken: string;
  idToken: string;
}> {
  const res = await fetch(API_TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": USER_AGENT,
    },
    body: apiTokenRequestBody(sessionToken),
  });
  if (!res.ok) {
    throw new NintendoError(
      "NINTENDO_TOKEN_EXCHANGE_FAILED",
      `api/token ${res.status}`,
    );
  }
  const json = (await res.json()) as { access_token?: string; id_token?: string };
  if (!json.access_token || !json.id_token) {
    throw new NintendoError("NINTENDO_TOKEN_EXCHANGE_FAILED", "响应缺少 token");
  }
  return { accessToken: json.access_token, idToken: json.id_token };
}

/** session_token_code → session_token (accounts.nintendo.com). */
export async function exchangeSessionToken(
  code: string,
  verifier: string,
): Promise<string> {
  const res = await fetch(SESSION_TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": USER_AGENT,
    },
    body: sessionTokenRequestBody(code, verifier),
  });
  if (!res.ok) {
    throw new NintendoError("NINTENDO_TOKEN_EXCHANGE_FAILED", `session_token ${res.status}`);
  }
  const json = (await res.json()) as { session_token?: string };
  if (!json.session_token) {
    throw new NintendoError("NINTENDO_TOKEN_EXCHANGE_FAILED", "响应缺少 session_token");
  }
  return json.session_token;
}
