import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomInt } from "node:crypto";
import WebSocket from "ws";
import { encodeReport } from "@ns2-studio/protocol";
import { NEUTRAL_REPORT, SwitchButton } from "@ns2-studio/pad-types";
import { InputHub } from "../src/main/hub/input-hub";
import { DeviceService } from "../src/main/device/device-service";
import {
  MockSerialLayer,
  MOCK_PORT_PATH,
} from "../src/main/device/mock-serial-layer";
import { ConfigStore } from "../src/main/config/config-store";
import { RemoteGateway } from "../src/main/remote/gateway";
import type { HubState } from "../src/shared/ipc";

interface Harness {
  gateway: RemoteGateway;
  hub: InputHub;
  service: DeviceService;
  config: ConfigStore;
  port: number;
  token: string;
  get layer(): MockSerialLayer;
}

const sameBytes = (a?: Uint8Array, b?: Uint8Array): boolean =>
  !!a && !!b && a.length === b.length && a.every((byte, i) => byte === b[i]);

function countNeutralWrites(layer: MockSerialLayer): number {
  return layer.written.filter((w) => sameBytes(w, encodeReport(NEUTRAL_REPORT)))
    .length;
}

let staticDir: string;

beforeAll(() => {
  staticDir = mkdtempSync(join(tmpdir(), "ns2-remote-test-"));
  writeFileSync(join(staticDir, "index.html"), "<!doctype html><title>t</title>");
});

afterAll(() => {
  rmSync(staticDir, { recursive: true, force: true });
});

async function makeGateway(opts?: {
  watchdogMs?: number;
}): Promise<Harness> {
  const file = join(
    mkdtempSync(join(tmpdir(), "ns2-remote-cfg-")),
    "config.json",
  );
  const config = new ConfigStore(file);
  config.update({
    remote: {
      enabled: true,
      port: 0,
      watchdogMs: opts?.watchdogMs ?? 1000,
      heartbeatMs: 250,
    },
  });
  const captured: { layer?: MockSerialLayer } = {};
  const service = new DeviceService({
    minIntervalMs: 0,
    layerFactory: async (path, baud) => {
      const layer = new MockSerialLayer(path, baud);
      captured.layer = layer;
      return layer;
    },
  });
  const hub = new InputHub(service);
  const gateway = new RemoteGateway({
    hub,
    device: service,
    config,
    staticDir,
  });
  await gateway.start();
  const port = gateway.boundPort;
  if (port === null) throw new Error("gateway did not bind");
  return {
    gateway,
    hub,
    service,
    config,
    port,
    token: config.get().remote.token,
    get layer(): MockSerialLayer {
      return captured.layer as MockSerialLayer;
    },
  };
}

interface Msg {
  type: string;
  [key: string]: unknown;
}

class TestClient {
  private inbox: Msg[] = [];
  private readIndex = 0;
  private waiters = new Map<
    string,
    Array<{
      resolve: (msg: Msg) => void;
      timer: NodeJS.Timeout;
    }>
  >();
  private closeWaiters: Array<() => void> = [];
  private closeFired = false;
  readonly closed: Promise<void>;

  constructor(public ws: WebSocket) {
    this.closed = new Promise<void>((resolve) => {
      ws.on("close", () => {
        this.closeFired = true;
        for (const w of this.closeWaiters.splice(0)) w();
        resolve();
      });
    });
    ws.on("message", (data) => {
      const msg = JSON.parse(data.toString()) as Msg;
      this.inbox.push(msg);
      const list = this.waiters.get(msg.type);
      if (list?.length) {
        const w = list.shift()!;
        clearTimeout(w.timer);
        this.readIndex = this.inbox.length;
        w.resolve(msg);
      }
    });
  }

  static async connect(port: number): Promise<TestClient> {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    await new Promise<void>((resolve, reject) => {
      ws.once("open", resolve);
      ws.once("error", reject);
    });
    return new TestClient(ws);
  }

  send(msg: unknown): void {
    this.ws.send(JSON.stringify(msg));
  }

  /**
   * Resolves with the next unconsumed message of `type` (or one that arrives
   * later). Consumed messages are never returned again.
   */
  waitFor(type: string, timeoutMs = 2000): Promise<Msg> {
    for (let i = this.readIndex; i < this.inbox.length; i++) {
      if (this.inbox[i]!.type === type) {
        this.readIndex = i + 1;
        return Promise.resolve(this.inbox[i]!);
      }
    }
    return new Promise<Msg>((resolve, reject) => {
      const timer = setTimeout(() => {
        const list = this.waiters.get(type);
        const idx = list?.findIndex((w) => w.timer === timer) ?? -1;
        if (idx >= 0) list!.splice(idx, 1);
        reject(new Error(`timeout waiting for ${type}`));
      }, timeoutMs);
      const entry = {
        resolve: (msg: Msg) => {
          this.readIndex = this.inbox.indexOf(msg) + 1;
          resolve(msg);
        },
        timer,
      };
      const list = this.waiters.get(type) ?? [];
      list.push(entry);
      this.waiters.set(type, list);
    });
  }

  async waitClosed(timeoutMs = 2000): Promise<void> {
    if (this.closeFired) return;
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error("timeout waiting for close")),
        timeoutMs,
      );
      this.closeWaiters.push(() => {
        clearTimeout(timer);
        resolve();
      });
    });
  }

  close(): void {
    this.ws.close();
  }
}

describe("RemoteGateway", () => {  it("authenticates with the config token and returns initial state", async () => {
    const h = await makeGateway();
    const client = await TestClient.connect(h.port);
    client.send({ v: 1, type: "auth", token: h.token });
    const ok = await client.waitFor("authOk");
    expect((ok.hub as HubState).activeSource).toBe("idle");
    expect(ok.device).toMatchObject({ state: "disconnected" });
    client.close();
    await h.gateway.dispose();
  });

  it("sends authError on a bad token and closes after repeated failures", async () => {
    const h = await makeGateway();
    const client = await TestClient.connect(h.port);
    client.send({ type: "auth", token: "wrong" });
    await client.waitFor("authError");
    client.send({ type: "auth", token: "wrong" });
    await client.waitFor("authError");
    client.send({ type: "auth", token: "wrong" });
    await client.waitClosed();
    await h.gateway.dispose();
  });

  it("rejects a second client with busy while a session is active", async () => {
    const h = await makeGateway();
    const a = await TestClient.connect(h.port);
    a.send({ type: "auth", token: h.token });
    await a.waitFor("authOk");

    const b = await TestClient.connect(h.port);
    b.send({ type: "auth", token: h.token });
    const busy = await b.waitFor("error");
    expect(busy.code).toBe("busy");
    await b.waitClosed();

    a.close();
    await h.gateway.dispose();
  });

  it("routes authenticated pad reports through the remote hub source", async () => {
    const h = await makeGateway();
    await h.service.connect(MOCK_PORT_PATH);

    const client = await TestClient.connect(h.port);
    client.send({ type: "auth", token: h.token });
    await client.waitFor("authOk");

    // While idle, pad messages are silently gated (no writes).
    const before = h.layer.written.length;
    client.send({ type: "pad", report: { ...NEUTRAL_REPORT, buttons: SwitchButton.A } });
    await new Promise((r) => setTimeout(r, 50));
    expect(h.layer.written.length).toBe(before);

    // Take over the remote source, then reports reach the wire.
    client.send({ type: "source", source: "remote" });
    const stateMsg = await client.waitFor("state");
    expect((stateMsg.hub as HubState).activeSource).toBe("remote");
    expect(countNeutralWrites(h.layer)).toBe(1); // setSource neutral

    const report = { ...NEUTRAL_REPORT, buttons: SwitchButton.A };
    client.send({ type: "pad", report });
    await new Promise((r) => setTimeout(r, 50));
    expect(sameBytes(h.layer.written.at(-1), encodeReport(report))).toBe(true);

    client.close();
    await h.gateway.dispose();
  });

  it("rejects non-remote source requests from the phone", async () => {
    const h = await makeGateway();
    const client = await TestClient.connect(h.port);
    client.send({ type: "auth", token: h.token });
    await client.waitFor("authOk");
    client.send({ type: "source", source: "manual" });
    const err = await client.waitFor("error");
    expect(err.code).toBe("bad-source");
    expect(h.hub.getState().activeSource).toBe("idle");
    client.close();
    await h.gateway.dispose();
  });

  it("neutralizes and returns to idle when the client disconnects", async () => {
    const h = await makeGateway();
    await h.service.connect(MOCK_PORT_PATH);
    const client = await TestClient.connect(h.port);
    client.send({ type: "auth", token: h.token });
    await client.waitFor("authOk");
    client.send({ type: "source", source: "remote" });
    await client.waitFor("state");
    expect(countNeutralWrites(h.layer)).toBe(1);

    client.close();
    await new Promise((r) => setTimeout(r, 100));
    expect(h.hub.getState().activeSource).toBe("idle");
    expect(countNeutralWrites(h.layer)).toBe(2);
    await h.gateway.dispose();
  });

  it("watchdog releases a silent session", async () => {
    const h = await makeGateway({ watchdogMs: 120 });
    await h.service.connect(MOCK_PORT_PATH);
    const client = await TestClient.connect(h.port);
    client.send({ type: "auth", token: h.token });
    await client.waitFor("authOk");
    client.send({ type: "source", source: "remote" });
    await client.waitFor("state");

    const lost = await client.waitFor("sessionLost", 3000);
    expect(lost.reason).toBe("watchdog");
    await client.waitClosed();
    expect(h.hub.getState().activeSource).toBe("idle");
    expect(countNeutralWrites(h.layer)).toBe(2);
    await h.gateway.dispose();
  });

  it("keeps the session alive while pings arrive", async () => {
    const h = await makeGateway({ watchdogMs: 120 });
    const client = await TestClient.connect(h.port);
    client.send({ type: "auth", token: h.token });
    await client.waitFor("authOk");
    client.send({ type: "source", source: "remote" });
    await client.waitFor("state");

    for (let i = 0; i < 4; i++) {
      client.send({ type: "ping", t: i });
      const pong = await client.waitFor("pong");
      expect(pong.t).toBe(i);
      await new Promise((r) => setTimeout(r, 80));
    }
    expect(h.hub.getState().activeSource).toBe("remote");
    client.close();
    await h.gateway.dispose();
  });

  it("responds to wake with the firmware-unsupported placeholder (D3)", async () => {
    const h = await makeGateway();
    const client = await TestClient.connect(h.port);
    client.send({ type: "auth", token: h.token });
    await client.waitFor("authOk");
    client.send({ type: "wake" });
    const res = await client.waitFor("wakeResult");
    expect(res.ok).toBe(false);
    expect(res.code).toBe("firmware-unsupported");
    client.close();
    await h.gateway.dispose();
  });

  it("rotating the token kicks the live session", async () => {
    const h = await makeGateway();
    const client = await TestClient.connect(h.port);
    client.send({ type: "auth", token: h.token });
    await client.waitFor("authOk");
    client.send({ type: "source", source: "remote" });
    await client.waitFor("state");

    const status = await h.gateway.rotateToken();
    expect(status.token).not.toBe(h.token);
    await client.waitFor("sessionLost");
    expect(h.hub.getState().activeSource).toBe("idle");

    // Old token no longer works (authError path); new one does.
    const fresh = await TestClient.connect(h.port);
    fresh.send({ type: "auth", token: h.token });
    await fresh.waitFor("authError");
    fresh.close();

    const fresh2 = await TestClient.connect(h.port);
    fresh2.send({ type: "auth", token: (await h.gateway.getStatus()).token });
    await fresh2.waitFor("authOk");
    fresh2.close();
    await h.gateway.dispose();
  });

  it("serves /api/config without exposing the token", async () => {
    const h = await makeGateway();
    const res = await fetch(`http://127.0.0.1:${h.port}/api/config`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.heartbeatMs).toBe(250);
    expect(JSON.stringify(body)).not.toContain(h.token);
    await h.gateway.dispose();
  });

  it("serves the static phone client and rejects traversal", async () => {
    const h = await makeGateway();
    const ok = await fetch(`http://127.0.0.1:${h.port}/`);
    expect(ok.status).toBe(200);
    expect(await ok.text()).toContain("<!doctype html>");
    const bad = await fetch(`http://127.0.0.1:${h.port}/..%2f..%2fpackage.json`);
    expect([403, 404]).toContain(bad.status);
    await h.gateway.dispose();
  });
});
