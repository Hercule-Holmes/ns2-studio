import { describe, expect, it } from "vitest";
import { encodeReport } from "@ns2-studio/protocol";
import { NEUTRAL_REPORT, SwitchButton } from "@ns2-studio/pad-types";
import { CaptureService } from "../src/main/capture/capture-service";
import { NS2_PRO_PID, NS2_PRO_VID } from "../src/main/capture/ns2-pro-parser";
import type { HidDeviceInfo, HidDeviceLike } from "../src/main/capture/types";
import { DeviceService } from "../src/main/device/device-service";
import { InputHub } from "../src/main/hub/input-hub";
import {
  MockSerialLayer,
  MOCK_PORT_PATH,
} from "../src/main/device/mock-serial-layer";

class MockHidDevice implements HidDeviceLike {
  readonly info: HidDeviceInfo;
  isOpen = false;
  written: Uint8Array[] = [];
  queue: Uint8Array[] = [];
  failWrite = false;
  failOpen = false;

  private closeListeners: Array<() => void> = [];
  private errorListeners: Array<(err: Error) => void> = [];

  constructor(info: HidDeviceInfo) {
    this.info = info;
  }

  async open(): Promise<void> {
    if (this.failOpen) throw new Error("open denied");
    this.isOpen = true;
  }

  async close(): Promise<void> {
    this.isOpen = false;
  }

  async write(data: Uint8Array): Promise<void> {
    if (this.failWrite) throw new Error("write denied");
    this.written.push(Uint8Array.from(data));
  }

  async read(timeoutMs: number): Promise<Uint8Array | null> {
    // Yield to the event loop (real node-hid blocks ~timeoutMs), otherwise the
    // streaming loop starves timers that tests rely on (waitFor).
    await sleep(timeoutMs);
    if (!this.isOpen) throw new Error("device gone");
    if (this.queue.length > 0) return this.queue.shift() as Uint8Array;
    return null; // timeout
  }

  onClose(listener: () => void): void {
    this.closeListeners.push(listener);
  }

  onError(listener: (err: Error) => void): void {
    this.errorListeners.push(listener);
  }

  feed(frame: Uint8Array): void {
    this.queue.push(frame);
  }

  /** Simulate physical unplug: close listeners fire, reads start throwing. */
  simulateGone(): void {
    this.isOpen = false;
    for (const l of this.closeListeners) l();
  }
}

interface Harness {
  capture: CaptureService;
  hub: InputHub;
  service: DeviceService;
  device: MockHidDevice;
  get layer(): MockSerialLayer;
}

function makeNs2Info(): HidDeviceInfo {
  return {
    path: "NS2-PRO-1",
    vid: NS2_PRO_VID,
    pid: NS2_PRO_PID,
    product: "Switch 2 Pro Controller",
    manufacturer: "Nintendo",
    serialNumber: "S1",
  };
}

function makeHarness(opts: {
  devices?: HidDeviceInfo[];
  getLoadError?: () => string | undefined;
  failWrite?: boolean;
  failOpen?: boolean;
}): Harness {
  const info = makeNs2Info();
  const device = new MockHidDevice(info);
  device.failWrite = opts.failWrite ?? false;
  device.failOpen = opts.failOpen ?? false;

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
  const capture = new CaptureService(hub, {
    listDevices: async () => opts.devices ?? [info],
    openDevice: async () => device,
    getLoadError: opts.getLoadError,
    readTimeoutMs: 1,
    initIntervalMs: 0,
    initCommands: () => [
      Uint8Array.from([0x03, 0x91, 0x00, 0x0d, 0x00, 0x08, 0x00, 0x00, 0x01, 0x00, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff]),
    ],
  });
  return {
    capture,
    hub,
    service,
    device,
    get layer(): MockSerialLayer {
      return captured.layer as MockSerialLayer;
    },
  };
}

/** Build a minimal valid 64-byte USB frame with the given buttons byte 0x03. */
function usbFrame(b0: number): Uint8Array {
  const body = new Uint8Array(63);
  body[2] = b0;
  body[5] = 0x00; // left stick low
  body[6] = 0x08; // center x high + y low nibble
  body[7] = 0x80; // center y high
  body[8] = 0x00;
  body[9] = 0x08;
  body[10] = 0x80;
  const frame = new Uint8Array(64);
  frame[0] = 0x09;
  frame.set(body, 1);
  return frame;
}

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

const sameBytes = (a?: Uint8Array, b?: Uint8Array): boolean =>
  !!a &&
  !!b &&
  a.length === b.length &&
  a.every((byte, i) => byte === b[i]);

async function waitFor(cond: () => boolean, timeoutMs = 500): Promise<void> {
  const start = Date.now();
  while (!cond()) {
    if (Date.now() - start > timeoutMs) throw new Error("waitFor timeout");
    await sleep(5);
  }
}

describe("CaptureService", () => {
  it("starts, sets hub source to forward, and streams a parsed report", async () => {
    const h = makeHarness({});
    await h.service.connect(MOCK_PORT_PATH);

    const result = await h.capture.start();
    expect(result.ok).toBe(true);
    expect(h.capture.getStatus().state).toBe("streaming");
    expect(h.capture.getStatus().initMode).toBe("output-report");
    expect(h.hub.getState().activeSource).toBe("forward");

    const aReport = { ...NEUTRAL_REPORT, buttons: SwitchButton.A };
    h.device.feed(usbFrame(0x02)); // A
    await waitFor(() =>
      h.layer.written.some((w) => sameBytes(w, encodeReport(aReport))),
    );
    expect(h.layer.written.at(-1)).toEqual(encodeReport(aReport));
    await h.capture.stop();
  });

  it("reports error when no NS2 Pro device is present", async () => {
    const h = makeHarness({ devices: [] });
    const result = await h.capture.start();
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/未发现 NS2 Pro/);
    expect(h.capture.getStatus().state).toBe("error");
  });

  it("reports error and degrades gracefully when node-hid fails to load", async () => {
    const h = makeHarness({
      getLoadError: () => "node-hid 加载失败：native module missing",
    });
    const result = await h.capture.start();
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/node-hid 不可用/);
    expect(h.capture.getStatus().loadError).toMatch(/node-hid 加载失败/);
  });

  it("falls back to listen-only mode when init writes fail", async () => {
    const h = makeHarness({ failWrite: true });
    await h.service.connect(MOCK_PORT_PATH);

    const result = await h.capture.start();
    expect(result.ok).toBe(true);
    expect(h.capture.getStatus().initMode).toBe("listen-only");
    expect(h.capture.getStatus().state).toBe("streaming");
    await h.capture.stop();
  });

  it("moves to unsupported on a malformed report and stops emitting", async () => {
    const h = makeHarness({});
    await h.service.connect(MOCK_PORT_PATH);
    await h.capture.start();

    const before = h.layer.written.length;
    h.device.feed(Uint8Array.from([0x00, 0x01, 0x02])); // bad frame
    await waitFor(() => h.capture.getStatus().state === "unsupported");
    expect(h.hub.getState().activeSource).toBe("idle");
    // The only additional frame on the wire after the failure is the neutral
    // released by returning the forward source to idle — never a bogus report.
    expect(h.layer.written.length).toBe(before + 1);
    expect(h.layer.written.at(-1)).toEqual(encodeReport(NEUTRAL_REPORT));
  });

  it("stop() releases the forward source to idle", async () => {
    const h = makeHarness({});
    await h.capture.start();
    expect(h.hub.getState().activeSource).toBe("forward");

    await h.capture.stop();
    expect(h.capture.getStatus().state).toBe("idle");
    expect(h.hub.getState().activeSource).toBe("idle");
  });

  it("neutralizes and returns to idle on unplug", async () => {
    const h = makeHarness({});
    await h.service.connect(MOCK_PORT_PATH);
    await h.capture.start();
    await h.capture.stop(); // release to idle first

    const again = await h.capture.start();
    expect(again.ok).toBe(true);
    expect(h.hub.getState().activeSource).toBe("forward");

    h.device.simulateGone();
    await waitFor(() => h.capture.getStatus().state === "idle");
    expect(h.hub.getState().activeSource).toBe("idle");
  });

  it("reports a busy error when already streaming", async () => {
    const h = makeHarness({});
    await h.capture.start();
    const again = await h.capture.start();
    expect(again.ok).toBe(false);
    expect(again.error).toMatch(/busy/);
    await h.capture.stop();
  });

  it("surfaces open failures as error state", async () => {
    const h = makeHarness({ failOpen: true });
    const result = await h.capture.start();
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/open denied/);
    expect(h.capture.getStatus().state).toBe("error");
  });

  it("does not hijack another source when stopped while manual is active", async () => {
    const h = makeHarness({});
    await h.capture.start();
    await h.hub.setSource("manual");

    await h.capture.stop();
    expect(h.hub.getState().activeSource).toBe("manual");
  });
});