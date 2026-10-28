/**
 * S19: multi-account persistence for Nintendo playtime data.
 * - `accounts[sub]` holds the safeStorage-encrypted session token + metadata.
 * - `daily[sub]` holds raw per-day summaries (never merged on disk).
 * - covers live as files keyed by sha1(application_id).
 * Cryptor is injectable so unit tests run without Electron.
 */
import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { NintendoDailySummary, NintendoAccountView } from "./types";

export interface NintendoStoredAccount {
  sub: string;
  nickname: string;
  sessionTokenEnc: string;
  addedAt: string;
  lastSyncAt: string | null;
  /** DailySummaries updatedAt cursor for incremental sync. */
  cursor: string | null;
}

export interface NintendoStoredDaily {
  sub: string;
  date: string;
  updatedAt: string;
  device: string;
  apps: Array<{
    id: string;
    name: string;
    imageUri: string;
    totalSeconds: number;
    sessions: Array<{ start: string; end: string; seconds: number }>;
  }>;
  totalSeconds: number;
}

export interface NintendoCryptor {
  encrypt(plain: string): string;
  decrypt(enc: string): string;
}

interface StoreShape {
  accounts: Record<string, NintendoStoredAccount>;
  daily: Record<string, NintendoStoredDaily[]>;
}

export function sha1Hex(input: string): string {
  return createHash("sha1").update(input).digest("hex");
}

export class NintendoAccountStore {
  private data: StoreShape = { accounts: {}, daily: {} };

  constructor(
    private file: string,
    private coversDir: string,
    private cryptor: NintendoCryptor,
  ) {
    this.load();
  }

  private load(): void {
    try {
      const parsed = JSON.parse(readFileSync(this.file, "utf8")) as Partial<StoreShape>;
      this.data = {
        accounts: parsed.accounts ?? {},
        daily: parsed.daily ?? {},
      };
    } catch {
      this.data = { accounts: {}, daily: {} };
    }
  }

  private save(): void {
    try {
      mkdirSync(dirname(this.file), { recursive: true });
      writeFileSync(this.file, JSON.stringify(this.data, null, 2), "utf8");
    } catch {
      // best-effort persistence
    }
  }

  // ---- accounts ----

  has(sub: string): boolean {
    return this.data.accounts[sub] !== undefined;
  }

  putAccount(rec: NintendoStoredAccount): void {
    this.data.accounts[rec.sub] = rec;
    this.save();
  }

  getAccount(sub: string): NintendoStoredAccount | undefined {
    return this.data.accounts[sub];
  }

  accountSessionToken(sub: string): string | null {
    const rec = this.data.accounts[sub];
    if (!rec) return null;
    try {
      return this.cryptor.decrypt(rec.sessionTokenEnc);
    } catch {
      return null;
    }
  }

  listAccounts(): NintendoAccountView[] {
    return Object.values(this.data.accounts)
      .map((a) => ({
        sub: a.sub,
        nickname: a.nickname,
        addedAt: a.addedAt,
        lastSyncAt: a.lastSyncAt ?? null,
      }))
      .sort((a, b) => a.addedAt.localeCompare(b.addedAt));
  }

  removeAccount(sub: string): void {
    delete this.data.accounts[sub];
    delete this.data.daily[sub];
    this.save();
  }

  setSyncMeta(sub: string, cursor: string | null, lastSyncAt: string): void {
    const rec = this.data.accounts[sub];
    if (!rec) return;
    rec.cursor = cursor;
    rec.lastSyncAt = lastSyncAt;
    this.save();
  }

  getCursor(sub: string): string | null {
    return this.data.accounts[sub]?.cursor ?? null;
  }

  // ---- daily summaries (per account, replace-by-date) ----

  getDaily(sub: string): NintendoStoredDaily[] {
    return this.data.daily[sub] ?? [];
  }

  allDaily(): Array<NintendoStoredDaily & { sub: string }> {
    const out: Array<NintendoStoredDaily & { sub: string }> = [];
    for (const [sub, rows] of Object.entries(this.data.daily)) {
      for (const row of rows) out.push({ ...row, sub });
    }
    return out;
  }

  /** Replace-by-date merge: incoming rows win for their (sub, date). */
  appendDaily(sub: string, rows: NintendoDailySummary[]): number {
    const bucket = this.data.daily[sub] ?? [];
    for (const row of rows) {
      const idx = bucket.findIndex((existing) => existing.date === row.date);
      const stored: NintendoStoredDaily = {
        sub,
        date: row.date,
        updatedAt: row.updatedAt,
        device: row.device,
        apps: row.apps,
        totalSeconds: row.totalSeconds,
      };
      if (idx >= 0) bucket[idx] = stored;
      else bucket.push(stored);
    }
    bucket.sort((a, b) => a.date.localeCompare(b.date));
    this.data.daily[sub] = bucket;
    this.save();
    return rows.length;
  }

  // ---- covers ----

  coverPath(appId: string): string {
    return join(this.coversDir, sha1Hex(appId) + ".img");
  }

  saveCover(appId: string, bytes: Buffer): string {
    mkdirSync(this.coversDir, { recursive: true });
    const file = this.coverPath(appId);
    writeFileSync(file, bytes);
    return file;
  }

  hasCover(appId: string): boolean {
    return existsSync(this.coverPath(appId));
  }

  readCover(appId: string): Buffer | null {
    const file = this.coverPath(appId);
    if (!existsSync(file)) return null;
    return readFileSync(file);
  }

  /** Stable per-game id for cover lookups (ids can repeat across rows). */
  newId(): string {
    return randomUUID();
  }
}
