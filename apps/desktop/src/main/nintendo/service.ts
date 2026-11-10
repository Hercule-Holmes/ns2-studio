/**
 * S19: NintendoService — TypedEmitter facade over auth + API client +
 * multi-account store. Sync is on-demand (manual button); per-account errors
 * are isolated and surfaced via `syncProgress`.
 */
import { shell } from "electron";
import { completeLogin, createPendingLogin } from "./auth";
import { ParentalClient as MoonClient, fetchMoonAuth, mapMoonDailySummary } from "./api-client";
import {
  NintendoAccountStore,
  type NintendoCryptor,
  type NintendoStoredDaily,
} from "./account-store";
import { NintendoError } from "./errors";
import { REDIRECT_PREFIX } from "./oauth";
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
    private _getWindow: () => unknown,
  ) {
    super();
  }

  private deepLinkWaiter: ((url: string) => void) | null = null;

  listAccounts(): NintendoAccountView[] {
    return this.store.listAccounts();
  }

  /**
   * Main calls this when the OS relaunches the app with the Switch auth
   * deep link (browser login finished). Returns true when a login was
   * actually pending (i.e. the URL was consumed).
   */
  handleDeepLink(url: string): boolean {
    if (!url.startsWith(REDIRECT_PREFIX)) return false;
    const waiter = this.deepLinkWaiter;
    this.deepLinkWaiter = null;
    waiter?.(url);
    return true;
  }

  private waitForDeepLink(timeoutMs = 5 * 60_000): Promise<string> {
    return new Promise((resolve, reject) => {
      this.deepLinkWaiter = (url) => {
        clearTimeout(timer);
        resolve(url);
      };
      const timer = setTimeout(() => {
        this.deepLinkWaiter = null;
        reject(
          new NintendoError(
            "NINTENDO_LOGIN_CANCELLED",
            "等待浏览器授权超时，请重新点击添加账号",
          ),
        );
      }, timeoutMs);
    });
  }

  /**
   * Opens the system default browser for Nintendo login (saved passwords /
   * passkeys / 2FA); after login the OS relaunches the app with the auth
   * deep link, which resolves this flow and persists the account.
   */
  async addAccount(): Promise<NintendoAccountView> {
    const pending = createPendingLogin();
    console.log(`[nintendo] login url: ${pending.url}`);
    try {
      await shell.openExternal(pending.url);
    } catch (err) {
      throw new NintendoError(
        "NINTENDO_LOGIN_CANCELLED",
        `无法打开默认浏览器: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    const redirectUrl = await this.waitForDeepLink();
    const login = await completeLogin(pending, redirectUrl);
    const auth = await fetchMoonAuth(login.sessionToken);
    const addedAt = new Date().toISOString();
    this.store.putAccount({
      sub: auth.naId,
      nickname: auth.nickname,
      sessionTokenEnc: this.cryptor.encrypt(login.sessionToken),
      addedAt,
      lastSyncAt: null,
      cursor: null,
    });
    this.emit("changed");
    return { sub: auth.naId, nickname: auth.nickname, addedAt, lastSyncAt: null };
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
        console.log(`[nintendo] sync error (${target}): ${message}`);
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
    console.log(`[nintendo] sync start (${sub})`);
    const auth = await fetchMoonAuth(sessionToken);
    const client = MoonClient.create(auth.idToken, auth.naId);

    this.emit("syncProgress", { sub, phase: "fetch" });
    const collected: NintendoStoredDaily[] = [];
    let latestUpdatedAt = "";
    // ZNMA v2 API: playtime is per linked console; fetchDailySummaries
    // returns the whole available window and we upsert by date.
    for (const device of await client.getOwnedDevices()) {
      const summaries = await client.getDailySummaries(device.deviceId);
      for (const raw of summaries) {
        collected.push(
          mapMoonDailySummary(sub, device.deviceId, raw) as unknown as NintendoStoredDaily,
        );
        const updatedAt = String(raw.updatedAt ?? "");
        if (updatedAt > latestUpdatedAt) latestUpdatedAt = updatedAt;
      }
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
