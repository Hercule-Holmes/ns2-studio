import { describe, expect, it } from "vitest";
import { encodeReport } from "@ns2-studio/protocol";
import { NEUTRAL_REPORT, SwitchButton } from "@ns2-studio/pad-types";
import { DeviceService } from "../src/main/device/device-service";
import {
  MockSerialLayer,
  MOCK_PORT_PATH,
} from "../src/main/device/mock-serial-layer";
import {
  createSerialLayer,
  isMockSerial,
} from "../src/main/device/serial-factory";
import type { DeviceStatus, LogLine } from "../src/shared/ipc";
import type { SerialPortLike } from "../src/main/device/types";

interface ServiceHarness {
  service: DeviceService;
  get layer(): MockSerialLayer;
}

function makeService(
  extra?: Partial<ConstructorParameters<typeof DeviceService>[0]>,
): ServiceHarness {
  const captured: { layer?: MockSerialLayer } = {};
  const service = new DeviceService({
    minIntervalMs: 0,
    layerFactory: async (path, baud) => {
      const layer = new MockSerialLayer(path, baud);
      captured.layer = layer;
      return layer;
    },
    ...extra,
  });
  return {
    service,
    get layer(): MockSerialLayer {
      return captured.layer as MockSerialLayer;
    },
  };
}

function collect(service: DeviceService): {
  states: DeviceStatus[];
  logs: LogLine[];
} {
  const states: DeviceStatus[] = [];
  const logs: LogLine[] = [];
  service.on("stateChanged", (s) => states.push(s));
  service.on("log", (l) => logs.push(l));
  return { states, logs };
}

class SilentLayer implements SerialPortLike {
  readonly path = "SILENT";
  isOpen = false;
  onData(): void {}
  onError(): void {}
  onClose(): void {}
  open(): Promise<void> {
    this.isOpen = true;
    return Promise.resolve();
  }
  close(): Promise<void> {
    this.isOpen = false;
    return Promise.resolve();
  }
  write(): Promise<void> {
    return Promise.resolve();
  }
}

class FailingLayer implements SerialPortLike {
  readonly path = "FAIL";
  isOpen = false;
  onData(): void {}
  onError(): void {}
  onClose(): void {}
  open(): Promise<void> {
    return Promise.reject(new Error("denied"));
  }
  close(): Promise<void> {
    return Promise.resolve();
  }
  write(): Promise<void> {
    return Promise.resolve();
  }
}

/** Handshakes like the mock but never answers Wake — for timeout tests. */
class NoWakeLayer implements SerialPortLike {
  readonly path: string = "NOWAKE";
  isOpen = false;
  written: Uint8Array[] = [];
  protected listeners: Array<(d: Uint8Array) => void> = [];
  onData(cb: (d: Uint8Array) => void): void {
    this.listeners.push(cb);
  }
  onError(): void {}
  onClose(): void {}
  open(): Promise<void> {
    this.isOpen = true;
    return Promise.resolve();
  }
  close(): Promise<void> {
    this.isOpen = false;
    return Promise.resolve();
  }
  write(data: Uint8Array): Promise<void> {
    this.written.push(Uint8Array.from(data));
    const bytes = Array.from(data);
    if (bytes[0] === 0xa5 && bytes[1] === 0x81) {
      this.emit([0x80]);
    } else if (bytes[0] === 0xa5 && bytes[1] === 0x85) {
      this.emit(Array.from("mock", (c) => c.charCodeAt(0)));
    }
    return Promise.resolve();
  }
  protected emit(bytes: number[]): void {
    const packet = Uint8Array.from(bytes);
    for (const cb of [...this.listeners]) cb(packet);
  }
}

/** Handshakes like the mock but answers Wake with Error (0x00). */
class ErrorWakeLayer extends NoWakeLayer {
  readonly path = "ERRWAKE";
  override write(data: Uint8Array): Promise<void> {
    const bytes = Array.from(data);
    if (bytes[0] === 0xa5 && bytes[1] === 0x92) {
      this.written.push(Uint8Array.from(data));
      this.emit([0x00]);
      return Promise.resolve();
    }
    return super.write(data);
  }
}

describe("DeviceService (mock serial layer)", () => {
  it("connects: open -> hello [A5 81] -> version -> connected", async () => {
    const svc = makeService();
    const service = svc.service;
    const { states, logs } = collect(service);

    const result = await service.connect(MOCK_PORT_PATH, 115200);

    expect(result.ok).toBe(true);
    expect(result.version).toBe("mock");

    const status = service.getStatus();
    expect(status.state).toBe("connected");
    expect(status.path).toBe(MOCK_PORT_PATH);
    expect(status.baud).toBe(115200);

    // first frame on the wire is the hello handshake
    expect(svc.layer.written[0]).toEqual(Uint8Array.from([0xa5, 0x81]));
    // second is the version command
    expect(svc.layer.written[1]).toEqual(Uint8Array.from([0xa5, 0x85]));

    expect(states.at(-1)?.state).toBe("connected");
    expect(logs.some((l) => l.text === "hello ack 0x80")).toBe(true);
  });

  it("rejects a second concurrent connect while busy", async () => {
    const svc = makeService();
    const service = svc.service;
    const first = service.connect(MOCK_PORT_PATH);
    const second = await service.connect(MOCK_PORT_PATH);
    expect(second.ok).toBe(false);
    await first;
  });

  it("disconnect sends neutral then closes", async () => {
    const svc = makeService();
    const service = svc.service;
    await service.connect(MOCK_PORT_PATH);
    expect(service.getStatus().state).toBe("connected");

    await service.disconnect();

    const last = svc.layer.written.at(-1);
    expect(last).toEqual(encodeReport(NEUTRAL_REPORT));
    expect(svc.layer.isOpen).toBe(false);
    expect(service.getStatus().state).toBe("disconnected");
  });

  it("sendReport pushes a raw report through the write queue", async () => {
    const svc = makeService();
    const service = svc.service;
    await service.connect(MOCK_PORT_PATH);

    const report = { ...NEUTRAL_REPORT, buttons: SwitchButton.A };
    await service.sendReport(report);

    expect(svc.layer.written.at(-1)).toEqual(encodeReport(report));
  });

  it("surfaces connect errors and lands in error state", async () => {
    const service = new DeviceService({
      minIntervalMs: 0,
      layerFactory: async () => new FailingLayer(),
    });
    const result = await service.connect("FAIL", 115200);

    expect(result.ok).toBe(false);
    expect(result.error).toBe("denied");
    expect(service.getStatus().state).toBe("error");
    expect(service.getStatus().error).toBe("denied");
  });

  it("reports a hello timeout as a connect failure", async () => {
    const service = new DeviceService({
      minIntervalMs: 0,
      handshakeTimeoutMs: 30,
      layerFactory: async () => new SilentLayer(),
    });
    const result = await service.connect("SILENT", 115200);

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/hello/);
    expect(service.getStatus().state).toBe("error");
  });

  it("decodes an incoming RX report frame", async () => {
    const svc = makeService();
    const service = svc.service;
    const { logs } = collect(service);
    await service.connect(MOCK_PORT_PATH);

    const incoming = { ...NEUTRAL_REPORT, buttons: SwitchButton.B };
    svc.layer.feed(encodeReport(incoming));
    await new Promise((r) => setTimeout(r, 30));

    expect(
      logs.some((l) => l.dir === "rx" && l.text.startsWith("report")),
    ).toBe(true);
  });

  it("reconnects cleanly after a disconnect", async () => {
    const svc = makeService();
    const service = svc.service;
    await service.connect(MOCK_PORT_PATH);
    await service.disconnect();

    const result = await service.connect(MOCK_PORT_PATH);

    expect(result.ok).toBe(true);
    expect(service.getStatus().state).toBe("connected");
    expect(svc.layer.isOpen).toBe(true);
  });

  it("wake resolves ok when the device acks (mock replies to A5 92)", async () => {
    const svc = makeService();
    const service = svc.service;
    await service.connect(MOCK_PORT_PATH);

    const result = await service.wake(1000, 0);

    expect(result.ok).toBe(true);
    expect(result.code).toBe("ok");
    expect(svc.layer.written.at(-1)).toEqual(Uint8Array.from([0xa5, 0x92]));
  });

  it("wake reports not-connected without a device", async () => {
    const service = makeService().service;
    const result = await service.wake();
    expect(result.ok).toBe(false);
    expect(result.code).toBe("not-connected");
  });

  it("wake times out on a silent device and retries once", async () => {
    const layer = new NoWakeLayer();
    const service = new DeviceService({
      minIntervalMs: 0,
      layerFactory: async () => layer,
    });
    const connectResult = await service.connect("NOWAKE", 115200);
    expect(connectResult.ok).toBe(true);

    const result = await service.wake(60, 1);

    expect(result.ok).toBe(false);
    expect(result.code).toBe("timeout");
    expect(result.message).toBeTruthy();
    // one initial attempt + one retry
    expect(layer.written.filter((w) => w[1] === 0x92)).toHaveLength(2);
  });

  it("wake surfaces an error reply as code=error without retry", async () => {
    const service = new DeviceService({
      minIntervalMs: 0,
      layerFactory: async () => new ErrorWakeLayer(),
    });
    const connectResult = await service.connect("ERRWAKE", 115200);
    expect(connectResult.ok).toBe(true);

    const result = await service.wake(1000, 1);

    expect(result.ok).toBe(false);
    expect(result.code).toBe("error");
  });
});

describe("serial-factory mock gating", () => {
  it("uses the mock layer when NS2_STUDIO_MOCK_SERIAL=1", async () => {
    process.env.NS2_STUDIO_MOCK_SERIAL = "1";
    try {
      expect(isMockSerial()).toBe(true);
      const layer = await createSerialLayer(MOCK_PORT_PATH, 115200);
      expect(layer).toBeInstanceOf(MockSerialLayer);
    } finally {
      delete process.env.NS2_STUDIO_MOCK_SERIAL;
    }
  });

  it("is disabled without the env var", () => {
    delete process.env.NS2_STUDIO_MOCK_SERIAL;
    expect(isMockSerial()).toBe(false);
  });
});