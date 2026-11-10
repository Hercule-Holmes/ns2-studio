/**
 * S19 (v3, 2026-10-21): みまもり Switch (ZNMA) **v2 actions API** client —
 * base https://app.lp1.znma.srv.nintendo.net, Bearer **id_token** auth,
 * endpoints /v2/actions/… (per pynintendoparental / pynintendoauth, the
 * working Home Assistant integration library). The nxapi "moon" API
 * (api-lp1.pctl.srv.nintendo.net/moon) is the DISCONTINUED old app backend —
 * it rejects every request with update_required. All read-only.
 */
import { ZNMA_CLIENT_ID } from "./oauth";
import { NintendoError } from "./errors";
import type { NintendoDailySummary } from "./types";

const NA_TOKEN_URL = "https://accounts.nintendo.com/connect/1.0.0/api/token";
const USERS_ME_URL = "https://api.accounts.nintendo.com/2.0.0/users/me";
const ZNMA_BASE_URL = "https://app.lp1.znma.srv.nintendo.net";

// みまもり Switch app identity (App Store current: 2.6.0, build 700).
const ZNMA_VERSION = "2.6.0";
const ZNMA_BUILD = "700";
const ZNMA_OS_VERSION = "34";
const ZNMA_DEVICE_MODEL = "Pixel 4 XL";
const ZNMA_USER_AGENT = `moon_ANDROID/${ZNMA_VERSION} (com.nintendo.znma; build:${ZNMA_BUILD}; ANDROID ${ZNMA_OS_VERSION})`;

export interface MoonAuth {
  /** NA access_token (accounts.nintendo.com APIs). */
  accessToken: string;
  /** NA **id_token** — the Bearer credential for the ZNMA v2 API. */
  idToken: string;
  /** Nintendo Account id — stable account key. */
  naId: string;
  nickname: string;
}

/**
 * session_token → NA tokens (client 54789befb391a838, grant
 * jwt-bearer-session-token) → users/me profile (naId + nickname).
 */
export async function fetchMoonAuth(sessionToken: string): Promise<MoonAuth> {
  const tokenRes = await fetch(NA_TOKEN_URL, {
    method: "POST",
    signal: AbortSignal.timeout(20_000),
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      "User-Agent": DALVIK_USER_AGENT,
    },
    body: JSON.stringify({
      client_id: ZNMA_CLIENT_ID,
      session_token: sessionToken,
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer-session-token",
    }),
  });
  if (tokenRes.status === 401 || tokenRes.status === 403) {
    throw new NintendoError("NINTENDO_SESSION_EXPIRED", `api/token ${tokenRes.status}`);
  }
  if (!tokenRes.ok) {
    throw new NintendoError("NINTENDO_TOKEN_EXCHANGE_FAILED", `api/token ${tokenRes.status}`);
  }
  const tokenJson = (await tokenRes.json()) as {
    access_token?: string;
    id_token?: string;
  };
  if (!tokenJson.access_token || !tokenJson.id_token) {
    throw new NintendoError("NINTENDO_TOKEN_EXCHANGE_FAILED", "响应缺少 token");
  }

  const meRes = await fetch(USERS_ME_URL, {
    signal: AbortSignal.timeout(20_000),
    headers: {
      Authorization: `Bearer ${tokenJson.access_token}`,
      "User-Agent": "NASDKAPI; Android",
      Accept: "application/json",
    },
  });
  if (!meRes.ok) {
    throw new NintendoError("NINTENDO_API_ERROR", `users/me ${meRes.status}`);
  }
  const me = (await meRes.json()) as { id?: string; nickname?: string };
  if (!me.id) throw new NintendoError("NINTENDO_API_ERROR", "users/me 缺少 id");
  return {
    accessToken: tokenJson.access_token,
    idToken: tokenJson.id_token,
    naId: me.id,
    nickname: me.nickname ?? "Nintendo Account",
  };
}

const DALVIK_USER_AGENT = "Dalvik/2.1.0 (Linux; U; Android 8.0.0)";

export interface MoonDevice {
  deviceId: string;
  label?: string;
}

interface MoonDailySummaryRaw {
  deviceId?: string;
  date?: string;
  playingTime?: number;
  updatedAt?: number;
  players?: Array<{
    playingTime?: number;
    playedGames?: Array<{
      applicationId?: string;
      title?: string;
      playingTime?: number;
      imageUri?: { medium?: string; large?: string } | null;
      meta?: { applicationId?: string; title?: string } | null;
    }>;
  }>;
  anonymousPlayer?: {
    playingTime?: number;
    playedGames?: Array<{ applicationId?: string; playingTime?: number }>;
  } | null;
  playedGames?: Array<{
    applicationId?: string;
    title?: string;
    playingTime?: number;
  }>;
}

/**
 * Authorized client over app.lp1.znma.srv.nintendo.net (ZNMA v2 actions
 * API): Bearer **id_token** + X-Moon-* device headers.
 */
export class ParentalClient {
  private constructor(
    private idToken: string,
    private naId: string,
  ) {}

  static create(idToken: string, naId: string): ParentalClient {
    return new ParentalClient(idToken, naId);
  }

  /** Diagnostics: probe candidate API paths with the given bearer token. */
  async probePaths(paths: string[], bearer: string): Promise<void> {
    for (const p of paths) {
      try {
        const res = await fetch(ZNMA_BASE_URL + p, {
          signal: AbortSignal.timeout(15_000),
          headers: {
            ...this.moonHeaders(),
            Authorization: `Bearer ${bearer}`,
          },
        });
        let body = "";
        try {
          body = (await res.text()).slice(0, 160);
        } catch { /* ignore */ }
        console.log(
          `[nintendo] probe ${p} bearer=${bearer === this.idToken ? "id_token" : "access_token"} → ${res.status} ${body}`,
        );
      } catch (err) {
        console.log(
          `[nintendo] probe ${p} → fetch failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
  }

  private moonHeaders(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.idToken}`,
      "Cache-Control": "no-store",
      "Content-Type": "application/json; charset=utf-8",
      "X-Moon-App-Id": "com.nintendo.znma",
      "X-Moon-Os": "ANDROID",
      "X-Moon-Os-Version": ZNMA_OS_VERSION,
      "X-Moon-Model": ZNMA_DEVICE_MODEL,
      "X-Moon-TimeZone": "Asia/Shanghai",
      "X-Moon-Os-Language": "zh-CN",
      "X-Moon-App-Language": "zh-CN",
      "X-Moon-App-Display-Version": ZNMA_VERSION,
      "X-Moon-App-Internal-Version": ZNMA_BUILD,
      "User-Agent": ZNMA_USER_AGENT,
    };
  }

  private async fetchJson<T>(path: string): Promise<T> {
    const res = await fetch(ZNMA_BASE_URL + path, {
      signal: AbortSignal.timeout(20_000),
      headers: this.moonHeaders(),
    });
    if (res.status === 401 || res.status === 403) {
      throw new NintendoError("NINTENDO_SESSION_EXPIRED", `${path} ${res.status}`);
    }
    if (!res.ok) {
      let detail = "";
      try {
        const body = (await res.json()) as {
          type?: string;
          errorCode?: string;
          title?: string;
          detail?: string;
        };
        detail = [body.type, body.errorCode, body.title, body.detail]
          .filter(Boolean)
          .join(" - ");
      } catch {
        /* non-json body */
      }
      throw new NintendoError(
        "NINTENDO_API_ERROR",
        `${path} ${res.status}${detail ? `: ${detail}` : ""}`,
      );
    }
    return (await res.json()) as T;
  }

  /** Switch consoles linked to this Nintendo Account (ZNMA v2). */
  async getOwnedDevices(): Promise<MoonDevice[]> {
    const json = await this.fetchJson<{ ownedDevices?: MoonDevice[] }>(
      "/v2/actions/user/fetchOwnedDevices",
    );
    return json.ownedDevices ?? [];
  }

  /** Daily summaries for one device (whole available window, no cursor). */
  async getDailySummaries(deviceId: string): Promise<MoonDailySummaryRaw[]> {
    const json = await this.fetchJson<{ dailySummaries?: MoonDailySummaryRaw[] }>(
      `/v2/actions/playSummary/fetchDailySummaries?deviceId=${encodeURIComponent(deviceId)}`,
    );
    return json.dailySummaries ?? [];
  }

  /** Cover image: imageUri values are direct CDN links (no auth). */
  async fetchCover(imageUri: string): Promise<Buffer> {
    const res = await fetch(imageUri, {
      signal: AbortSignal.timeout(30_000),
      headers: { "User-Agent": ZNMA_USER_AGENT },
    });
    if (!res.ok) {
      throw new NintendoError("NINTENDO_API_ERROR", `cover ${res.status}`);
    }
    return Buffer.from(await res.arrayBuffer());
  }
}

/** Normalize a raw ZNMA v2 daily summary into our domain shape. */
export function mapMoonDailySummary(
  sub: string,
  deviceId: string,
  raw: MoonDailySummaryRaw,
): NintendoDailySummary {
  // Per-title playtime lives under players[].playedGames[] (or anonymous
  // player); title names/images under playedGames entries.
  const perApp = new Map<string, { seconds: number; title?: string; imageUri?: string }>();
  const addGame = (g: {
    applicationId?: string;
    title?: string;
    playingTime?: number;
    imageUri?: { medium?: string; large?: string } | null;
    meta?: { applicationId?: string; title?: string } | null;
  }): void => {
    const id = g.applicationId ?? g.meta?.applicationId;
    if (!id) return;
    const cur = perApp.get(id) ?? {
      seconds: 0,
      title: g.title ?? g.meta?.title,
      imageUri: g.imageUri?.medium ?? g.imageUri?.large,
    };
    cur.seconds += g.playingTime ?? 0;
    perApp.set(id, cur);
  };
  for (const player of raw.players ?? []) {
    for (const g of player.playedGames ?? []) addGame(g);
  }
  for (const g of raw.playedGames ?? []) addGame(g);
  for (const g of raw.anonymousPlayer?.playedGames ?? []) addGame(g);

  const apps = [...perApp.entries()].map(([id, v]) => ({
    id,
    name: v.title ?? `App ${id.slice(0, 8)}`,
    imageUri: v.imageUri ?? "",
    totalSeconds: v.seconds,
    sessions: [], // ZNMA v2 has no per-session breakdown in daily summaries
  }));

  return {
    sub,
    date: raw.date ?? "",
    updatedAt: String(raw.updatedAt ?? ""),
    device: deviceId,
    apps,
    totalSeconds: raw.playingTime ?? 0,
  };
}
