/**
 * S19: NintendoService — TypedEmitter facade over auth + API client +
 * multi-account store. Sync is on-demand (manual button); per-account errors
 * are isolated and surfaced via `syncProgress`.
 */
import { BrowserWindow } from "electron";
import { openNintendoLogin, exchangeApiTokens } from "./auth";
import { ParentalClient, fetchApiTokens, fetchUserInfo, mapDailySummary } from "./api-client";
import {
  NintendoAccountStore,
  type NintendoCryptor,
  type NintendoStoredDaily,
} from "./account-store";
import { NintendoError } from "./errors";
import { mergeDaily } from "./merge";
import type {
  NintendoAccountView,
  NintendoMergedDay,
  NintendoSyncProgress,
} from "./types";

type Events = {
  changed: () => void;
  syncProgress: (p: NintendoSyncProgress) => void;
};

class TypedEmitter<E extends Record<string, (...args: never[]) => void>> {
  private listeners = new Map<keyof E, Set<E[keyof E]>>();
  on<K extends keyof E>(event: K, cb: E[K]): () => void {
    const set = this.listeners.get(event) ?? new Set();
    set.add(cb);
    this.listeners.set(event, set);
    return () => set.delete(cb);
  }
  off<K extends keyof E>(event: K, cb: E[K]): void {
    this.listeners.get(event)?.delete(cb);
  }
  protected emit<K extends keyof E>(event: K, ...args: Parameters<E[K]>): void {
    for (const cb of this.listeners.get(event) ?? []) (cb as unknown as (...a: unknown[]) => void)(...args);
  }
}

export class NintendoService extends TypedEmitter<{
  changed: () => void;
  syncProgress: (p: NintendoSyncProgress) => void;
}> {
  constructor(
    private store: NintendoAccountStore,
    private cryptor: NintendoCryptor,
    private getWindow: () => BrowserWindow | null,
  ) {
    super();
  }

  listAccounts(): NintendoAccountView[] {
    return this.store.listAccounts();
  }

  /** Opens the Nintendo Account login window; persists the new account. */
  async addAccount(): Promise<NintendoAccountView> {
    const login = await openNintendoLogin(this.getWindow());
    const tokens = await exchangeApiTokens(login.sessionToken);
    const me = await fetchUserInfo(tokens.idToken);
    this.store.putAccount({
      sub: me.sub,
      nickname: me.nickname,
      sessionTokenEnc: this.cryptor.encrypt(login.sessionToken),
      addedAt: new Date().toISOString(),
      lastSyncAt: null,
      cursor: null,
    });
    this.emit("changed");
    return { sub: me.sub, nickname: me.nickname, addedAt: new Date().toISOString(), lastSyncAt: null };
  }

  removeAccount(sub: string): void {
    this.store.removeAccount(sub);
    this.emit("changed");
  }

  /** Sync one account or all stored accounts. */
  async sync(sub?: string): Promise<void> {
    const targets = sub
      ? [sub]
      : this.store.listAccounts().map((a) => a.sub);
    for (const target of targets) {
      try {
        await this.syncAccount(target);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        this.emit("syncProgress", { sub: target, phase: "error", message });
      }
    }
    this.emit("changed");
  }

  private async syncAccount(sub: string): Promise<void> {
    const sessionToken = this.store.accountSessionToken(sub);
    if (sessionToken === null) {
      this.emit("syncProgress", { sub, phase: "error", message: "账号不存在" });
      return;
    }
    this.emit("syncProgress", { sub, phase: "token" });
    const tokens = await fetchApiTokens(sessionToken);
    const client = await ParentalClient.login(tokens.idToken);

    this.emit("syncProgress", { sub, phase: "fetch" });
    let cursor = this.store.getCursor(sub);
    let guard = 0;
    const collected: NintendoStoredDaily[] = [];
    let latestUpdatedAt = this.store.getCursor(sub) ?? "";
    for (;;) {
      const page = await client.dailySummaries(cursor ?? undefined);
      for (const raw of page.dailySummaries ?? []) {
        collected.push(mapDailySummary(sub, raw) as unknown as NintendoStoredDaily);
        if ((raw.updatedAt ?? "") > latestUpdatedAt) latestUpdatedAt = raw.updatedAt ?? latestUpdatedAt;
      }
      if (!page.updatedAt || page.updatedAt === cursor) break; // exhausted
      cursor = page.updatedAt;
      if (++guard > 400) break; // safety bound
    }
    this.store.appendDaily(sub, collected);
    this.store.setSyncMeta(sub, latestUpdatedAt || null, new Date().toISOString());

    this.emit("syncProgress", { sub, phase: "covers" });
    let coverFailures = 0;
    for (const app of collected.flatMap((row) => row.apps)) {
      if (this.store.hasCover(app.id) || !app.imageUri) continue;
      try {
        this.store.saveCover(app.id, await client.fetchCover(app.imageUri));
      } catch {
        coverFailures++;
      }
    }
    if (coverFailures > 0) {
      this.emit("syncProgress", { sub, phase: "error", message: `${coverFailures} 张封面下载失败` });
    }
    this.emit("syncProgress", { sub, phase: "done" });
  }

  /** Merged (or per-account, when `sub` is given) daily view. */
  getMergedDays(sub?: string): NintendoMergedDay[] {
    const rows = sub
      ? this.store.getDaily(sub).map((row) => ({ ...row, sub }))
      : this.store.allDaily();
    return mergeDaily(rows);
  }

  getCover(appId: string): string | null {
    const bytes = this.store.readCover(appId);
    return bytes ? `data:image/png;base64,${bytes.toString("base64")}` : null;
  }
}
