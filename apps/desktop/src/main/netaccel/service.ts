/**
 * S21 v2: NetaccelService — LAN download proxy for the Switch
 * (replaces the v1 DNS-hijack + speedtest approach; see
 * sessions/S21-netaccel-proxy.md). The Switch does its own end-to-end TLS
 * with the real CDN — this service only routes and splices bytes.
 */
import { networkInterfaces } from "node:os";
import { LanProxy, type LanProxyStats } from "./http-proxy";
import type { AccelStatus, AccelServerState, AppConfig } from "../../shared/ipc";
import type { ConfigStore } from "../config/config-store";

type Events = {
  stateChanged: (s: AccelStatus) => void;
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

/** Nintendo-owned host suffixes the proxy is allowed to serve. */
export const ZNMA_ROOTS = [
  "nintendo.net",
  "nintendo.com",
  "nintendowifi.net",
  "nintendo.co.jp",
  "nintendo.jp",
];

export interface NetaccelDeps {
  config: ConfigStore;
  log?: (line: string) => void;
  /** Overrides the LAN-IP probe (tests). */
  listLanIps?: () => string[];
  /** Injection points for tests. */
  resolveA?: (server: string, name: string, timeoutMs?: number) => Promise<string[]>;
  probeTcp?: (host: string, port: number, timeoutMs?: number) => Promise<number | null>;
}

export class NetaccelService extends TypedEmitter<Events> {
  private serverState: AccelServerState = "stopped";
  private error?: string;
  private proxy: LanProxy | null = null;
  private lastTotalBytes = 0;
  private bytesPerSec = 0;
  private meterTimer: NodeJS.Timeout | null = null;

  constructor(private deps: NetaccelDeps) {
    super();
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

    const cfg = this.deps.config.get().netaccel;
    this.proxy = new LanProxy({
      port: cfg.proxyPort,
      resolvers: cfg.resolvers,
      roots: ZNMA_ROOTS,
      resolveA: this.deps.resolveA,
      probeTcp: this.deps.probeTcp,
      log: this.deps.log,
    });

    try {
      await this.proxy.start();
      this.serverState = "running";
      this.error = undefined;
      this.deps.log?.(`[netaccel] running (proxy port ${cfg.proxyPort})`);
    } catch (err) {
      this.serverState = "error";
      this.error =
        err instanceof Error
          ? `代理端口监听失败（${cfg.proxyPort}）：${err.message}`
          : "代理端口监听失败";
      this.deps.log?.(`[netaccel] start failed: ${this.error}`);
    }
    this.emitStatus();
    if (this.serverState === "running") this.startMeter();
    return this.getStatus();
  }

  async stop(silent = false): Promise<void> {
    this.stopMeter();
    this.proxy?.stop().catch(() => {});
    this.proxy = null;
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
  // Throughput meter
  // ------------------------------------------------------------------

  private startMeter(): void {
    this.stopMeter();
    this.lastTotalBytes = this.proxy?.getStats().totalBytes ?? 0;
    this.bytesPerSec = 0;
    this.meterTimer = setInterval(() => {
      const stats = this.proxy?.getStats();
      if (!stats) return;
      const bps = stats.totalBytes - this.lastTotalBytes;
      this.lastTotalBytes = stats.totalBytes;
      if (bps !== this.bytesPerSec) {
        this.bytesPerSec = bps;
        this.emitStatus();
      }
    }, 1000);
  }

  private stopMeter(): void {
    if (this.meterTimer !== null) {
      clearInterval(this.meterTimer);
      this.meterTimer = null;
    }
    this.bytesPerSec = 0;
  }

  // ------------------------------------------------------------------
  // Status
  // ------------------------------------------------------------------

  getStatus(): AccelStatus {
    const cfg: AppConfig["netaccel"] = this.deps.config.get().netaccel;
    const stats: LanProxyStats = this.proxy?.getStats() ?? {
      connections: 0,
      totalBytes: 0,
    };
    return {
      serverState: this.serverState,
      enabled: this.serverState === "running" || this.serverState === "starting",
      port: cfg.proxyPort,
      lanIps: this.listLanIps(),
      whitelist: ZNMA_ROOTS,
      connections: stats.connections,
      totalBytes: stats.totalBytes,
      bytesPerSec: this.bytesPerSec,
      error: this.error,
    };
  }

  /** LAN IPv4 candidates the NS2 can point its proxy server at. */
  private listLanIps(): string[] {
    if (this.deps.listLanIps) return this.deps.listLanIps();
    const out: string[] = [];
    // Object.entries key = adapter name (matches ipconfig: 以太网/mihomo/…)
    for (const [name, list] of Object.entries(networkInterfaces())) {
      for (const ni of list ?? []) {
        if (ni.internal || ni.family !== "IPv4") continue;
        if (isCgnatAddress(ni.address)) continue; // Tailscale 等
        if (isBenchmarkAddress(ni.address)) continue; // mihomo/Clash TUN
        if (VIRTUAL_ADAPTER_RE.test(name)) continue; // VMware/Hyper-V/WSL…
        out.push(ni.address);
      }
    }
    return out;
  }

  private emitStatus(): void {
    this.emit("stateChanged", this.getStatus());
  }
}

/** CGNAT range (Tailscale 100.64/10) is never a valid NS2 proxy target. */
function isCgnatAddress(ip: string): boolean {
  const o = ip.split(".").map(Number);
  return o.length === 4 && o[0] === 100 && o[1]! >= 64 && o[1]! <= 127;
}

/** RFC 2544 benchmark range — used by TUN adapters (mihomo/Clash etc.). */
function isBenchmarkAddress(ip: string): boolean {
  const o = ip.split(".").map(Number);
  return o.length === 4 && o[0] === 198 && (o[1] === 18 || o[1] === 19);
}

/** Virtual adapter names are never the LAN interface NS2 can reach. */
const VIRTUAL_ADAPTER_RE =
  /mihomo|tailscale|vmware|virtual|hyper-v|vethernet|wsl|loopback|tun|tap|bluetooth/i;
