/**
 * S19: Nintendo playtime domain types. Shapes mirror the reverse-engineered
 * parental controls API (ZekeSnider/NintendoSwitchRestAPI docs); field names
 * marked 非实机验证 may need calibration against live responses.
 */

export interface NintendoPlaySession {
  /** ISO timestamp; 非实机验证字段名. */
  start: string;
  end: string;
  seconds: number;
}

export interface NintendoDailyApp {
  /** Application id (hex-ish string from the API `application_id`). */
  id: string;
  name: string;
  /** CDN URI; needs `?h=<accessToken>` authorization to fetch. */
  imageUri: string;
  totalSeconds: number;
  sessions: NintendoPlaySession[];
}

export interface NintendoDailySummary {
  /** Owner account sub (id_token). */
  sub: string;
  /** yyyy-MM-dd, as reported by the API. */
  date: string;
  /** API cursor value carried on the summary. */
  updatedAt: string;
  device: string;
  apps: NintendoDailyApp[];
  totalSeconds: number;
}

export interface NintendoAccountView {
  sub: string;
  nickname: string;
  addedAt: string;
  lastSyncAt: string | null;
}

export interface NintendoSyncProgress {
  sub: string;
  phase: "token" | "fetch" | "covers" | "done" | "error";
  message?: string;
}

export interface NintendoMergedApp {
  id: string;
  name: string;
  totalSeconds: number;
  perAccount: Record<string, number>;
}

export interface NintendoMergedDay {
  date: string;
  totalSeconds: number;
  perAccount: Record<string, number>;
  apps: NintendoMergedApp[];
}
