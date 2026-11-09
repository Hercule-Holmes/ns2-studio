/**
 * S21: best-node persistence (`userData/netaccel/nodes.json`). Loaded at
 * service start so the DNS server can answer before the first speedtest;
 * JSON file, best-effort writes like ConfigStore.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { AccelNodeRecord } from "../../shared/ipc";

export interface AccelPersistedDomain {
  best: string | null;
  results: AccelNodeRecord[];
}

export interface AccelPersisted {
  version: 1;
  lastRunAt: number | null;
  domains: Record<string, AccelPersistedDomain>;
}

export function emptyPersisted(): AccelPersisted {
  return { version: 1, lastRunAt: null, domains: {} };
}

export class AccelNodeStore {
  constructor(private file: string) {}

  load(): AccelPersisted {
    try {
      const parsed = JSON.parse(readFileSync(this.file, "utf8")) as AccelPersisted;
      if (parsed?.version !== 1 || typeof parsed.domains !== "object") {
        return emptyPersisted();
      }
      return parsed;
    } catch {
      return emptyPersisted();
    }
  }

  save(data: AccelPersisted): void {
    try {
      mkdirSync(dirname(this.file), { recursive: true });
      writeFileSync(this.file, JSON.stringify(data, null, 2), "utf8");
    } catch {
      // non-fatal: persistence is best-effort
    }
  }
}
