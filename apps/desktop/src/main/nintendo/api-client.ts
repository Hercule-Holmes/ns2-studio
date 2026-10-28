/**
 * S19: parental controls API client + Nintendo Account API helpers
 * (all read-only, caller's own account). 非实机验证：响应字段名按
 * ZekeSnider 文档实现，可能需按真实响应微调。
 */
import { apiTokenRequestBody, CLIENT_ID, USER_AGENT } from "./oauth";
import { NintendoError } from "./errors";
import type { NintendoDailySummary } from "./types";

const API_TOKEN_URL = "https://accounts.nintendo.com/connect/1.0.0/api/token";
const NS_API_BASE = "https://api.lp1.av5ja.srv.nintendo.net";
const USERS_ME_URL = "https://api.users.nintendo.com/v2/user/me";

export interface NintendoApiTokens {
  accessToken: string;
  idToken: string;
}

/** session_token → id_token (accounts.nintendo.com). */
export async function fetchApiTokens(sessionToken: string): Promise<NintendoApiTokens> {
  const res = await fetch(API_TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": USER_AGENT,
    },
    body: apiTokenRequestBody(sessionToken),
  });
  if (!res.ok) {
    throw new NintendoError("NINTENDO_TOKEN_EXCHANGE_FAILED", `api/token ${res.status}`);
  }
  const json = (await res.json()) as {
    access_token?: string;
    id_token?: string;
  };
  if (!json.access_token || !json.id_token) {
    throw new NintendoError("NINTENDO_TOKEN_EXCHANGE_FAILED", "响应缺少 token");
  }
  return { accessToken: json.access_token, idToken: json.id_token };
}

/** id_token → account profile (nickname + stable `sub`). */
export async function fetchUserInfo(
  idToken: string,
): Promise<{ sub: string; nickname: string }> {
  const res = await fetch(USERS_ME_URL, {
    headers: { Authorization: `Bearer ${idToken}`, "User-Agent": USER_AGENT },
  });
  if (!res.ok) {
    throw new NintendoError("NINTENDO_API_ERROR", `user/me ${res.status}`);
  }
  const json = (await res.json()) as { sub?: string; nickname?: string };
  if (!json.sub) throw new NintendoError("NINTENDO_API_ERROR", "user/me 缺少 sub");
  return { sub: json.sub, nickname: json.nickname ?? "Nintendo Account" };
}

interface RawDailySummary {
  device?: { name?: string } | null;
  updatedAt?: string;
  date?: string;
  playedApps?: Array<{
    application_id?: string;
    name?: string;
    image_uri?: string;
    total_played_seconds?: number;
    play_sessions?: Array<{
      created_at?: string;
      updated_at?: string;
      playtime?: number;
    }>;
  }>;
}

interface RawDailySummariesResponse {
  dailySummaries?: RawDailySummary[];
  updatedAt?: string;
}

/** Thin authorized client over api.lp1.av5ja.srv.nintendo.net. */
export class ParentalClient {
  private constructor(private accessToken: string) {}

  static async login(idToken: string): Promise<ParentalClient> {
    const res = await fetch(`${NS_API_BASE}/v1/Account/Login`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${idToken}`,
        "User-Agent": USER_AGENT,
      },
      body: JSON.stringify({ parameter: { idToken } }),
    });
    if (res.status === 401 || res.status === 403) {
      throw new NintendoError("NINTENDO_SESSION_EXPIRED", `Account/Login ${res.status}`);
    }
    if (!res.ok) {
      throw new NintendoError("NINTENDO_API_ERROR", `Account/Login ${res.status}`);
    }
    const json = (await res.json()) as {
      result?: { accessToken?: string; webApiServerCredential?: { accessToken?: string } };
    };
    const token = json.result?.accessToken ?? json.result?.webApiServerCredential?.accessToken;
    if (!token) throw new NintendoError("NINTENDO_API_ERROR", "Account/Login 缺少 accessToken");
    return new ParentalClient(token);
  }

  async fetchJson(path: string): Promise<unknown> {
    const res = await fetch(NS_API_BASE + path, {
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
        "User-Agent": USER_AGENT,
      },
    });
    if (res.status === 401 || res.status === 403) {
      throw new NintendoError("NINTENDO_SESSION_EXPIRED", `${path} ${res.status}`);
    }
    if (!res.ok) {
      throw new NintendoError("NINTENDO_API_ERROR", `${path} ${res.status}`);
    }
    return (await res.json()) as unknown;
  }

  /** One page of daily summaries; `cursor` = previous response.updatedAt. */
  async dailySummaries(cursor?: string): Promise<RawDailySummariesResponse> {
    const path = cursor
      ? `/v1/DailySummaries?updatedAt=${encodeURIComponent(cursor)}`
      : "/v1/DailySummaries";
    return (await this.fetchJson(path)) as RawDailySummariesResponse;
  }

  /** Authorized fetch of a title cover image; returns raw bytes. */
  async fetchCover(imageUri: string): Promise<Buffer> {
    const sep = imageUri.includes("?") ? "&" : "?";
    const res = await fetch(`${imageUri}${sep}h=${this.accessToken}`, {
      headers: { "User-Agent": USER_AGENT },
    });
    if (!res.ok) {
      throw new NintendoError("NINTENDO_API_ERROR", `cover ${res.status}`);
    }
    return Buffer.from(await res.arrayBuffer());
  }
}

/** Normalize a raw API daily summary into our domain shape. */
export function mapDailySummary(
  sub: string,
  raw: RawDailySummary,
): NintendoDailySummary {
  const apps = (raw.playedApps ?? []).map((app) => ({
    id: app.application_id ?? "",
    name: app.name ?? "",
    imageUri: app.image_uri ?? "",
    totalSeconds: app.total_played_seconds ?? 0,
    sessions: (app.play_sessions ?? []).map((ps) => ({
      start: ps.created_at ?? "",
      end: ps.updated_at ?? "",
      seconds: ps.playtime ?? 0,
    })),
  }));
  return {
    sub,
    date: raw.date ?? "",
    updatedAt: raw.updatedAt ?? "",
    device: raw.device?.name ?? "",
    apps,
    totalSeconds: apps.reduce((acc, app) => acc + app.totalSeconds, 0),
  };
}
