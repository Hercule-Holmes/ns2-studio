/**
 * S21: NetaccelService — TypedEmitter facade over the speedtest scheduler and
 * the DNS server (sessions/S21-netaccel-dns.md). Owns the per-domain best
 * table, persists it via AccelNodeStore and auto-backfills after start when
 * the table is empty or stale. `speedtest` sub-engines are injectable so the
 * whole lifecycle is testable offline.
 */
import { networkInterfaces } from "node:os";
import { DEFAULT_ACCEL_DOMAINS, labelForDomain } from "./accel-domains";
import { AccelDnsServer } from "./dns-server";
import { AccelNodeStore, type AccelPersisted } from "./store";
import { collectCandidates } from "./resolver";
import { pickBest, rankNodes, type RankOptions } from "./speedtest";
import type {
  AccelDomainTable,
  AccelNodeRecord,
  AccelProgress,
  AccelServerState,
  AccelStatus,
  AccelTestState,
  AppConfig,
} from "../../shared/ipc";
import type { ConfigStore } from "../config/config-store";

type Events = {
  stateChanged: (s: AccelStatus) => void;
  progress: (p: AccelProgress) => void;
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

/** Re-run the speedtest when the persisted table is older than this. */
export const STALE_TABLE_MS = 6 * 60 * 60 * 1000;

export interface DnsServerLike {
  start(port: number, host?: string): Promise<void>;
  stop(): Promise<void>;
  answered: number;
  forwarded: number;
  failed: number;
}

export interface NetaccelDeps {
  config: ConfigStore;
  /** Path of nodes.json. */
  storeFile: string;
  log?: (line: string) => void;
  /** Injectable sub-engines (defaults are the real implementations). */
  collectCandidates?: typeof collectCandidates;
  rankNodes?: (candidates: string[], domain: string, opts?: RankOptions) => Promise<AccelNodeRecord[]>;
  createServer?: (deps: ConstructorParameters<typeof AccelDnsServer>[0]) => DnsServerLike;
  /** Overrides the LAN-IP probe (tests). */
  listLanIps?: () => string[];
}

/** CGNAT range (Tailscale 100.64/10) is never a valid NS2 DNS target. */
function isCgnatAddress(ip: string): boolean {
  const o = ip.split(".").map(Number);
  return o.length === 4 && o[0] === 100 && o[1]! >= 64 && o[1]! <= 127;
}

export class NetaccelService extends TypedEmitter<Events> {
  private serverState: AccelServerState = "stopped";
  private testState: AccelTestState = "idle";
  private error?: string;
  private server?: DnsServerLike;
  private tables = new Map<string, AccelDomainTable>();
  private lastRunAt: number | null = null;
  private store: AccelNodeStore;

  constructor(private deps: NetaccelDeps) {
    super();
    this.store = new AccelNodeStore(deps.storeFile);
  }

  // ------------------------------------------------------------------
  // Lifecycle
  // ------------------------------------------------------------------

  async start(): Promise<AccelStatus> {
    if (this.serverState === "running" || this.serverState === "starting") {
      return this.getStatus();
    }
    await this.stop(true);
    this.serverState = "starting";
    this.error = undefined;
    this.emitStatus();

    // Table first: the DNS server reads it through getBestIp.
    const persisted: AccelPersisted = this.store.load();
    this.lastRunAt = persisted.lastRunAt;
    this.tables = new Map();
    for (const [domain, entry] of Object.entries(persisted.domains)) {
      this.tables.set(domain, { domain, label: labelForDomain(domain), ...entry });
    }

    this.server = (this.deps.createServer ?? ((d) => new AccelDnsServer(d)))({
      getBestIp: (domain) => this.tables.get(domain)?.best ?? null,
      isAccelerated: (name) => this.activeDomains().includes(name),
      upstream: this.deps.config.get().netaccel.upstreamDns,
      log: this.deps.log,
    });

    const { port } = this.deps.config.get().netaccel;
    try {
      await this.server.start(port);
      this.serverState = "running";
      this.error = undefined;
      this.deps.log?.(`[netaccel] running (port ${port})`);
    } catch (err) {
      this.serverState = "error";
      this.error =
        err instanceof Error
          ? `DNS 服务器启动失败（端口 ${port}）：${err.message}`
          : "DNS 服务器启动失败";
      this.deps.log?.(`[netaccel] start failed: ${this.error}`);
    }
    this.emitStatus();

    if (this.serverState === "running") {
      const stale = this.lastRunAt === null || Date.now() - this.lastRunAt > STALE_TABLE_MS;
      if (stale) void this.runSpeedtest(); // fire-and-forget backfill
    }
    return this.getStatus();
  }

  async stop(silent = false): Promise<void> {
    const server = this.server;
    this.server = undefined;
    if (server) await server.stop();
    this.serverState = "stopped";
    this.error = undefined;
    if (!silent) this.emitStatus();
  }

  async dispose(): Promise<void> {
    await this.stop(true);
  }

  async setEnabled(enabled: boolean): Promise<AccelStatus> {
    this.deps.config.update({ netaccel: { enabled: enabled === true } });
    if (enabled) await this.start();
    else await this.stop();
    return this.getStatus();
  }

  // ------------------------------------------------------------------
  // Speedtest
  // ------------------------------------------------------------------

  async runSpeedtest(): Promise<AccelStatus> {
    if (this.testState === "running") return this.getStatus();
    this.testState = "running";
    this.error = undefined;
    this.emitStatus();

    const domains = this.activeDomains();
    const servers = this.deps.config.get().netaccel.upstreamDns;
    const collect = this.deps.collectCandidates ?? collectCandidates;
    const rank = this.deps.rankNodes ?? rankNodes;

    try {
      this.emitProgress({ phase: "collect", done: 0, total: domains.length });
      const candidates = await collect(servers, domains, { timeoutMs: 3000 });
      this.emitProgress({ phase: "collect", done: domains.length, total: domains.length });

      const nextTables = new Map<string, AccelDomainTable>();
      let probeDone = 0;
      let probeTotal = 0;
      for (const ips of candidates.values()) probeTotal += ips.length;

      for (const domain of domains) {
        const ips = candidates.get(domain) ?? [];
        const results = await rank(ips, domain, {
          onProbed: (_rec, done, _total) => {
            probeDone += 1;
            this.emitProgress({ phase: "probe", done: probeDone, total: probeTotal });
          },
        });
        nextTables.set(domain, {
          domain,
          label: labelForDomain(domain),
          best: pickBest(results),
          results,
        });
      }

      this.emitProgress({ phase: "verify", done: nextTables.size, total: nextTables.size });

      this.tables = nextTables;
      this.lastRunAt = Date.now();
      this.persist();

      const empty = [...nextTables.values()].filter((t) => t.best === null).length;
      this.emitProgress({
        phase: "done",
        done: domains.length,
        total: domains.length,
        message:
          empty === 0
            ? `已更新 ${nextTables.size} 个域名的最优节点`
            : `完成，${empty} 个域名未找到可用节点`,
      });
    } catch (err) {
      this.error = err instanceof Error ? err.message : String(err);
      this.emitProgress({ phase: "error", done: 0, total: 0, message: this.error });
    } finally {
      this.testState = "idle";
      this.emitStatus();
    }
    return this.getStatus();
  }

  private persist(): void {
    const data: AccelPersisted = { version: 1, lastRunAt: this.lastRunAt, domains: {} };
    for (const [domain, t] of this.tables) {
      data.domains[domain] = { best: t.best, results: t.results };
    }
    this.store.save(data);
  }

  // ------------------------------------------------------------------
  // Status
  // ------------------------------------------------------------------

  getStatus(): AccelStatus {
    const cfg: AppConfig["netaccel"] = this.deps.config.get().netaccel;
    return {
      serverState: this.serverState,
      enabled: this.serverState === "running" || this.serverState === "starting",
      port: cfg.port,
      testState: this.testState,
      ns2DnsIps: this.listLanIps(),
      upstreamDns: cfg.upstreamDns,
      domains: this.visibleDomains().map(
        (d) =>
          this.tables.get(d) ?? {
            domain: d,
            label: labelForDomain(d),
            best: null,
            results: [],
          },
      ),
      lastRunAt: this.lastRunAt,
      queriesAnswered: this.server?.answered ?? 0,
      queriesForwarded: this.server?.forwarded ?? 0,
      error: this.error,
    };
  }

  /** LAN IPv4 candidates the NS2 can use as its primary DNS. */
  private listLanIps(): string[] {
    if (this.deps.listLanIps) return this.deps.listLanIps();
    const out: string[] = [];
    for (const list of Object.values(networkInterfaces())) {
      for (const ni of list ?? []) {
        if (ni.internal || ni.family !== "IPv4") continue;
        if (isCgnatAddress(ni.address)) continue;
        out.push(ni.address);
      }
    }
    return out;
  }

  /** Domains to test/answer: config override list, else the built-in set. */
  private activeDomains(): string[] {
    const override = this.deps.config.get().netaccel.domains;
    if (override && override.length > 0) return [...override];
    return DEFAULT_ACCEL_DOMAINS.map((d) => d.domain);
  }

  /** Rows shown in the UI: active domains plus any stale table entries. */
  private visibleDomains(): string[] {
    const seen = new Set(this.activeDomains());
    for (const domain of this.tables.keys()) seen.add(domain);
    return [...seen];
  }

  private emitStatus(): void {
    this.emit("stateChanged", this.getStatus());
  }

  private emitProgress(p: AccelProgress): void {
    this.emit("progress", p);
  }
}
