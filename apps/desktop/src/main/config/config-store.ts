import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { dirname } from "node:path";
import type { AppConfig, DeepPartialAppConfig } from "../../shared/ipc";

/** AppConfig defaults (03-DATA-MODELS.md §6). */
export const DEFAULT_APP_CONFIG: AppConfig = {
  serial: { baud: 115200, minIntervalMs: 2 },
  capture: { tickHz: 250, triggerThreshold: 128, swapABXY: false },
  timeline: { defaultHz: 250, gridMs: 10 },
  ui: { theme: "dark" },
  remote: {
    enabled: false,
    port: 8787,
    token: "",
    heartbeatMs: 250,
    watchdogMs: 1000,
    videoDeviceId: "",
    keepaliveMs: 20000,
  },
};

export function generateRemoteToken(): string {
  return randomBytes(16).toString("hex");
}

function deepMerge<T extends object>(base: T, patch: DeepPartialAppConfig): T {
  const out: Record<string, unknown> = { ...(base as Record<string, unknown>) };
  for (const [key, value] of Object.entries(patch ?? {})) {
    const cur = out[key];
    if (
      cur &&
      typeof cur === "object" &&
      !Array.isArray(cur) &&
      value &&
      typeof value === "object" &&
      !Array.isArray(value)
    ) {
      out[key] = deepMerge(cur as Record<string, unknown>, value as Record<string, unknown>);
    } else if (value !== undefined) {
      out[key] = value;
    }
  }
  return out as T;
}

/**
 * Hand-rolled JSON persistence for the full AppConfig (no electron-store
 * dep). Lives at `userData/config.json`. Partial updates deep-merge into the
 * current config so single-field saves never drop sibling values.
 */
export class ConfigStore {
  private data: AppConfig;

  constructor(private file: string) {
    this.data = this.load();
  }

  get(): AppConfig {
    return structuredClone(this.data);
  }

  update(patch: DeepPartialAppConfig): AppConfig {
    this.data = deepMerge(this.data, patch);
    this.save();
    return this.get();
  }

  private load(): AppConfig {
    try {
      const parsed = JSON.parse(readFileSync(this.file, "utf8")) as Partial<AppConfig>;
      const merged = deepMerge(DEFAULT_APP_CONFIG, parsed);
      // First-run: mint the remote access token and persist it (08-REMOTE.md §5).
      if (!merged.remote.token) {
        merged.remote.token = generateRemoteToken();
        this.data = merged;
        this.save();
      }
      return merged;
    } catch {
      return {
        ...structuredClone(DEFAULT_APP_CONFIG),
        remote: { ...DEFAULT_APP_CONFIG.remote, token: generateRemoteToken() },
      };
    }
  }

  private save(): void {
    try {
      mkdirSync(dirname(this.file), { recursive: true });
      writeFileSync(this.file, JSON.stringify(this.data, null, 2), "utf8");
    } catch {
      // non-fatal: persistence is best-effort
    }
  }
}