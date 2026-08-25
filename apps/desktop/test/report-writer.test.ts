import { describe, expect, it } from "vitest";
import { encodeReport } from "@ns2-studio/protocol";
import { NEUTRAL_REPORT, SwitchButton } from "@ns2-studio/pad-types";
import { ReportWriter } from "../src/main/device/report-writer";
import type { SerialPortLike } from "../src/main/device/types";

class FakeLayer implements SerialPortLike {
  readonly path = "FAKE";
  isOpen = true;
  writes: Uint8Array[] = [];

  open(): Promise<void> {
    return Promise.resolve();
  }

  close(): Promise<void> {
    this.isOpen = false;
    return Promise.resolve();
  }

  write(data: Uint8Array): Promise<void> {
    this.writes.push(Uint8Array.from(data));
    return Promise.resolve();
  }

  onData(): void {}
  onError(): void {}
  onClose(): void {}
}

describe("ReportWriter", () => {
  it("encodes and writes a report via protocol", async () => {
    const layer = new FakeLayer();
    const writer = new ReportWriter(layer, 2);
    writer.enqueueReport(NEUTRAL_REPORT);
    await writer.flush();
    expect(layer.writes).toHaveLength(1);
    expect(layer.writes[0]).toEqual(encodeReport(NEUTRAL_REPORT));
  });

  it("coalesces pending reports to the newest only", async () => {
    const layer = new FakeLayer();
    const writer = new ReportWriter(layer, 2);
    const reportA = { ...NEUTRAL_REPORT, buttons: SwitchButton.A };
    const reportB = { ...NEUTRAL_REPORT, buttons: SwitchButton.B };
    writer.enqueueReport(reportA);
    writer.enqueueReport(reportB);
    await writer.flush();
    expect(layer.writes).toHaveLength(1);
    expect(layer.writes[0]).toEqual(encodeReport(reportB));
  });

  it("keeps FIFO order for commands and reports", async () => {
    const layer = new FakeLayer();
    const writer = new ReportWriter(layer, 0);
    writer.enqueueCommand(Uint8Array.from([1, 2]));
    writer.enqueueReport(NEUTRAL_REPORT);
    writer.enqueueCommand(Uint8Array.from([3]));
    await writer.flush();
    expect(layer.writes).toHaveLength(3);
    expect(layer.writes[0]).toEqual(Uint8Array.from([1, 2]));
    expect(layer.writes[1]).toEqual(encodeReport(NEUTRAL_REPORT));
    expect(layer.writes[2]).toEqual(Uint8Array.from([3]));
  });

  it("spaces consecutive writes by minIntervalMs", async () => {
    const layer = new FakeLayer();
    const writer = new ReportWriter(layer, 20);
    const start = Date.now();
    writer.enqueueReport(NEUTRAL_REPORT);
    await new Promise((r) => setTimeout(r, 5));
    writer.enqueueReport({ ...NEUTRAL_REPORT, lx: 1 });
    await writer.flush();
    expect(layer.writes).toHaveLength(2);
    expect(Date.now() - start).toBeGreaterThanOrEqual(20);
  });

  it("reports pendingCount while queued", () => {
    const layer = new FakeLayer();
    const writer = new ReportWriter(layer, 2);
    expect(writer.pendingCount).toBe(0);
    writer.enqueueReport(NEUTRAL_REPORT);
    expect(writer.pendingCount).toBeGreaterThanOrEqual(1);
  });

  it("close() drops queued writes", async () => {
    const layer = new FakeLayer();
    const writer = new ReportWriter(layer, 2);
    writer.close();
    writer.enqueueReport(NEUTRAL_REPORT);
    writer.enqueueCommand(Uint8Array.from([0xa5]));
    await writer.flush();
    expect(layer.writes).toHaveLength(0);
  });
});