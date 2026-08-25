import { describe, expect, it } from "vitest";
import { DeviceService } from "../src/main/device/device-service";
import type { SerialPortLike } from "../src/main/device/types";
import { AmiiboDeviceApi } from "../src/main/amiibo/device-api";
import { AmiiboError } from "../src/main/amiibo/errors";

const HELLO = Uint8Array.from([0xa5, 0x81]);
const VERSION = Uint8Array.from([0xa5, 0x85]);

/**
 * Scriptable serial layer that speaks the EasyCon-style reply protocol and can
 * be told to stay silent on specific SaveAmiibo body writes (to exercise the
 * Hello-reset retry path).
 */
class ScriptedLayer implements SerialPortLike {
  readonly path = "SCRIPTED";
  isOpen = false;
  written: Uint8Array[] = [];
  /** chunk offsets whose body write should get no ack (fail once). */
  failBodyOffsets = new Set<number>();
  /** when set, SaveAmiibo header replies Error instead of Ack. */
  errorOnHeader = false;
  /** body acks are deferred until writeAck() is called (for cancel tests). */
  holdBody = false;
  private pendingBody: Uint8Array | null = null;
  private dataListeners: Array<(data: Uint8Array) => void> = [];
  private awaitingBody = false;

  open(): Promise<void> {
    return Promise.resolve().then(() => {
      this.isOpen = true;
    });
  }

  close(): Promise<void> {
    return Promise.resolve().then(() => {
      this.isOpen = false;
    });
  }

  write(data: Uint8Array): Promise<void> {
    const bytes = Uint8Array.from(data);
    this.written.push(bytes);
    return Promise.resolve().then(() => this.respondTo(bytes));
  }

  /** Release a held body ack (emits Ack). */
  writeAck(): void {
    if (this.pendingBody) {
      this.pendingBody = null;
      this.emit(Uint8Array.from([0xff]));
    }
  }

  onData(listener: (data: Uint8Array) => void): void {
    this.dataListeners.push(listener);
  }

  onError(): void {}

  onClose(): void {}

  private respondTo(bytes: Uint8Array): void {
    const b = Array.from(bytes);
    if (b.length >= 2 && b[0] === 0xa5 && b[1] === 0x81) {
      this.emit(Uint8Array.from([0x80]));
      return;
    }
    if (b.length >= 2 && b[0] === 0xa5 && b[1] === 0x85) {
      this.emit(Uint8Array.from(Array.from("mock", (c) => c.charCodeAt(0))));
      return;
    }
    if (b.length >= 3 && b[0] === 0xa5 && b[2] === 0x91) {
      this.emit(Uint8Array.from([0xff]));
      return;
    }
    if (b.length >= 7 && b[0] === 0xa5 && b[6] === 0x90) {
      const offset = (b[1] ?? 0) | ((b[2] ?? 0) << 7);
      if (this.errorOnHeader) {
        this.emit(Uint8Array.from([0x00]));
        return;
      }
      this.awaitingBody = true;
      this.emit(Uint8Array.from([0xff]));
      return;
    }
    if (this.awaitingBody && b.length > 0 && b.length <= 20) {
      this.awaitingBody = false;
      const bodyBytes = Uint8Array.from(bytes);
      // Find the header offset for this body by scanning written frames.
      const offset = this.findBodyOffset(bodyBytes);
      if (this.failBodyOffsets.has(offset)) {
        this.failBodyOffsets.delete(offset);
        return; // no ack -> triggers reset + retry
      }
      if (this.holdBody) {
        this.pendingBody = bytes;
        return;
      }
      this.emit(Uint8Array.from([0xff]));
      return;
    }
    if (b.length === 1 && b[0] === 0xa5) {
      this.emit(Uint8Array.from([0xff]));
    }
  }

  private findBodyOffset(body: Uint8Array): number {
    // The header frame preceding this body carries the offset in bytes 1-2.
    for (let i = this.written.length - 1; i >= 0; i--) {
      const prev = Array.from(this.written[i] ?? []);
      if (prev.length >= 7 && prev[0] === 0xa5 && prev[6] === 0x90) {
        return (prev[1] ?? 0) | ((prev[2] ?? 0) << 7);
      }
    }
    return -1;
  }

  private emit(data: Uint8Array): void {
    for (const listener of this.dataListeners) listener(data);
  }
}

function makeService(layer: ScriptedLayer): DeviceService {
  return new DeviceService({
    minIntervalMs: 0,
    requestVersion: true,
    layerFactory: async () => layer,
  });
}

async function connect(service: DeviceService): Promise<void> {
  const result = await service.connect("SCRIPTED", 115200);
  expect(result.ok).toBe(true);
}

describe("AmiiboDeviceApi", () => {
  it("saves a 45-byte dump in 20B chunks with header+body + Ack", async () => {
    const layer = new ScriptedLayer();
    const service = makeService(layer);
    await connect(service);
    const api = new AmiiboDeviceApi(service);

    const payload = Uint8Array.from({ length: 45 }, (_, i) => i);
    const progress: Array<{ sent: number; total: number }> = [];
    const result = await api.saveToSlot(3, payload, {
      ackTimeoutMs: 200,
      onProgress: (p) => progress.push({ sent: p.sent, total: p.total }),
    });

    expect(result.ok).toBe(true);
    expect(result.sent).toBe(45);

    // header frames: offset 0 len 20, offset 20 len 20, offset 40 len 5
    const headers = layer.written.filter(
      (w) => Array.from(w).length === 7 && Array.from(w)[6] === 0x90,
    );
    expect(headers).toHaveLength(3);
    expect(Array.from(headers[0]!)).toEqual([0xa5, 0, 0, 20, 0, 3, 0x90]);
    expect(Array.from(headers[1]!)).toEqual([0xa5, 20, 0, 20, 0, 3, 0x90]);
    expect(Array.from(headers[2]!)).toEqual([0xa5, 40, 0, 5, 0, 3, 0x90]);

    // bodies were written raw
    expect(layer.written.some((w) => w.length === 20)).toBe(true);
    expect(layer.written.some((w) => w.length === 5)).toBe(true);

    expect(progress.map((p) => p.sent)).toEqual([20, 40, 45]);
  });

  it("changeIndex sends [A5, index, 0x91] and resolves", async () => {
    const layer = new ScriptedLayer();
    const service = makeService(layer);
    await connect(service);
    const api = new AmiiboDeviceApi(service);

    await api.changeIndex(12);

    expect(
      layer.written.some((w) => Array.from(w).join(",") === [0xa5, 12, 0x91].join(",")),
    ).toBe(true);
  });

  it("retries a failed body chunk via Hello reset", async () => {
    const layer = new ScriptedLayer();
    // second chunk (offset 20) body will be dropped once.
    layer.failBodyOffsets.add(20);
    const service = makeService(layer);
    await connect(service);
    const api = new AmiiboDeviceApi(service);

    const payload = Uint8Array.from({ length: 45 }, (_, i) => i);
    const result = await api.saveToSlot(0, payload, { ackTimeoutMs: 60 });

    expect(result.ok).toBe(true);

    // a Hello reset frame appeared between chunk writes
    const helloCount = layer.written.filter(
      (w) => Array.from(w).join(",") === "165,129",
    ).length;
    expect(helloCount).toBeGreaterThanOrEqual(1);
  });

  it("throws UNSUPPORTED when firmware replies Error to the header", async () => {
    const layer = new ScriptedLayer();
    layer.errorOnHeader = true;
    const service = makeService(layer);
    await connect(service);
    const api = new AmiiboDeviceApi(service);

    const payload = Uint8Array.from({ length: 30 }, (_, i) => i);
    await expect(
      api.saveToSlot(0, payload, { ackTimeoutMs: 60 }),
    ).rejects.toMatchObject({ kind: "UNSUPPORTED" });
  });

  it("honors cancellation with a held body ack", async () => {
    const layer = new ScriptedLayer();
    layer.holdBody = true;
    const service = makeService(layer);
    await connect(service);
    const api = new AmiiboDeviceApi(service);

    const payload = Uint8Array.from({ length: 45 }, (_, i) => i);
    const controller = new AbortController();
    const promise = api.saveToSlot(0, payload, {
      ackTimeoutMs: 5000,
      signal: controller.signal,
    });
    await new Promise((r) => setTimeout(r, 30));
    controller.abort();

    await expect(promise).rejects.toMatchObject({ kind: "CANCELLED" });
  });

  it("throws NOT_CONNECTED when the device is not connected", async () => {
    const layer = new ScriptedLayer();
    const service = makeService(layer);
    const api = new AmiiboDeviceApi(service);

    await expect(
      api.saveToSlot(0, Uint8Array.from({ length: 20 }), {}),
    ).rejects.toMatchObject({ kind: "NOT_CONNECTED" });
  });

  it("throws EMPTY for zero-length payloads", async () => {
    const layer = new ScriptedLayer();
    const service = makeService(layer);
    await connect(service);
    const api = new AmiiboDeviceApi(service);

    await expect(
      api.saveToSlot(0, new Uint8Array(0), {}),
    ).rejects.toMatchObject({ kind: "EMPTY" });
  });

  it("still rejects when AmiiboError is instanceof Error", () => {
    const err = new AmiiboError("TIMEOUT", "timeout");
    expect(err instanceof Error).toBe(true);
    expect(err.kind).toBe("TIMEOUT");
  });
});