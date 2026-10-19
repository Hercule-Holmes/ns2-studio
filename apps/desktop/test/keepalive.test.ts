import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NEUTRAL_REPORT, SwitchButton } from "@ns2-studio/pad-types";
import type { PadReport } from "@ns2-studio/pad-types";
import { KeepaliveService } from "../src/main/remote/keepalive";
import type { InputHub } from "../src/main/hub/input-hub";
import type { HubState } from "../src/shared/ipc";
import type { DeviceService } from "../src/main/device/device-service";
import type { ConfigStore } from "../src/main/config/config-store";

type HubEvent = "reportSent" | "stateChanged";

class FakeHub {
  activeSource = "remote";
  private listeners = new Map<HubEvent, Set<(payload: never) => void>>();

  getState(): HubState {
    return { activeSource: this.activeSource as HubState["activeSource"] };
  }

  on(event: HubEvent, cb: (payload: never) => void): () => void {
    this.listeners.get(event)?.add(cb) ?? this.listeners.set(event, new Set([cb]));
    return () => this.listeners.get(event)?.delete(cb);
  }

  emit(event: HubEvent, payload: PadReport | HubState): void {
    for (const cb of this.listeners.get(event) ?? []) {
      (cb as (p: PadReport | HubState) => void)(payload);
    }
  }
}

function makeService(opts: {
  keepaliveMs: number;
  connected?: boolean;
  source?: string;
}) {
  const hub = new FakeHub();
  hub.activeSource = opts.source ?? "remote";
  const sendReport = vi.fn<(r: PadReport) => Promise<void>>(async () => {});
  const device = {
    isConnected: opts.connected ?? true,
    sendReport,
  } as unknown as DeviceService;
  const config = {
    get: () => ({
      remote: { keepaliveMs: opts.keepaliveMs },
    }),
  } as unknown as ConfigStore;
  const svc = new KeepaliveService(
    hub as unknown as InputHub,
    device,
    config,
  );
  return { svc, hub, sendReport };
}

describe("KeepaliveService (B3)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("jiggles the stick after the idle interval on the remote source", async () => {
    const { svc, sendReport } = makeService({ keepaliveMs: 20000 });
    svc.start();

    await vi.advanceTimersByTimeAsync(20000);
    await vi.advanceTimersByTimeAsync(1000); // flush the 60ms restore

    expect(sendReport).toHaveBeenCalledTimes(2);
    const jiggle = sendReport.mock.calls[0]![0]!;
    expect(jiggle.lx).toBe(NEUTRAL_REPORT.lx - 8);
    expect(sendReport.mock.calls[1]![0]!).toEqual({ ...NEUTRAL_REPORT });
    svc.stop();
  });

  it("does nothing when the active source is not remote", async () => {
    const { svc, sendReport } = makeService({ keepaliveMs: 20000, source: "manual" });
    svc.start();

    await vi.advanceTimersByTimeAsync(60000);

    expect(sendReport).not.toHaveBeenCalled();
    svc.stop();
  });

  it("does nothing when disabled (keepaliveMs=0)", async () => {
    const { svc, sendReport } = makeService({ keepaliveMs: 0 });
    svc.start();

    await vi.advanceTimersByTimeAsync(60000);

    expect(sendReport).not.toHaveBeenCalled();
    svc.stop();
  });

  it("skips the jiggle while recent real input exists", async () => {
    const { svc, hub, sendReport } = makeService({ keepaliveMs: 20000 });
    svc.start();

    // A non-neutral report right before the due tick resets the idle clock.
    hub.emit("reportSent", { ...NEUTRAL_REPORT, buttons: SwitchButton.A });
    await vi.advanceTimersByTimeAsync(10000);
    expect(sendReport).not.toHaveBeenCalled();

    // Only after a full idle interval does it fire again.
    await vi.advanceTimersByTimeAsync(10001);
    await vi.advanceTimersByTimeAsync(1000); // flush the 60ms restore
    expect(sendReport).toHaveBeenCalledTimes(2);
    svc.stop();
  });

  it("ignores neutral-only report traffic as activity", async () => {
    const { svc, hub, sendReport } = makeService({ keepaliveMs: 20000 });
    svc.start();

    hub.emit("reportSent", { ...NEUTRAL_REPORT });
    await vi.advanceTimersByTimeAsync(20000);
    await vi.advanceTimersByTimeAsync(1000); // flush the 60ms restore

    expect(sendReport).toHaveBeenCalledTimes(2);
    svc.stop();
  });
});
