import { describe, expect, it } from "vitest";
import { encodeReport } from "@ns2-studio/protocol";
import { NEUTRAL_REPORT, SwitchButton } from "@ns2-studio/pad-types";
import { InputHub } from "../src/main/hub/input-hub";
import { DeviceService } from "../src/main/device/device-service";
import {
  MockSerialLayer,
  MOCK_PORT_PATH,
} from "../src/main/device/mock-serial-layer";
import type { HubState } from "../src/shared/ipc";

interface Harness {
  hub: InputHub;
  service: DeviceService;
  get layer(): MockSerialLayer;
}

function makeHub(): Harness {
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
  return {
    hub,
    service,
    get layer(): MockSerialLayer {
      return captured.layer as MockSerialLayer;
    },
  };
}

const sameBytes = (a?: Uint8Array, b?: Uint8Array): boolean =>
  !!a &&
  !!b &&
  a.length === b.length &&
  a.every((byte, i) => byte === b[i]);

function countNeutralWrites(layer: MockSerialLayer): number {
  return layer.written.filter((w) => sameBytes(w, encodeReport(NEUTRAL_REPORT)))
    .length;
}

describe("InputHub", () => {
  it("starts idle with the device unconnected", () => {
    const { hub } = makeHub();
    expect(hub.getState()).toEqual({ activeSource: "idle" });
  });

  it("setSource sends NEUTRAL first, then switches", async () => {
    const h = makeHub();
    await h.service.connect(MOCK_PORT_PATH);

    const state = await h.hub.setSource("manual");

    expect(state.activeSource).toBe("manual");
    expect(h.hub.getState().activeSource).toBe("manual");
    expect(countNeutralWrites(h.layer)).toBe(1);
  });

  it("setSource to the same source does not resend NEUTRAL", async () => {
    const h = makeHub();
    await h.service.connect(MOCK_PORT_PATH);
    await h.hub.setSource("manual");

    const before = countNeutralWrites(h.layer);
    await h.hub.setSource("manual");

    expect(countNeutralWrites(h.layer)).toBe(before);
  });

  it("applyFrom writes only when the source is active", async () => {
    const h = makeHub();
    await h.service.connect(MOCK_PORT_PATH);
    await h.hub.setSource("manual");

    const report = { ...NEUTRAL_REPORT, buttons: SwitchButton.A };
    await h.hub.applyFrom("manual", report);
    expect(sameBytes(h.layer.written.at(-1), encodeReport(report))).toBe(true);

    const before = h.layer.written.length;
    await h.hub.applyFrom("forward", report);
    expect(h.layer.written.length).toBe(before);
  });

  it("switching sources neutralizes mid-state (no stuck key)", async () => {
    const h = makeHub();
    await h.service.connect(MOCK_PORT_PATH);
    await h.hub.setSource("manual");

    const report = { ...NEUTRAL_REPORT, buttons: SwitchButton.B };
    await h.hub.applyFrom("manual", report);
    await h.hub.setSource("idle");

    expect(countNeutralWrites(h.layer)).toBe(2);
  });

  it("forceNeutral writes NEUTRAL without changing the source", async () => {
    const h = makeHub();
    await h.service.connect(MOCK_PORT_PATH);
    await h.hub.setSource("manual");

    const before = countNeutralWrites(h.layer);
    await h.hub.forceNeutral();

    expect(countNeutralWrites(h.layer)).toBe(before + 1);
    expect(h.hub.getState().activeSource).toBe("manual");
  });

  it("resets to idle and emits stateChanged on device disconnect", async () => {
    const h = makeHub();
    await h.service.connect(MOCK_PORT_PATH);
    await h.hub.setSource("manual");

    const states: HubState[] = [];
    const off = h.hub.on("stateChanged", (s) => states.push(s));

    await h.service.disconnect();

    expect(h.hub.getState().activeSource).toBe("idle");
    expect(states.at(-1)).toEqual({ activeSource: "idle" });
    off();
  });

  it("is inert while the device is not connected", async () => {
    const h = makeHub();
    await h.hub.setSource("manual");
    await h.hub.applyFrom("manual", {
      ...NEUTRAL_REPORT,
      buttons: SwitchButton.A,
    });
    expect(h.hub.getState().activeSource).toBe("manual");
    expect(h.service.getStatus().state).toBe("disconnected");
  });
});