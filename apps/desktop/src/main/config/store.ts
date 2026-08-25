import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { AppSettings } from "../../shared/ipc";

/**
 * Hand-rolled JSON persistence (no electron-store dep): remembers the last
 * port / baud between launches.
 */
export class SettingsStore {
  private data: AppSettings;

  constructor(private file: string) {
    this.data = this.load();
  }

  get(): AppSettings {
    return { ...this.data };
  }

  update(patch: Partial<AppSettings>): AppSettings {
    this.data = { ...this.data, ...patch };
    this.save();
    return this.get();
  }

  private load(): AppSettings {
    try {
      const parsed = JSON.parse(readFileSync(this.file, "utf8")) as AppSettings;
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch {
      return {};
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